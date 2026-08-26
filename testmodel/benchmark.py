"""
benchmark.py — đo và so sánh các model vision trên Vietnamese_StreetFood_14Class.

ĐÂY LÀ BENCHMARK, KHÔNG TRAIN / KHÔNG FINE-TUNE. Không có bước học nào, không
đụng vào trọng số, không ghi gì ra ngoài thư mục testmodel/.

Chạy:
    py testmodel/benchmark.py                 # mặc định: 15 ảnh mỗi class
    py testmodel/benchmark.py --all           # toàn bộ 1070 ảnh test
    py testmodel/benchmark.py --per-class 40
    py testmodel/benchmark.py --models project-vllm

Kết quả nằm ở testmodel/results/.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import random
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

# Windows console mặc định là cp1252 → in tên món tiếng Việt là ném
# UnicodeEncodeError và giết cả tiến trình giữa chừng. Ép UTF-8 ngay từ đầu.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
DATASET = PROJECT / "Vietnamese_StreetFood_14Class"
RESULTS = HERE / "results"
CACHE = RESULTS / "cache"

sys.path.insert(0, str(HERE))
import dish_map                       # noqa: E402
import variants                       # noqa: E402
from adapters import build_adapters   # noqa: E402


# ─────────────────────────────────────────────────────────────────────────────
# Nạp cấu hình từ .env.local của dự án (chỉ ĐỌC, không sửa)
# ─────────────────────────────────────────────────────────────────────────────
def load_env():
    f = PROJECT / ".env.local"
    if not f.exists():
        return
    for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        os.environ.setdefault(k, v)


# ─────────────────────────────────────────────────────────────────────────────
# Dataset
# ─────────────────────────────────────────────────────────────────────────────
def load_classes() -> list[str]:
    """Đọc 14 tên class từ data.yaml (đọc tay, khỏi cần pyyaml)."""
    text = (DATASET / "data.yaml").read_text(encoding="utf-8")
    m = re.search(r"names:\s*\[(.*?)\]", text, re.S)
    if not m:
        raise SystemExit("Không đọc được 'names' trong data.yaml")
    names = re.findall(r"'([^']*)'|\"([^\"]*)\"", m.group(1))
    out = [a or b for a, b in names]
    if len(out) != 14:
        raise SystemExit(f"data.yaml khai {len(out)} class, mong đợi 14")
    return out


def load_test_set(classes: list[str]) -> list[dict]:
    """
    Ghép ảnh test với ground-truth.

    Dataset gốc là YOLO detection (mỗi dòng nhãn = 'class_id x y w h...'), nhưng
    ĐÃ KIỂM: cả 1070 ảnh test đều chỉ có DUY NHẤT một class id trong file nhãn,
    không ảnh nào đa class, không nhãn nào rỗng. Nên dùng làm bài phân loại là
    hợp lệ — ground truth chính là class id đó.

    Ảnh nào có từ 2 class trở lên sẽ bị LOẠI kèm cảnh báo, chứ không tự chọn
    bừa một class: đoán hộ ground truth là cách nhanh nhất để có bảng điểm sai.
    """
    img_dir, lbl_dir = DATASET / "test" / "images", DATASET / "test" / "labels"
    items, skipped = [], []
    for img in sorted(img_dir.iterdir()):
        if img.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
            continue
        lbl = lbl_dir / (img.stem + ".txt")
        if not lbl.exists():
            skipped.append((img.name, "không có file nhãn"))
            continue
        ids = {ln.split()[0] for ln in lbl.read_text().splitlines() if ln.strip()}
        if len(ids) != 1:
            skipped.append((img.name, f"{len(ids)} class trong một ảnh"))
            continue
        cid = int(next(iter(ids)))
        items.append({"file": img.name, "path": str(img),
                      "class_id": cid, "class_name": classes[cid]})
    return items, skipped


def stratified(items: list[dict], per_class: int, seed: int) -> list[dict]:
    """Lấy tối đa `per_class` ảnh mỗi class — giữ mọi class đều có mặt.

    Lấy ngẫu nhiên đều tay sẽ để lọt các class hiếm (class 0 chỉ có 9 ảnh trên
    tổng 1070), mà macro-F1 lại tính trung bình theo class nên mất một class là
    lệch hẳn kết quả."""
    by = defaultdict(list)
    for it in items:
        by[it["class_id"]].append(it)
    rnd = random.Random(seed)
    out = []
    for cid in sorted(by):
        pool = sorted(by[cid], key=lambda x: x["file"])
        rnd.shuffle(pool)
        out.extend(pool[:per_class])
    out.sort(key=lambda x: (x["class_id"], x["file"]))
    return out


# Prompt đã chuyển hết sang testmodel/variants.py — mọi biến thể (kể cả mốc
# 'base') lấy prompt từ đó, để chỉ có MỘT nơi định nghĩa. Trong một lần chạy,
# mọi model nhận cùng prompt của cùng biến thể, không đổi một chữ.


# ─────────────────────────────────────────────────────────────────────────────
# Bóc nhãn từ câu trả lời
# ─────────────────────────────────────────────────────────────────────────────
def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def parse_label(text: str, classes: list[str]) -> tuple[int, str]:
    """
    → (class_id, cách_khớp). class_id = -1 nghĩa là INVALID.

    Ba mức, chặt trước lỏng sau. Cố ý KHÔNG đoán mò kiểu 'có chữ rice thì chắc
    là Broken Rice' — đoán hộ model sẽ thổi phồng điểm của nó.
    """
    if not text or not text.strip():
        return -1, "rỗng"

    norm_classes = [_norm(c) for c in classes]

    # 1. JSON đúng định dạng đã yêu cầu
    m = re.search(r'\{.*?"label"\s*:\s*"([^"]*)".*?\}', text, re.S)
    if m:
        cand = _norm(m.group(1))
        if cand in norm_classes:
            return norm_classes.index(cand), "json"

    # 2. Tên class xuất hiện nguyên vẹn ở bất kỳ đâu trong câu trả lời
    flat = _norm(text)
    hits = [i for i, nc in enumerate(norm_classes) if nc and nc in flat]
    if len(hits) == 1:
        return hits[0], "chuỗi con"
    if len(hits) > 1:
        # Nhiều nhãn cùng khớp → chọn nhãn DÀI NHẤT, vì các tên ngắn hay là
        # khúc con của tên dài ("Grilled Pork Vermicelli" chứa "Grilled Pork").
        best = max(hits, key=lambda i: len(norm_classes[i]))
        return best, "chuỗi con (nhiều)"

    return -1, "không khớp nhãn nào"


# ─────────────────────────────────────────────────────────────────────────────
# Metric — tự tính bằng numpy, không cần sklearn
# ─────────────────────────────────────────────────────────────────────────────
def compute_metrics(rows: list[dict], classes: list[str]) -> dict:
    """
    rows: [{class_id, pred_id, latency_ms, error}]

    Quy ước tính điểm, nói rõ để đọc bảng không hiểu nhầm:
      • INVALID (model không trả ra nhãn hợp lệ, hoặc lỗi mạng) vẫn được tính
        là MỘT lần đoán SAI ở mẫu số accuracy. Bỏ nó ra ngoài sẽ thưởng cho
        model hay im lặng hoặc hay lỗi.
      • Precision/Recall/F1 tính trên các dự đoán HỢP LỆ, theo từng class rồi
        lấy trung bình cộng (macro) — không trọng số theo số ảnh, nên class
        hiếm cũng nặng ngang class phổ biến.
    """
    import numpy as np

    n = len(classes)
    cm = np.zeros((n, n), dtype=int)      # [thật][đoán]
    correct = wrong = invalid = 0
    lat = []

    for r in rows:
        gt, pd_ = r["class_id"], r["pred_id"]
        if r.get("latency_ms") is not None:
            lat.append(float(r["latency_ms"]))
        if pd_ < 0:
            invalid += 1
            continue
        cm[gt][pd_] += 1
        if gt == pd_:
            correct += 1
        else:
            wrong += 1

    total = len(rows)
    accuracy = correct / total if total else 0.0

    prec, rec, f1, support = [], [], [], []
    for c in range(n):
        tp = int(cm[c][c])
        fp = int(cm[:, c].sum() - tp)
        fn = int(cm[c, :].sum() - tp)
        p = tp / (tp + fp) if (tp + fp) else 0.0
        r_ = tp / (tp + fn) if (tp + fn) else 0.0
        prec.append(p)
        rec.append(r_)
        f1.append(2 * p * r_ / (p + r_) if (p + r_) else 0.0)
        support.append(int(cm[c, :].sum()))

    lat_sorted = sorted(lat)

    def pct(q):
        if not lat_sorted:
            return 0.0
        return lat_sorted[min(len(lat_sorted) - 1, int(q * len(lat_sorted)))]

    return {
        "total": total, "correct": correct, "wrong": wrong, "invalid": invalid,
        "accuracy": accuracy,
        "macro_precision": float(sum(prec) / n),
        "macro_recall": float(sum(rec) / n),
        "macro_f1": float(sum(f1) / n),
        "avg_latency_ms": (sum(lat) / len(lat)) if lat else 0.0,
        "p50_latency_ms": pct(0.50),
        "p95_latency_ms": pct(0.95),
        "confusion": cm.tolist(),
        "per_class": [
            {"class_id": c, "class_name": classes[c], "support": support[c],
             "precision": prec[c], "recall": rec[c], "f1": f1[c],
             "accuracy": (cm[c][c] / support[c]) if support[c] else 0.0}
            for c in range(n)
        ],
    }


def save_confusion(cm, classes, model_name, out_png, out_csv):
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["true\\pred"] + classes)
        for i, row in enumerate(cm):
            w.writerow([classes[i]] + list(row))
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np

        arr = np.array(cm)
        fig, ax = plt.subplots(figsize=(11, 9))
        ax.imshow(arr, cmap="Blues")
        ax.set_xticks(range(len(classes)))
        ax.set_yticks(range(len(classes)))
        ax.set_xticklabels(classes, rotation=45, ha="right", fontsize=7)
        ax.set_yticklabels(classes, fontsize=7)
        ax.set_xlabel("Model đoán")
        ax.set_ylabel("Nhãn thật")
        ax.set_title(f"Confusion matrix — {model_name}")
        for i in range(len(classes)):
            for j in range(len(classes)):
                if arr[i][j]:
                    ax.text(j, i, str(arr[i][j]), ha="center", va="center",
                            fontsize=7,
                            color="white" if arr[i][j] > arr.max() / 2 else "black")
        fig.tight_layout()
        fig.savefig(out_png, dpi=130)
        plt.close(fig)
        return True
    except Exception as e:                          # noqa: BLE001
        print(f"    (không vẽ được PNG: {e} — bản CSV vẫn có)")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Cache / resume
# ─────────────────────────────────────────────────────────────────────────────
def cache_path(model_name: str, variant_name: str = "base") -> Path:
    """Cache tách theo TỪNG biến thể.

    Gộp chung một file là hỏng cả phép đo: chạy `gloss` xong rồi chạy `base` sẽ
    đọc lại kết quả của `gloss` mà tưởng là của `base`, và hai biến thể ra điểm
    y hệt nhau — trông như 'cải tiến không có tác dụng' trong khi thật ra chưa
    hề gọi model lần nào.
    """
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", model_name)
    vsafe = re.sub(r"[^A-Za-z0-9_.-]+", "_", variant_name)
    return CACHE / f"{safe}__{vsafe}.jsonl"


def fmt_dur(sec: float) -> str:
    """Giây thành chuỗi ngắn gọn: 45s, 2m30s, 1h04m."""
    sec = max(0, int(round(sec)))
    if sec < 60:
        return f"{sec}s"
    if sec < 3600:
        return f"{sec // 60}m{sec % 60:02d}s"
    return f"{sec // 3600}h{(sec % 3600) // 60:02d}m"


def load_cache(model_name: str, variant_name: str = "base") -> dict:
    """
    Đọc cache, BỎ QUA những ảnh từng lỗi để lần chạy sau thử lại chúng.

    Không có luật này thì cache quay ra hại: một lần chạy dính rate-limit hay
    sai tên model sẽ ghi lỗi cho cả trăm ảnh, và MỌI lần chạy sau đều phát lại
    y nguyên lỗi cũ mà không gọi mạng lần nào — sửa xong tên model rồi vẫn thấy
    kết quả hỏng. Đo thật: cache của một model có 187/187 dòng đều là lỗi.
    """
    p = cache_path(model_name, variant_name)
    if not p.exists():
        return {}
    out = {}
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except Exception:                            # noqa: BLE001
            continue     # dòng hỏng (bị cắt giữa chừng khi Ctrl+C) → bỏ qua
        if rec.get("error"):
            continue     # từng lỗi → coi như chưa đo, lần này thử lại
        out[rec["file"]] = rec
    return out


def append_cache(model_name: str, variant_name: str, rec: dict):
    """Chỉ ghi kết quả ĐO ĐƯỢC. Ảnh lỗi không ghi, để lần sau còn thử lại."""
    if rec.get("error"):
        return
    with open(cache_path(model_name, variant_name), "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


# ─────────────────────────────────────────────────────────────────────────────
# Đo MỘT ảnh theo MỘT biến thể
# ─────────────────────────────────────────────────────────────────────────────
def _parse_cascade_extras(text: str, classes: list[str]) -> tuple[str, int]:
    """Bóc `confidence` và `second_choice` ở lượt 1 của cascade → (confidence, class_id_#2)."""
    conf = ""
    m = re.search(r'"confidence"\s*:\s*"([^"]*)"', text or "", re.I)
    if m:
        conf = m.group(1).strip().lower()
    second = -1
    m = re.search(r'"second_choice"\s*:\s*"([^"]*)"', text or "", re.I)
    if m:
        norm = [_norm(c) for c in classes]
        cand = _norm(m.group(1))
        if cand in norm:
            second = norm.index(cand)
    return conf, second


def predict_one(a, v, it: dict, classes: list[str]) -> dict:
    """
    Chạy MỘT ảnh theo biến thể `v`, trả record đầy đủ để ghi cache + chấm điểm.

    `calls` = số lời gọi mạng thật đã tốn cho ảnh này. Phải ghi lại, vì một
    biến thể hơn 3 điểm nhờ gọi gấp 3 lần thì không phải cùng một loại cải tiến
    với biến thể hơn 3 điểm mà vẫn 1 lần gọi.
    """
    prompt = v.prompt(classes)
    kw = {"params": v.params, "extra_body": v.extra_body}

    # Pipeline thật của app trả TÊN MÓN tiếng Việt tự do, không phải một trong
    # 14 nhãn — phải dịch qua bảng ánh xạ tay thay vì parse_label của bài đóng.
    if getattr(a, "uses_dish_map", False):
        rp = a.predict(it["path"], prompt, **kw)
        pid, how = (-1, "lỗi gọi") if rp.error else dish_map.map_dish(rp.text)
        return {
            "file": it["file"], "class_id": it["class_id"],
            "class_name": it["class_name"],
            "pred_id": pid, "pred_name": classes[pid] if pid >= 0 else "",
            "match": how, "latency_ms": round(rp.latency_ms, 1),
            "error": rp.error, "raw": (rp.text or "")[:300], "calls": 1,
        }

    def rec_of(pid, how, lat, err, raw, calls, **extra):
        return {
            "file": it["file"], "class_id": it["class_id"],
            "class_name": it["class_name"],
            "pred_id": pid, "pred_name": classes[pid] if pid >= 0 else "",
            "match": how, "latency_ms": round(lat, 1),
            "error": err, "raw": (raw or "")[:300], "calls": calls, **extra,
        }

    # ── Self-consistency: lấy nhiều mẫu rồi bỏ phiếu theo đa số ──────────────
    if v.samples > 1:
        votes, lat, err, last_raw = [], 0.0, "", ""
        for _ in range(v.samples):
            rp = a.predict(it["path"], prompt, **kw)
            lat += rp.latency_ms
            last_raw = rp.text or last_raw
            if rp.error:
                err = rp.error
                continue
            pid, _how = parse_label(rp.text, classes)
            if pid >= 0:
                votes.append(pid)
        if not votes:
            return rec_of(-1, "không mẫu nào hợp lệ", lat, err, last_raw, v.samples)
        top, n = Counter(votes).most_common(1)[0]
        return rec_of(top, f"bỏ phiếu {n}/{v.samples}", lat, "", last_raw, v.samples)

    # ── Một lượt (có thể kèm lượt 2 thu hẹp) ────────────────────────────────
    rp = a.predict(it["path"], prompt, **kw)
    pid, how = parse_label(rp.text, classes)
    extra = {"avg_logprob": rp.avg_logprob, "min_logprob": rp.min_logprob}
    if rp.error:
        return rec_of(pid, how, rp.latency_ms, rp.error, rp.text, 1, **extra)

    if v.cascade:
        conf, second = _parse_cascade_extras(rp.text, classes)
        extra["confidence"] = conf
        # Chỉ hỏi lại khi model TỰ NHẬN không chắc VÀ nêu được ứng viên #2 khác
        # đáp án #1. Không có ứng viên #2 thì lượt 2 chẳng có gì để so.
        if pid >= 0 and second >= 0 and second != pid and conf in ("medium", "low"):
            rp2 = a.predict(it["path"],
                            variants.prompt_refine(classes, classes[pid], classes[second]),
                            **kw)
            lat = rp.latency_ms + rp2.latency_ms
            if rp2.error:
                return rec_of(pid, how + " (lượt 2 lỗi)", lat, "", rp.text, 2, **extra)
            pid2, _ = parse_label(rp2.text, classes)
            if pid2 >= 0:
                return rec_of(pid2, f"lượt 2 sau conf={conf}", lat, "", rp2.text, 2, **extra)
            # Lượt 2 không đọc được nhãn → GIỮ đáp án lượt 1, không tính là hỏng.
            return rec_of(pid, how + " (lượt 2 không rõ)", lat, "", rp.text, 2, **extra)

    return rec_of(pid, how, rp.latency_ms, "", rp.text, 1, **extra)


# ─────────────────────────────────────────────────────────────────────────────
# So sánh biến thể — chống đọc nhầm nhiễu thành cải tiến
# ─────────────────────────────────────────────────────────────────────────────
def mcnemar_p(n01: int, n10: int) -> float:
    """
    p-value hai phía của kiểm định McNemar bản CHÍNH XÁC (nhị thức, không xấp xỉ
    chi-bình-phương — mẫu ở đây nhỏ nên xấp xỉ sai).

    Chỉ đếm những ảnh HAI biến thể TRẢ LỜI KHÁC NHAU:
      n01 = mốc sai, biến thể đúng      n10 = mốc đúng, biến thể sai
    Ảnh cả hai cùng đúng hoặc cùng sai không mang thông tin về khác biệt.

    Vì sao cần: chênh vài phần trăm accuracy trên 187 ảnh rất dễ chỉ là nhiễu.
    Không có con số này thì rất dễ ship một biến thể thực chất không hơn gì.
    """
    n = n01 + n10
    if n == 0:
        return 1.0
    k = min(n01, n10)
    tail = sum(math.comb(n, i) for i in range(k + 1)) * (0.5 ** n)
    return min(1.0, 2 * tail)


def print_variant_comparison(by_run: dict, base_variant: str = "base"):
    """In bảng so từng ảnh: biến thể nào thực sự hơn mốc, hơn ở đâu."""
    models = sorted({m for m, _ in by_run})
    for model in models:
        base = by_run.get((model, base_variant))
        others = [(v, r) for (m, v), r in by_run.items()
                  if m == model and v != base_variant]
        if not base or not others:
            continue
        print(f"\n{'='*104}\nSO VỚI MỐC '{base_variant}' — {model}")
        print(f"{'BIẾN THỂ':<16}{'ACC':>8}{'Δ ACC':>9}{'sai→đúng':>10}{'đúng→sai':>10}"
              f"{'p':>9}{'gọi/ảnh':>10}  KẾT LUẬN")
        print("-" * 104)
        b_acc = sum(1 for f, r in base.items() if r["pred_id"] == r["class_id"]) / len(base)
        print(f"{base_variant:<16}{b_acc*100:>7.2f}%{'—':>9}{'—':>10}{'—':>10}{'—':>9}{'1.00':>10}")
        for vname, run in sorted(others):
            common = [f for f in base if f in run]
            if not common:
                continue
            n01 = sum(1 for f in common
                      if base[f]["pred_id"] != base[f]["class_id"]
                      and run[f]["pred_id"] == run[f]["class_id"])
            n10 = sum(1 for f in common
                      if base[f]["pred_id"] == base[f]["class_id"]
                      and run[f]["pred_id"] != run[f]["class_id"])
            v_acc = sum(1 for f in common
                        if run[f]["pred_id"] == run[f]["class_id"]) / len(common)
            bb_acc = sum(1 for f in common
                         if base[f]["pred_id"] == base[f]["class_id"]) / len(common)
            p = mcnemar_p(n01, n10)
            calls = sum(run[f].get("calls", 1) for f in common) / len(common)
            if p < 0.05:
                verdict = "HƠN rõ rệt" if n01 > n10 else "KÉM rõ rệt"
            else:
                verdict = "chưa phân biệt được với nhiễu"
            print(f"{vname:<16}{v_acc*100:>7.2f}%{(v_acc-bb_acc)*100:>+8.2f}%"
                  f"{n01:>10}{n10:>10}{p:>9.3f}{calls:>10.2f}  {verdict}")
        print("-" * 104)
        print("  p = McNemar hai phía. p >= 0.05 nghĩa là chênh lệch CHƯA đủ bằng chứng,")
        print("  dù cột Δ ACC có dương — đừng ship chỉ vì con số đẹp. Chạy thêm ảnh (--all)")
        print("  rồi đo lại. 'gọi/ảnh' > 1 nghĩa là biến thể đó tốn thêm lời gọi mạng.")
        print("=" * 104)


# ─────────────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Benchmark model vision trên Vietnamese_StreetFood_14Class")
    ap.add_argument("--per-class", type=int, default=15,
                    help="số ảnh mỗi class (mặc định 15). Dùng --all để lấy hết.")
    ap.add_argument("--all", action="store_true", help="chạy toàn bộ test set")
    ap.add_argument("--models", default="", help="lọc theo tên, phân cách bằng dấu phẩy")
    ap.add_argument("--seed", type=int, default=42, help="seed chọn mẫu, để lặp lại được")
    ap.add_argument("--no-cache", action="store_true", help="bỏ qua cache, chạy lại từ đầu")
    ap.add_argument("--variant", default="base",
                    help="biến thể cách gọi, phân cách bằng dấu phẩy, hoặc 'all'. "
                         "Xem danh sách trong testmodel/variants.py. Mặc định 'base'.")
    ap.add_argument("--tag", default="",
                    help="nhãn tự đặt cho lượt chạy, tách cache riêng. Dùng để đo "
                         "pipeline app TRƯỚC và SAU khi sửa lib/vision.js: "
                         "--models app-pipeline --tag truoc  …sửa code…  --tag sau")
    args = ap.parse_args()

    # ── chọn biến thể ───────────────────────────────────────────────────────
    if args.variant.strip().lower() == "all":
        want_variants = list(variants.ALL_ORDER)
    else:
        want_variants = [w.strip() for w in args.variant.split(",") if w.strip()]
    unknown = [w for w in want_variants if w not in variants.VARIANTS]
    if unknown:
        raise SystemExit(
            f"Không có biến thể: {', '.join(unknown)}\n"
            f"Đang có: {', '.join(variants.VARIANTS)}")
    # Luôn chạy 'base' trước khi so — không có mốc thì bảng so sánh vô nghĩa.
    if len(want_variants) > 1 and "base" not in want_variants:
        want_variants.insert(0, "base")
        print("(tự thêm biến thể 'base' làm mốc so sánh)")
    variant_list = [variants.VARIANTS[w] for w in want_variants]

    load_env()
    RESULTS.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)

    if not DATASET.exists():
        raise SystemExit(f"Không thấy dataset: {DATASET}")

    classes = load_classes()
    items, skipped = load_test_set(classes)
    print(f"Dataset : {DATASET.name}")
    print(f"  test set : {len(items)} ảnh dùng được"
          + (f" · {len(skipped)} ảnh bị loại" if skipped else ""))
    for name, why in skipped[:5]:
        print(f"     loại: {name} — {why}")

    subset = items if args.all else stratified(items, args.per_class, args.seed)
    dist = defaultdict(int)
    for it in subset:
        dist[it["class_name"]] += 1
    print(f"  đem đo   : {len(subset)} ảnh / {len(classes)} class"
          + ("  (TOÀN BỘ)" if args.all else f"  (tối đa {args.per_class} ảnh mỗi class)"))

    print(f"  biến thể : {', '.join(v.name for v in variant_list)}")

    adapters = build_adapters(
        os.environ.get("LLM_BASE_URL", ""),
        os.environ.get("LLM_API_KEY", ""),
        os.environ.get("LLM_VISION_MODEL") or os.environ.get("LLM_MODEL", "qwen 3-vl"),
    )
    if args.models:
        want = [w.strip().lower() for w in args.models.split(",") if w.strip()]
        adapters = [a for a in adapters if any(w in a.name.lower() for w in want)]
    else:
        # Pipeline thật của app phải gọi TÊN mới chạy: nó sinh JSON dinh dưỡng
        # đầy đủ nên chậm hơn bài đóng cả chục lần, kéo mọi lượt chạy mặc định
        # dài ra vô ích. Dùng: --models app-pipeline
        adapters = [a for a in adapters if not getattr(a, "uses_dish_map", False)]

    print(f"\nModel sẽ chạy:")
    runnable, blocked = [], []
    for a in adapters:
        okay, why = a.available()
        if okay:
            # Kiểm tra id model / khoá TRƯỚC khi đốt hàng trăm ảnh.
            okay, why = a.preflight()
        print(f"  {'[chạy]  ' if okay else '[bỏ qua]'} {a.name}" + ("" if okay else f"  — {why}"))
        if okay:
            runnable.append(a)
        else:
            blocked.append((a.name, why))
    if not runnable:
        raise SystemExit("\nKhông có model nào chạy được. Xem README.txt để biết cần đặt khoá nào.")

    all_pred_rows, summaries = [], []
    # rows theo (model, variant) — giữ lại để so từng ảnh giữa các biến thể.
    by_run: dict[tuple[str, str], dict] = {}

    for a in runnable:
        for v in variant_list:
            # Khoá phân biệt lượt chạy: biến thể + nhãn tự đặt. Cache và mọi
            # dòng kết quả đều bám khoá này, nên hai lượt khác nhau không đè nhau.
            vkey = v.name + (f"@{args.tag}" if args.tag else "")
            run_name = (a.name if vkey == "base" and len(variant_list) == 1
                        else f"{a.name} [{vkey}]")
            print(f"\n{'='*70}\n{run_name}\n  {v.desc}\n{'='*70}")
            cached = {} if args.no_cache else load_cache(a.name, vkey)
            if cached:
                print(f"  cache: đã có {len(cached)} ảnh, chỉ chạy phần còn thiếu")

            # Số ảnh CHƯA có cache tính từ mỗi vị trí trở về sau. Dùng để ước tính
            # thời gian còn lại: ảnh lấy từ cache không tốn giây nào, tính chúng vào
            # sẽ ra ETA sai hẳn.
            remain_new = [0] * (len(subset) + 1)
            for k in range(len(subset) - 1, -1, -1):
                remain_new[k] = remain_new[k + 1] + (0 if subset[k]["file"] in cached else 1)

            rows, errors, n_new, t_api = [], 0, 0, 0.0
            t_start = time.time()
            for i, it in enumerate(subset, 1):
                rec = cached.get(it["file"])
                if rec is None:
                    t_call = time.time()
                    rec = predict_one(a, v, it, classes)
                    t_api += time.time() - t_call
                    n_new += 1
                    append_cache(a.name, vkey, rec)
                elif getattr(a, "uses_dish_map", False):
                    # Chấm LẠI từ câu trả lời gốc mỗi lần chạy, không tin pred_id
                    # đã lưu. Phần đắt là lời gọi model (đã cache), còn ánh xạ
                    # tên món → class là hàm rẻ và CÒN ĐANG SỬA: bảng ánh xạ có
                    # lỗi thì phải sửa rồi chấm lại được ngay, chứ không phải
                    # chạy lại 70 ảnh mất 25 phút chỉ vì một dòng luật sai.
                    pid, how = dish_map.map_dish(rec.get("raw", ""))
                    rec = {**rec, "pred_id": pid,
                           "pred_name": classes[pid] if pid >= 0 else "",
                           "match": how}
                if rec.get("error"):
                    errors += 1
                rows.append(rec)

                if i % 10 == 0 or i == len(subset):
                    done = sum(1 for r in rows if r["pred_id"] == r["class_id"])
                    acc = 100.0 * done / len(rows)
                    # Tách rõ "đo mới" và "cache": nếu gộp thì 20 ảnh đầu hiện (0s)
                    # trông như model chạy tức thì, trong khi thật ra chưa gọi mạng
                    # lần nào. Tốc độ và ETA chỉ tính trên phần đo mới.
                    eta = ""
                    if n_new and remain_new[i]:
                        eta = f"  còn ~{fmt_dur(remain_new[i] * t_api / n_new)}"
                    print(f"  {i}/{len(subset)}  đúng {done} ({acc:.1f}%)  lỗi {errors}"
                          f"  |  đo mới {n_new}, cache {i - n_new}"
                          f"  |  {fmt_dur(time.time() - t_start)}{eta}", flush=True)

            m = compute_metrics(rows, classes)
            m["model"] = run_name
            m["errors"] = errors
            # Số lời gọi mạng THẬT / ảnh — cascade và vote3 tốn nhiều hơn 1, và
            # con số này mới quyết định được có ship nổi hay không.
            calls = [r.get("calls", 1) for r in rows]
            m["avg_calls"] = sum(calls) / len(calls) if calls else 1.0
            m["pct_refined"] = 100.0 * sum(1 for c in calls if c > 1) / len(calls) if calls else 0.0
            summaries.append(m)
            by_run[(a.name, vkey)] = {r["file"]: r for r in rows}
            for r in rows:
                all_pred_rows.append({"model": run_name, **r})

            tag = re.sub(r"[^A-Za-z0-9]+", "_", run_name)
            save_confusion(m["confusion"], classes, run_name,
                           RESULTS / f"confusion_{tag}.png",
                           RESULTS / f"confusion_{tag}.csv")

    # ── ghi file ────────────────────────────────────────────────────────────
    with open(RESULTS / "predictions.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["model", "file", "class_id", "class_name",
                                          "pred_id", "pred_name", "match",
                                          "latency_ms", "calls", "confidence",
                                          "avg_logprob", "min_logprob", "error", "raw"],
                           extrasaction="ignore")
        w.writeheader()
        w.writerows(all_pred_rows)

    with open(RESULTS / "summary.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["model", "images", "correct", "wrong", "invalid", "errors",
                    "accuracy", "macro_precision", "macro_recall", "macro_f1",
                    "avg_latency_ms", "p50_latency_ms", "p95_latency_ms",
                    "avg_calls", "pct_refined"])
        for m in summaries:
            w.writerow([m["model"], m["total"], m["correct"], m["wrong"], m["invalid"],
                        m["errors"], f"{m['accuracy']:.4f}",
                        f"{m['macro_precision']:.4f}", f"{m['macro_recall']:.4f}",
                        f"{m['macro_f1']:.4f}", f"{m['avg_latency_ms']:.0f}",
                        f"{m['p50_latency_ms']:.0f}", f"{m['p95_latency_ms']:.0f}",
                        f"{m.get('avg_calls', 1):.2f}", f"{m.get('pct_refined', 0):.1f}"])

    with open(RESULTS / "per_class.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["model", "class_id", "class_name", "support",
                    "accuracy", "precision", "recall", "f1"])
        for m in summaries:
            for pc in m["per_class"]:
                w.writerow([m["model"], pc["class_id"], pc["class_name"], pc["support"],
                            f"{pc['accuracy']:.4f}", f"{pc['precision']:.4f}",
                            f"{pc['recall']:.4f}", f"{pc['f1']:.4f}"])

    # ── bảng cuối ───────────────────────────────────────────────────────────
    print("\n" + "=" * 104)
    print(f"{'MODEL':<34}{'ACCURACY':>10}{'MACRO-F1':>10}{'AVG LAT':>11}"
          f"{'CORRECT':>9}{'WRONG':>8}{'INVALID':>9}")
    print("-" * 104)

    """
    Model gọi hỏng gần hết KHÔNG được xếp hạng như model đoán sai.

    Lần chạy trước in ra "gemini 0.00%" trong khi 187/187 lời gọi đều là HTTP
    404 — model chưa hề nhìn thấy tấm ảnh nào. Đặt nó cạnh model chạy thật rồi
    xếp hạng theo accuracy là so sánh sai bản chất: một bên đoán kém, một bên
    không chạy. Tách hẳn ra và ghi lý do.

    Ngưỡng 50%: dưới mức đó vẫn còn đủ ảnh để con số nói lên điều gì đó, nhưng
    phải gắn dấu (!) để người đọc biết mẫu đã bị khuyết.
    """
    measured = [m for m in summaries if m["errors"] < m["total"]]
    dead = [m for m in summaries if m["errors"] >= m["total"] and m["total"] > 0]

    for m in sorted(measured, key=lambda x: -x["accuracy"]):
        bad = m["errors"] / m["total"] if m["total"] else 0
        flag = " (!)" if bad >= 0.5 else ""
        print(f"{(m['model'] + flag)[:33]:<34}{m['accuracy']*100:>9.2f}%{m['macro_f1']:>10.4f}"
              f"{m['avg_latency_ms']:>9.0f}ms{m['correct']:>9}{m['wrong']:>8}{m['invalid']:>9}")
    for m in dead:
        print(f"{m['model'][:33]:<34}{'KHÔNG CHẠY ĐƯỢC — mọi lời gọi đều lỗi':>60}")
    print("=" * 104)

    # So từng ảnh giữa các biến thể — chỉ có nghĩa khi chạy từ 2 biến thể trở lên.
    if len(variant_list) > 1:
        print_variant_comparison(by_run)

    warn = [m for m in measured if m["total"] and m["errors"] / m["total"] >= 0.5]
    if warn or dead:
        print("\nCẢNH BÁO — những dòng dưới đây KHÔNG phải chất lượng nhận diện:")
        for m in warn:
            print(f"  (!) {m['model']}: {m['errors']}/{m['total']} lời gọi lỗi → "
                  f"số liệu chỉ dựa trên {m['total'] - m['errors']} ảnh, đừng đem so trực tiếp.")
        for m in dead:
            print(f"  ✗  {m['model']}: {m['errors']}/{m['total']} lời gọi lỗi, không đo được gì.")
        print("  Xem cột `error` trong predictions.csv để biết lý do cụ thể.")
    if blocked:
        print("\nModel bị bỏ qua từ đầu:")
        for name, why in blocked:
            print(f"  - {name}: {why}")
    print(f"\nSố liệu trên đo trên {len(subset)} ảnh test thật, "
          f"{'toàn bộ test set' if args.all else f'{args.per_class} ảnh mỗi class'}.")
    print(f"Kết quả chi tiết: {RESULTS}")
    for n in ["summary.csv", "predictions.csv", "per_class.csv"]:
        print(f"   - {n}")
    print("   - confusion_<model>.csv / .png")


if __name__ == "__main__":
    main()
