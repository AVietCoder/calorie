"""
analyze_gate.py — "khi nào thì coi là model không chắc?" phải trả lời bằng SỐ.

Cascade (gọi thêm lượt 2 khi nghi ngờ) chỉ đáng làm nếu có cách phát hiện ảnh
sắp sai. Ở đây kiểm hai ứng viên làm cổng, trên cache đã đo được:

  1. logprob trung bình của các token model sinh ra  (xác suất THẬT)
  2. trường "confidence" model tự khai               (lời model tự nói)

Tự đặt ngưỡng rồi bảo "cái này hợp lý" là bịa. Cổng chỉ có giá trị khi nó BẮT
được phần lớn lỗi mà KHÔNG kéo theo quá nhiều ảnh vốn đã đúng — vì mỗi ảnh bị
bắt là một lời gọi mạng nữa.

Chạy:
    py testmodel/analyze_gate.py                       # cache 'base'
    py testmodel/analyze_gate.py --variant gloss
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
CACHE = HERE / "results" / "cache"


def load(variant: str) -> list[dict]:
    files = sorted(CACHE.glob(f"*__{variant}.jsonl"))
    if not files:
        raise SystemExit(f"Không thấy cache cho biến thể '{variant}' trong {CACHE}")
    rows = []
    for p in files:
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.strip():
                try:
                    rows.append(json.loads(line))
                except Exception:              # noqa: BLE001
                    pass
    return rows


def pctl(vals: list[float], q: float) -> float:
    s = sorted(vals)
    return s[min(len(s) - 1, int(q * len(s)))] if s else float("nan")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default="base")
    args = ap.parse_args()

    rows = load(args.variant)
    ok = [r for r in rows if r["pred_id"] == r["class_id"]]
    bad = [r for r in rows if r["pred_id"] != r["class_id"]]
    print(f"Biến thể '{args.variant}': {len(rows)} ảnh — đúng {len(ok)}, sai {len(bad)}")
    if not bad:
        print("Không có ảnh nào sai → không có gì để xây cổng. Cascade vô nghĩa ở mẫu này.")
        return
    if not ok:
        print("Không có ảnh nào đúng → mẫu hỏng, dừng.")
        return

    lp_ok = [r["avg_logprob"] for r in ok if r.get("avg_logprob") is not None]
    lp_bad = [r["avg_logprob"] for r in bad if r.get("avg_logprob") is not None]
    if not lp_ok or not lp_bad:
        print("\nCache không có avg_logprob → chạy lại biến thể có bật logprobs.")
        return

    print("\n── Cổng 1: logprob trung bình của token sinh ra ──")
    print(f"  ảnh ĐÚNG (n={len(lp_ok):>3}): p10 {pctl(lp_ok,.10):+.4f}  "
          f"trung vị {pctl(lp_ok,.50):+.4f}  p90 {pctl(lp_ok,.90):+.4f}")
    print(f"  ảnh SAI  (n={len(lp_bad):>3}): p10 {pctl(lp_bad,.10):+.4f}  "
          f"trung vị {pctl(lp_bad,.50):+.4f}  p90 {pctl(lp_bad,.90):+.4f}")
    print("  (logprob càng gần 0 = model càng chắc. Muốn cổng có ích thì hai hàng")
    print("   trên phải TÁCH nhau; chồng lên nhau nghĩa là logprob không phân biệt được.)")

    print("\n  Ngưỡng            bắt ? / tổng ảnh   bắt được ? / lỗi   nhiễu (ảnh đúng bị bắt)")
    print("  " + "-" * 76)
    cand = sorted({round(pctl(lp_bad, q), 4) for q in (.5, .6, .7, .8, .9)} |
                  {round(pctl(lp_ok, q), 4) for q in (.05, .1, .2)})
    best = None
    for th in cand:
        gated = [r for r in rows if (r.get("avg_logprob") is not None
                                     and r["avg_logprob"] < th)]
        if not gated:
            continue
        caught = sum(1 for r in gated if r["pred_id"] != r["class_id"])
        noise = len(gated) - caught
        print(f"  avg_logprob < {th:+.4f}   {len(gated):>3}/{len(rows)} "
              f"({100*len(gated)/len(rows):>4.1f}%)      "
              f"{caught:>3}/{len(bad)} ({100*caught/len(bad):>4.1f}%)        {noise:>3}")
        # "Tốt" = bắt nhiều lỗi, ít kéo theo ảnh đúng, và không gọi lại quá 30% ảnh.
        score = caught / len(bad) - 0.5 * noise / len(ok)
        if len(gated) / len(rows) <= 0.30 and (best is None or score > best[1]):
            best = (th, score, len(gated), caught, noise)

    print("\n── Cổng 2: trường \"confidence\" model tự khai ──")
    confs = {}
    for r in rows:
        c = (r.get("confidence") or "").strip().lower() or "(không có)"
        d = confs.setdefault(c, [0, 0])
        d[0] += 1
        d[1] += 0 if r["pred_id"] == r["class_id"] else 1
    if set(confs) == {"(không có)"}:
        print("  Biến thể này không xin 'confidence' → chỉ biến thể 'cascade' có số này.")
    else:
        for c, (n, e) in sorted(confs.items()):
            print(f"  {c:<12} {n:>4} ảnh, sai {e:>3} ({100*e/n:>5.1f}%)")
        print("  (Cổng chỉ dùng được nếu tỉ lệ sai của 'medium'/'low' CAO HƠN HẲN 'high'.")
        print("   Nếu model khai 'high' cho gần hết ảnh thì lời tự khai đó vô dụng.)")

    print("\n── Kết luận ──")
    if best:
        th, _score, ng, caught, noise = best
        print(f"  Ngưỡng đáng dùng nhất trong khung ≤30% ảnh: avg_logprob < {th:+.4f}")
        print(f"    → gọi lại {ng}/{len(rows)} ảnh ({100*ng/len(rows):.1f}%), "
              f"bắt được {caught}/{len(bad)} lỗi, kéo theo {noise} ảnh vốn đã đúng.")
        print(f"    TRẦN TRÊN của cascade: cho dù lượt 2 sửa đúng HẾT phần bắt được,")
        print(f"    accuracy cũng chỉ lên tối đa "
              f"{100*(len(ok)+caught)/len(rows):.2f}% (hiện {100*len(ok)/len(rows):.2f}%).")
        print("    Con số đó là trần, không phải kết quả — lượt 2 không bao giờ sửa đúng hết.")
    else:
        print("  Không ngưỡng nào vừa bắt được lỗi vừa giữ dưới 30% ảnh phải gọi lại.")
        print("  → cổng theo logprob KHÔNG dùng được trên mẫu này; đừng xây cascade lên nó.")


if __name__ == "__main__":
    main()
