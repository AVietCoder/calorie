"""
adapters.py — các bộ nối tới từng model vision.

Mỗi adapter chỉ có MỘT việc: nhận ảnh + prompt, trả về chuỗi model nói ra.
Việc chấm điểm, so nhãn, tính metric nằm hết ở benchmark.py — adapter không
được biết đáp án, không được "sửa" câu trả lời cho đẹp.

Adapter nào thiếu khoá API thì tự báo không khả dụng kèm lý do, benchmark sẽ bỏ
qua và chạy tiếp các model còn lại.
"""
from __future__ import annotations

import base64
import os
import time
from dataclasses import dataclass


@dataclass
class Reply:
    """Kết quả MỘT lần gọi model."""
    text: str          # nguyên văn model trả về ('' nếu lỗi)
    latency_ms: float  # đo quanh đúng lời gọi mạng
    error: str = ""    # rỗng = không lỗi
    # Xác suất trung bình của các token model sinh ra (None nếu không xin
    # logprobs hoặc server không trả). Dùng để kiểm chứng xem "độ chắc chắn
    # thật" có dự đoán được lỗi không — KHÔNG dùng để sửa câu trả lời.
    avg_logprob: float | None = None
    min_logprob: float | None = None


def _b64(path: str) -> tuple[str, str]:
    ext = os.path.splitext(path)[1].lower()
    mime = "image/png" if ext == ".png" else "image/webp" if ext == ".webp" else "image/jpeg"
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii"), mime


def _logprob_stats(choice: dict) -> tuple[float | None, float | None]:
    """
    Bóc (logprob trung bình, logprob thấp nhất) trên các token model đã sinh.

    Dùng để trả lời một câu hỏi ĐO ĐƯỢC: model tự khai "confidence" thì có
    đáng tin không, hay xác suất token mới là thứ dự đoán được lỗi? Không có
    số này thì mọi ngưỡng "khi nào coi là không chắc" đều là bịa.

    Trả (None, None) nếu không xin logprobs hoặc server không trả — im lặng bỏ
    qua, vì đây là dữ liệu phụ, thiếu nó không được phép làm hỏng phép đo.
    """
    try:
        toks = (choice.get("logprobs") or {}).get("content") or []
        vals = [t["logprob"] for t in toks if isinstance(t.get("logprob"), (int, float))]
        if not vals:
            return None, None
        return sum(vals) / len(vals), min(vals)
    except Exception:                              # noqa: BLE001
        return None, None


# Lượt thử lại tối đa cho MỘT ảnh, và thời gian chờ giữa các lượt (giây).
MAX_TRIES = 4
BACKOFF = [2, 5, 12]


def post_retry(url, *, headers=None, json_body=None, timeout=180):
    """
    POST có thử lại cho lỗi TẠM THỜI (429 quá tải, 5xx, đứt mạng).

    Vì sao cần: lần chạy thật với gpt-4o-mini có 160/187 ảnh dính HTTP 429
    "Rate limit reached" — bản đầu không thử lại nên coi như hỏng luôn, bảng
    điểm ra 11.76% trong khi model chưa hề được đo tử tế. Lỗi hạn mức là lỗi
    NHỊP ĐỘ, chờ vài giây là qua; đánh trượt model vì nó là sai.

    KHÔNG thử lại lỗi 4xx khác (400 sai tham số, 401 sai khoá, 404 sai tên
    model) — những lỗi đó thử lại bao nhiêu lần cũng vậy, chỉ tốn thời gian.

    → (response|None, error_str, latency_ms của lượt CUỐI, số_lượt_đã_thử)
    """
    import requests

    last_err = ""
    for attempt in range(MAX_TRIES):
        t0 = time.perf_counter()
        try:
            r = requests.post(url, headers=headers, json=json_body, timeout=timeout)
            ms = (time.perf_counter() - t0) * 1000
            if r.status_code == 200:
                return r, "", ms, attempt + 1
            retryable = r.status_code == 429 or r.status_code >= 500
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
            if not retryable or attempt == MAX_TRIES - 1:
                return None, last_err, ms, attempt + 1
            # Máy chủ bảo chờ bao lâu thì nghe theo, không thì dùng backoff.
            wait = BACKOFF[min(attempt, len(BACKOFF) - 1)]
            try:
                wait = max(wait, float(r.headers.get("retry-after", 0)))
            except (TypeError, ValueError):
                pass
            time.sleep(wait)
        except Exception as e:                     # noqa: BLE001
            ms = (time.perf_counter() - t0) * 1000
            last_err = f"{type(e).__name__}: {e}"
            if attempt == MAX_TRIES - 1:
                return None, last_err, ms, attempt + 1
            time.sleep(BACKOFF[min(attempt, len(BACKOFF) - 1)])
    return None, last_err, 0.0, MAX_TRIES


