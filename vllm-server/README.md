# Hướng dẫn dựng vLLM trên server H100 (biến server thành API LLM)

Tài liệu này hướng dẫn bạn chạy **vLLM** trên con server H100 của bạn để nó hoạt
động như một **API tương thích OpenAI**. Sau khi xong, app `calorie-main` sẽ gọi
model local thay cho OpenAI mà **không cần đổi code** (chỉ cần đổi vài biến môi trường).

> Ý tưởng cốt lõi: vLLM nói **đúng "ngôn ngữ" HTTP của OpenAI** (`/v1/chat/completions`,
> `/v1/embeddings`...). Nên app vẫn dùng thư viện `openai` như cũ — ta chỉ trỏ
> `baseURL` về server của bạn và đặt một API key tuỳ ý.

---

## ⚠️ Lưu ý quan trọng về driver (đọc trước)

Server của bạn có driver **550.54.15 → chỉ hỗ trợ CUDA 12.4**. vLLM mới nhất (bản
chạy Qwen3-VL) đi kèm PyTorch cho CUDA 12.6/12.8 nên sẽ báo lỗi *"NVIDIA driver
is too old"*. Vì vậy hướng dẫn này dùng **vLLM 0.8.5 + PyTorch 2.6 (cu124)** khớp
đúng driver, và model **Qwen2.5-VL** (Qwen3-VL cần vLLM ≥ 0.11). Nếu bạn xin được
image driver mới hơn (≥ 570 / CUDA 12.8) thì có thể quay lại dùng vLLM mới nhất +
Qwen3-VL (xem mục 8).

## 0. Yêu cầu

- 1× NVIDIA H100 80GB (bạn đang có — quá dư cho model 8B).
- CUDA 12.4, driver 550.x (server của bạn đã có sẵn).
- Một thư mục **network-volume** đã mount (để lưu weight model cho khỏi tải lại).
- Cổng public: bạn nói `103.73.232.112:3333` và `:4444` đã public.
  → Ta sẽ chạy model chat ở **4444**, (tuỳ chọn) embeddings ở **3333**.

---

## 1. SSH vào server

```bash
ssh -p 61543 root@103.73.232.112 -i ~/.ssh/id_rsa
```

Kiểm tra GPU:

```bash
nvidia-smi
```

---

## 2. Chuẩn bị thư mục trên network-volume

Đổi `/workspace/network-volume` thành **đường dẫn thật** thư mục bạn đã mount.

```bash
# Đặt biến này cho cả phiên làm việc
export NETWORK_VOLUME=/workspace/network-volume    # <-- SỬA cho đúng

# Cache của Hugging Face (weight model) nằm trên volume để không mất khi restart
export HF_HOME=$NETWORK_VOLUME/huggingface
mkdir -p "$HF_HOME"
```

> Vì sao? Model 8B nặng ~16GB. Để trên volume thì lần sau khởi động lại container
> không phải tải lại từ đầu.

---

## 3. Cài vLLM (vào 1 virtualenv nằm trên volume cho bền)

Dùng **uv** (không dùng pip hệ thống) và cài bản vLLM khớp CUDA 12.4.
Cách nhanh nhất là chạy script kèm theo:

```bash
export NETWORK_VOLUME=/network-volume      # <-- SỬA cho đúng (máy bạn là /network-volume)
bash vllm-server/install-vllm.sh
```

Hoặc làm tay:

```bash
# Cài uv (standalone, khỏi cần pip hệ thống)
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

# Tạo venv SẠCH trên volume
rm -rf $NETWORK_VOLUME/vllm-venv
uv venv --python 3.10 $NETWORK_VOLUME/vllm-venv
source $NETWORK_VOLUME/vllm-venv/bin/activate

# vLLM 0.8.5 + torch 2.6 build cho CUDA 12.4 (khớp driver 550)
uv pip install "vllm==0.8.5" --torch-backend=cu124

# Kiểm tra torch THẤY GPU (đây là chỗ trước đó bị lỗi)
python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
# Kỳ vọng in ra: 2.6.0+cu124 12.4 True
```

> Lần sau muốn dùng lại, chỉ cần:
> `source $NETWORK_VOLUME/vllm-venv/bin/activate`

---

## 4. Chạy server LLM

Bạn có thể chạy bằng script kèm theo (khuyên dùng) hoặc gõ lệnh tay.

> **Quan trọng:** với stack CUDA 12.4 (vLLM 0.8.5), trước khi serve hãy chạy
> `bash vllm-server/prepare-model.sh` một lần để tải + vá config model (tránh lỗi
> `rope_type`/`mrope`). Sau đó serve bằng thư mục local:
> `MODEL_ID=/network-volume/models/qwen2.5-vl-7b bash vllm-server/start-llm.sh`.