class BaseAdapter:
    name = "base"

    def available(self) -> tuple[bool, str]:
        """(có chạy được không, lý do nếu không)"""
        return True, ""

    def preflight(self) -> tuple[bool, str]:
        """
        Kiểm tra MỘT lần trước khi đo hàng trăm ảnh.

        Vì sao có bước này: một lần chạy thật đã đốt trọn 187 ảnh chỉ để nhận
        đúng một câu lỗi lặp lại 187 lần ("model `qwen3-vl` does not exist"),
        rồi bảng điểm in ra 0.00% như thể model đoán sai hết. Sai tên model thì
        phải biết ngay từ giây đầu, chứ không phải sau vài phút.
        """
        return True, ""

    def predict(self, image_path: str, prompt: str, **overrides) -> Reply:
        """
        `overrides` để benchmark thử các BIẾN THỂ cách gọi (xem variants.py):
          params      — ghi đè ở cấp payload (temperature, max_tokens, logprobs…)
          extra_body  — ghi đè bên trong extra_body (mm_processor_kwargs…)

        Adapter của model NGOÀI được phép bỏ qua: mục tiêu là tinh chỉnh model
        của dự án, còn model ngoài chỉ đóng vai mốc so sánh nên phải giữ nguyên
        một cách gọi duy nhất — chỉnh tham số cho chúng thì hết công bằng.
        """
        raise NotImplementedError