### Cách A — Dùng script (đã kèm trong `vllm-server/start-llm.sh`)

Copy thư mục `vllm-server/` lên server (hoặc copy nội dung script), rồi:

```bash
# Tạo 1 token bảo mật cho API (để người ngoài không gọi chùa server của bạn)
export VLLM_API_KEY=$(openssl rand -hex 24)
echo "API KEY của bạn (lưu lại!): $VLLM_API_KEY"

export NETWORK_VOLUME=/workspace/network-volume   # <-- SỬA cho đúng
source $NETWORK_VOLUME/vllm-venv/bin/activate

# Chạy trong tmux để thoát SSH không bị tắt server
tmux new -s vllm
bash vllm-server/start-llm.sh
# (thoát tmux mà vẫn để chạy: nhấn Ctrl+B rồi D)
```

### Cách B — Gõ lệnh tay

```bash
source $NETWORK_VOLUME/vllm-venv/bin/activate
export VLLM_API_KEY=$(openssl rand -hex 24); echo "KEY: $VLLM_API_KEY"

vllm serve Qwen/Qwen2.5-VL-7B-Instruct \
  --served-model-name qwen2.5-vl \
  --host 0.0.0.0 \
  --port 4444 \
  --api-key "$VLLM_API_KEY" \
  --dtype bfloat16 \
  --max-model-len 32768 \
  --gpu-memory-utilization 0.90 \
  --trust-remote-code
```

Lần đầu nó sẽ **tải model (~16GB)** về `$HF_HOME` — chờ vài phút. Khi thấy dòng
kiểu `Uvicorn running on http://0.0.0.0:4444` là server đã sẵn sàng.

> **Về cổng:** nếu nền tảng thuê máy của bạn map cổng public `4444` sang một cổng
> *nội bộ khác* trong container, hãy đổi `--port` thành cổng nội bộ đó. Mục tiêu là
> truy cập được qua `http://103.73.232.112:4444`.

---

## 5. Kiểm tra API đã chạy

Mở một SSH/tab khác (vẫn trên server) và chạy:

```bash
# Liệt kê model
curl http://localhost:4444/v1/models -H "Authorization: Bearer $VLLM_API_KEY"
```

Hoặc dùng script test kèm theo (test cả text lẫn ảnh):

```bash
BASE=http://localhost:4444 KEY=$VLLM_API_KEY MODEL=qwen2.5-vl bash vllm-server/test-llm.sh
```

Từ **máy của bạn** (không phải server), test qua IP public:

```bash
curl http://103.73.232.112:4444/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer DÁN_API_KEY_VÀO_ĐÂY" \
  -d '{"model":"qwen2.5-vl","messages":[{"role":"user","content":"Xin chào"}],"max_tokens":50}'
```

Nếu trả về JSON có `choices[0].message.content` → 🎉 server của bạn đã là một API LLM.

---

## 6. Nối app `calorie-main` vào server

Trong app, mở file `.env` (copy từ `.env.example`) và điền:

```bash
LLM_BASE_URL=http://103.73.232.112:4444/v1
LLM_API_KEY=DÁN_API_KEY_BƯỚC_4
LLM_MODEL=qwen2.5-vl
LLM_VISION_MODEL=qwen2.5-vl
```

- Chạy local: `npm install` rồi chạy như bình thường.
- Deploy trên Vercel: vào **Project → Settings → Environment Variables** thêm đúng
  4 biến trên (Vercel không gọi được `localhost`, nên **bắt buộc** dùng IP public).

Xong! Mọi tác vụ AI (phân tích ảnh món ăn, chat dinh dưỡng, sinh thực đơn 7 ngày)
giờ chạy bằng model local trên H100 của bạn.

---

## 7. (TUỲ CHỌN) Bật RAG ngữ nghĩa bằng embeddings

App vẫn chạy tốt nếu **không** làm bước này (RAG tự lùi về tìm kiếm từ khoá).
Nếu muốn tìm kiếm "thông minh" theo ngữ nghĩa trên kho kiến thức bệnh lý:

1. Hạ bộ nhớ cho model chat để chừa chỗ cho model embedding (sửa ở bước 4):
   `--gpu-memory-utilization 0.75`
2. Chạy thêm server embedding (cổng 3333):
   ```bash
   source $NETWORK_VOLUME/vllm-venv/bin/activate
   bash vllm-server/start-embeddings.sh      # phục vụ BAAI/bge-m3
   ```
3. Thêm vào `.env` của app:
   ```bash
   EMBEDDING_BASE_URL=http://103.73.232.112:3333/v1
   EMBEDDING_API_KEY=DÁN_API_KEY
   EMBEDDING_MODEL=bge-m3
   ```