# ─────────────────────────────────────────────────────────────────────────────
# 1. Model ĐANG DÙNG của dự án — vLLM, giao thức OpenAI-compatible.
#
# Gọi ĐÚNG như lib/vision.js đang gọi trong app thật: cùng model id, cùng
# temperature 0 / top_p 1 / seed 42, cùng mm_processor_kwargs độ phân giải. Lệch
# bất kỳ tham số nào là con số đo được không còn nói lên chất lượng model mà app
# thực sự dùng.
# ─────────────────────────────────────────────────────────────────────────────
class VLLMAdapter(BaseAdapter):
    # min/max pixels lấy từ lib/vision.js (QWEN_MIN_PIXELS / QWEN_MAX_PIXELS)
    MIN_PIXELS = 200704    # 448×448
    MAX_PIXELS = 3211264   # ~3.2 MP

    def __init__(self, name: str, model: str, base_url: str, api_key: str):
        self.name = name
        self.model = model
        self.base_url = base_url
        self.api_key = api_key or "EMPTY"

    def available(self):
        if not self.base_url:
            return False, "thiếu LLM_BASE_URL"
        return True, ""

    def preflight(self):
        """
        Hỏi /models xem id mình sắp gọi có tồn tại không, và LIỆT KÊ id có thật.

        vLLM đăng ký model theo `--served-model-name`, tên đó có thể chẳng liên
        quan gì tới trọng số đang nạp: server này khai id `qwen2.5-vl` nhưng
        root trỏ tới qwen3-vl-32b-instruct-fp8. Đổi id theo tên trọng số là
        404 ngay — nên báo thẳng danh sách id hợp lệ để khỏi phải đoán.
        """
        import requests
        try:
            r = requests.get(f"{self.base_url.rstrip('/')}/models",
                             headers={"Authorization": f"Bearer {self.api_key}"}, timeout=30)
            if r.status_code != 200:
                return False, f"không hỏi được /models: HTTP {r.status_code}"
            ids = [m["id"] for m in r.json().get("data", [])]
            if self.model in ids:
                return True, ""
            return False, (f"server không có model id '{self.model}'. "
                           f"Id có thật: {', '.join(ids) or '(rỗng)'}")
        except Exception as e:                     # noqa: BLE001
            return False, f"không kết nối được server: {type(e).__name__}: {e}"

    def predict(self, image_path: str, prompt: str, *, params=None, extra_body=None,
                **_) -> Reply:
        b64, mime = _b64(image_path)
        payload = {
            "model": self.model,
            "max_tokens": 64,          # chỉ cần một nhãn, không cần văn xuôi
            "temperature": 0,
            "top_p": 1,
            "seed": 42,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                    {"type": "text", "text": prompt},
                ],
            }],
            "extra_body": {
                "chat_template_kwargs": {"enable_thinking": False},
                "mm_processor_kwargs": {
                    "min_pixels": self.MIN_PIXELS,
                    "max_pixels": self.MAX_PIXELS,
                },
            },
        }
        # Biến thể ghi đè lên mốc. `seed: None` nghĩa là BỎ seed (cần khi lấy
        # nhiều mẫu khác nhau để bỏ phiếu — giữ seed thì 3 lượt ra y hệt nhau
        # và phép bỏ phiếu thành vô nghĩa).
        for k, v in (params or {}).items():
            if v is None:
                payload.pop(k, None)
            else:
                payload[k] = v
        for k, v in (extra_body or {}).items():
            payload["extra_body"][k] = v

        r, err, ms, _ = post_retry(
            f"{self.base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}",
                     "Content-Type": "application/json"},
            json_body=payload,
        )
        if r is None:
            return Reply("", ms, err)
        try:
            choice = r.json()["choices"][0]
            avg_lp, min_lp = _logprob_stats(choice)
            return Reply(choice["message"]["content"] or "", ms,
                         avg_logprob=avg_lp, min_logprob=min_lp)
        except Exception as e:                     # noqa: BLE001
            return Reply("", ms, f"phản hồi lạ: {type(e).__name__}: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# 2. OpenAI (gpt-4o, gpt-4o-mini…) — bật khi có OPENAI_API_KEY
# ─────────────────────────────────────────────────────────────────────────────
class OpenAIAdapter(BaseAdapter):
    def __init__(self, name: str, model: str):
        self.name = name
        self.model = model
        self.key = os.environ.get("OPENAI_API_KEY", "")

    def available(self):
        if not self.key:
            return False, "chưa đặt OPENAI_API_KEY"
        return True, ""

    def preflight(self):
        import requests
        try:
            r = requests.get("https://api.openai.com/v1/models",
                             headers={"Authorization": f"Bearer {self.key}"}, timeout=30)
            if r.status_code == 401:
                return False, "OPENAI_API_KEY không hợp lệ"
            if r.status_code != 200:
                return False, f"không hỏi được /models: HTTP {r.status_code}"
            ids = [m["id"] for m in r.json().get("data", [])]
            if self.model in ids:
                return True, ""
            vision = [i for i in ids if i.startswith(("gpt-4o", "gpt-4.1", "gpt-5", "o4"))]
            return False, (f"tài khoản không có model '{self.model}'. "
                           f"Vài id đang có: {', '.join(sorted(vision)[:6]) or ', '.join(ids[:6])}")
        except Exception as e:                     # noqa: BLE001
            return False, f"{type(e).__name__}: {e}"

    # Model đời mới của OpenAI bỏ `max_tokens`, đòi `max_completion_tokens`;
    # model cũ thì ngược lại. Dò MỘT lần rồi nhớ, khỏi hỏng ở mọi ảnh.
    _token_param = None

    def _body(self, b64, mime, prompt, token_param):
        body = {
            "model": self.model,
            token_param: 64,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                    {"type": "text", "text": prompt},
                ],
            }],
        }
        # Model đời mới cũng chỉ nhận temperature mặc định — gửi 0 là 400.
        if token_param == "max_tokens":
            body["temperature"] = 0
        return body

    def predict(self, image_path: str, prompt: str, **_) -> Reply:
        b64, mime = _b64(image_path)
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}

        order = ([self._token_param] if self._token_param
                 else ["max_tokens", "max_completion_tokens"])
        last_err, last_ms = "", 0.0
        for param in order:
            r, err, ms, _ = post_retry(url, headers=headers,
                                       json_body=self._body(b64, mime, prompt, param))
            last_err, last_ms = err, ms
            if r is not None:
                type(self)._token_param = param     # nhớ cho các ảnh sau
                try:
                    return Reply(r.json()["choices"][0]["message"]["content"] or "", ms)
                except Exception as e:              # noqa: BLE001
                    return Reply("", ms, f"phản hồi lạ: {type(e).__name__}: {e}")
            # Chỉ đổi sang tên tham số kia khi lỗi ĐÚNG là do tham số đó.
            if "max_completion_tokens" not in err and "max_tokens" not in err:
                break
        return Reply("", last_ms, last_err)