4. (Tuỳ chọn) Nhúng sẵn kho kiến thức gốc để chính xác hơn:
   ```bash
   # chạy ở thư mục app
   node scripts/ingest-knowledge.mjs
   ```

---

## 8. Mẹo & xử lý lỗi thường gặp

- **Muốn chất lượng cao hơn (trên stack CUDA 12.4 này)?** Đổi `MODEL_ID` sang
  `Qwen/Qwen2.5-VL-32B-Instruct` (vẫn vừa 1 H100 80GB). Nếu thiếu VRAM, giảm
  `--max-model-len` xuống `16384` hoặc hạ `--gpu-memory-utilization`.
- **Muốn dùng Qwen3-VL?** Cần driver mới hơn (≥ 570 / CUDA 12.8). Xin nền tảng
  thuê máy đổi image driver mới, rồi cài vLLM mới nhất:
  `uv pip install -U vllm --torch-backend=auto` và đổi `MODEL_ID` thành
  `Qwen/Qwen3-VL-8B-Instruct`, `SERVED_NAME=qwen3-vl` (nhớ sửa `.env` cho khớp).
- **Lỗi `Found conflicts between 'rope_type=default' and 'type=mrope'`:** config
  model mới không hợp với vLLM 0.8.5. Sửa: tải model về & vá config bằng
  `bash vllm-server/prepare-model.sh`, rồi chạy
  `MODEL_ID=/network-volume/models/qwen2.5-vl-7b bash vllm-server/start-llm.sh`.
- **`ModuleNotFoundError: No module named 'setuptools'`:** venv của uv tối giản,
  thiếu setuptools mà Triton cần. Sửa: `uv pip install setuptools wheel`.
- **`Qwen2Tokenizer has no attribute all_special_tokens_extended`:** transformers
  5.x quá mới cho vLLM 0.8.5. Sửa: `uv pip install "transformers==4.51.3"`.
- **OOM (hết VRAM):** giảm `--max-model-len` và/hoặc `--gpu-memory-utilization`.
- **Lỗi không nhận `response_format: json_object`:** vLLM bản mới hỗ trợ sẵn; hãy
  `pip install -U vllm` để cập nhật.
- **Gọi từ ngoài không được nhưng localhost được:** kiểm tra đã `--host 0.0.0.0`
  chưa, và cổng bạn bind có đúng là cổng đã public không.
- **Giữ server chạy nền:** dùng `tmux` (như bước 4) hoặc `nohup bash vllm-server/start-llm.sh > vllm.log 2>&1 &`.
- **Bảo mật:** luôn đặt `--api-key`. Endpoint đang public, không nên để trống.

---

## 9. Sử dụng Qwen2.5-VL-32B-Instruct (model bạn đang dùng)

Khi chạy **Qwen2.5-VL-32B-Instruct** (thay vì 7B), cần lưu ý thêm:

### Lệnh khởi động cho 32B
```bash
vllm serve Qwen/Qwen2.5-VL-32B-Instruct \
  --served-model-name Qwen2.5-VL-32B-Instruct \
  --host 0.0.0.0 \
  --port 4444 \
  --api-key "$VLLM_API_KEY" \
  --dtype bfloat16 \
  --max-model-len 16384 \
  --gpu-memory-utilization 0.92 \
  --trust-remote-code
```
> 32B cần ~65GB VRAM; H100 80GB vừa đủ với `--gpu-memory-utilization 0.92`.
> Nếu báo OOM, giảm `--max-model-len` xuống `8192`.

### Cấu hình .env
```
LLM_MODEL=Qwen2.5-VL-32B-Instruct
LLM_VISION_MODEL=Qwen2.5-VL-32B-Instruct
```
> Tên phải KHỚP CHÍNH XÁC với `--served-model-name` bạn truyền vào lệnh `vllm serve`.

### Vì sao 32B hay "quên" hiện thẻ xác nhận bữa ăn
Model 32B Instruct kích hoạt **thinking mode** (sinh ra `<think>...</think>` trước JSON).
Điều này khiến `JSON.parse` thất bại → toàn bộ `mealData` bị mất → thẻ chọn bữa không hiện.

**Đã xử lý trong code (v8+):**
1. `stripThinkBlocks()` — loại bỏ `<think>...</think>` trước khi parse JSON (trong `api/chat.js` và `api/analyze-food.js`).
2. Prompt kết thúc bằng `/no_think` — token đặc biệt trong chat template của Qwen, ra lệnh cho model bỏ qua thinking mode.
3. `newPlan` prompt rule — model được nhắc rõ PHẢI giữ nguyên plan cũ khi `analyze_only`/`ask_clarify` (không trả `[]`).