# ─────────────────────────────────────────────────────────────────────────────
# 3. Google Gemini — bật khi có GEMINI_API_KEY
# ─────────────────────────────────────────────────────────────────────────────
class GeminiAdapter(BaseAdapter):
    def __init__(self, name: str, model: str):
        self.name = name
        self.model = model
        self.key = os.environ.get("GEMINI_API_KEY", "") or os.environ.get("GOOGLE_API_KEY", "")

    def available(self):
        if not self.key:
            return False, "chưa đặt GEMINI_API_KEY"
        return True, ""

    def preflight(self):
        """Google gỡ model cũ khá nhanh — hỏi danh sách trước cho chắc."""
        import requests
        try:
            r = requests.get(
                f"https://generativelanguage.googleapis.com/v1beta/models?key={self.key}",
                timeout=30)
            if r.status_code != 200:
                return False, f"không hỏi được danh sách model: HTTP {r.status_code}"
            ids = [m["name"].replace("models/", "") for m in r.json().get("models", [])
                   if "generateContent" in m.get("supportedGenerationMethods", [])]
            if self.model in ids:
                return True, ""
            return False, (f"'{self.model}' không còn khả dụng. "
                           f"Vài id đang có: {', '.join(ids[:6])}")
        except Exception as e:                     # noqa: BLE001
            return False, f"{type(e).__name__}: {e}"

    def predict(self, image_path: str, prompt: str, **_) -> Reply:
        b64, mime = _b64(image_path)
        url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
               f"{self.model}:generateContent?key={self.key}")
        r, err, ms, _ = post_retry(url, json_body={
            "contents": [{"parts": [
                {"inline_data": {"mime_type": mime, "data": b64}},
                {"text": prompt},
            ]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": 64},
        })
        if r is None:
            return Reply("", ms, err)
        try:
            return Reply(r.json()["candidates"][0]["content"]["parts"][0]["text"] or "", ms)
        except Exception as e:                     # noqa: BLE001
            return Reply("", ms, f"phản hồi lạ: {type(e).__name__}: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# 4. Anthropic Claude — bật khi có ANTHROPIC_API_KEY
# ─────────────────────────────────────────────────────────────────────────────
class ClaudeAdapter(BaseAdapter):
    def __init__(self, name: str, model: str):
        self.name = name
        self.model = model
        self.key = os.environ.get("ANTHROPIC_API_KEY", "")

    def available(self):
        if not self.key:
            return False, "chưa đặt ANTHROPIC_API_KEY"
        return True, ""

    def predict(self, image_path: str, prompt: str, **_) -> Reply:
        b64, mime = _b64(image_path)
        r, err, ms, _ = post_retry(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": self.key,
                     "anthropic-version": "2023-06-01",
                     "Content-Type": "application/json"},
            json_body={
                "model": self.model,
                "max_tokens": 64,
                "temperature": 0,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {
                            "type": "base64", "media_type": mime, "data": b64}},
                        {"type": "text", "text": prompt},
                    ],
                }],
            },
        )
        if r is None:
            return Reply("", ms, err)
        try:
            return Reply(r.json()["content"][0]["text"] or "", ms)
        except Exception as e:                     # noqa: BLE001
            return Reply("", ms, f"phản hồi lạ: {type(e).__name__}: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# 5. Pipeline THẬT của app — gọi sang lib/vision.js qua một tiến trình Node.
#
# closed14 (chọn 1 trong 14 nhãn cho sẵn) chỉ là proxy. App thật hỏi MỞ ("món
# này là món gì") với prompt ~4000 token và guided_json, rồi trả tên tiếng Việt
# tự do. Điểm cao ở bài đóng không bảo đảm app thật nhận đúng — nên phải đo
# được cả đường thật, nếu không thì mọi cải tiến chỉ là cải tiến trên giấy.
# ─────────────────────────────────────────────────────────────────────────────
class AppPipelineAdapter(BaseAdapter):
    """Giữ MỘT tiến trình Node sống suốt lượt chạy, đẩy từng đường dẫn ảnh vào.

    Bật mỗi ảnh một tiến trình node thì riêng khởi động đã tốn hơn thời gian
    gọi model. Ở đây mở một lần, nói chuyện qua stdin/stdout theo dòng.
    """
    # Cờ cho benchmark biết: đầu ra là TÊN MÓN tự do, phải qua dish_map,
    # không dùng parse_label của bài đóng.
    uses_dish_map = True

    def __init__(self, name: str = "app-pipeline (lib/vision.js)"):
        self.name = name
        self.proc = None

    def available(self):
        import shutil
        if not shutil.which("node"):
            return False, "không thấy lệnh `node` trong PATH"
        if not (os.path.dirname(os.path.abspath(__file__)) and
                os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                            "app_pipeline.mjs"))):
            return False, "thiếu testmodel/app_pipeline.mjs"
        return True, ""

    def _start(self):
        import subprocess
        here = os.path.dirname(os.path.abspath(__file__))
        self.proc = subprocess.Popen(
            ["node", os.path.join(here, "app_pipeline.mjs")],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,      # log [vision:debug] rất dài, bỏ qua
            cwd=os.path.dirname(here), text=True, encoding="utf-8", bufsize=1,
        )

    def preflight(self):
        """Chạy thử một ảnh 1×1 để bắt lỗi cấu hình ngay, thay vì hỏng ở ảnh thứ 200."""
        try:
            self._start()
        except Exception as e:                     # noqa: BLE001
            return False, f"không khởi động được node: {type(e).__name__}: {e}"
        if self.proc.poll() is not None:
            return False, "tiến trình node tắt ngay khi khởi động"
        return True, ""

    def predict(self, image_path: str, prompt: str, **_) -> Reply:
        # prompt bị BỎ QUA có chủ đích: prompt của app nằm trong lib/vision.js.
        # Đó chính là thứ đang được đo — đưa prompt khác vào là đo nhầm.
        if self.proc is None or self.proc.poll() is not None:
            self._start()
        t0 = time.perf_counter()
        try:
            self.proc.stdin.write(os.path.abspath(image_path) + "\n")
            self.proc.stdin.flush()
            while True:
                line = self.proc.stdout.readline()
                if not line:
                    return Reply("", (time.perf_counter() - t0) * 1000,
                                 "tiến trình node đóng stdout giữa chừng")
                if line.startswith("@@R@@ "):
                    break
        except Exception as e:                     # noqa: BLE001
            return Reply("", (time.perf_counter() - t0) * 1000,
                         f"{type(e).__name__}: {e}")
        ms = (time.perf_counter() - t0) * 1000
        import json as _json
        try:
            obj = _json.loads(line[len("@@R@@ "):])
        except Exception as e:                     # noqa: BLE001
            return Reply("", ms, f"phản hồi lạ: {type(e).__name__}: {e}")
        if not obj.get("ok"):
            return Reply("", ms, obj.get("error", "lỗi không rõ"))
        if obj.get("is_food") is False:
            # Model bảo "đây không phải đồ ăn" — vẫn là một câu trả lời SAI cho
            # ảnh món ăn, không phải lỗi hệ thống. Để text rỗng → tính INVALID.
            return Reply("", ms)
        return Reply(obj.get("food", ""), ms)


def build_adapters(llm_base_url: str, llm_key: str, llm_model: str) -> list[BaseAdapter]:
    """
    Danh sách model đem đo.

    Model của dự án luôn đứng đầu. Ba model còn lại chỉ chạy khi có khoá tương
    ứng trong môi trường — không có thì benchmark ghi rõ "bỏ qua vì thiếu khoá"
    chứ KHÔNG bịa số.
    """
    return [
        VLLMAdapter("project-vllm (" + llm_model + ")", llm_model, llm_base_url, llm_key),
        # Pipeline thật của app. KHÔNG tự chạy trong lượt mặc định (chậm hơn
        # hẳn vì sinh JSON dinh dưỡng đầy đủ) — gọi bằng --models app-pipeline.
        AppPipelineAdapter(),
        # Hai id dưới đã kiểm là CÓ THẬT với khoá đang dùng. Muốn thử model khác
        # thì sửa ngay dòng này — preflight sẽ báo id sai kèm danh sách id thật
        # ngay giây đầu, không đốt cả trăm ảnh rồi mới biết.
        OpenAIAdapter("openai-gpt-4o-mini", "gpt-4o-mini"),
        GeminiAdapter("gemini-2.5-flash", "gemini-2.5-flash"),
        ClaudeAdapter("claude-sonnet-4", "claude-sonnet-4-20250514"),
    ]
