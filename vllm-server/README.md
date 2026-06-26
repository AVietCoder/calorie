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
- Một thư mục **network-volume** đã mount (lưu weight model). Cần ~50GB trống cho bản 72B-AWQ.
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

App vẫn chạy tốt nếu **không** làm bước này (RAG tự lùi về tìm kiếm từ khoá, đủ tốt
cho kho 63 đoạn có định tuyến theo bệnh). Chỉ bật nếu muốn tìm kiếm theo ngữ nghĩa.

**Vì GPU đã đầy vì model chat 32B (~79/81GB), chạy embedding TRÊN CPU** (không đụng GPU):

1. Bật embedding server trên CPU (cổng 3333), chạy nền:
   ```bash
   export NETWORK_VOLUME=/network-volume
   export VLLM_API_KEY=656261a19e127d69f618267d7b47123045603fb5d0cc6c5f
   nohup bash vllm-server/start-embeddings-cpu.sh > $NETWORK_VOLUME/embed.log 2>&1 &
   tail -f $NETWORK_VOLUME/embed.log     # chờ thấy "[embed] ready."
   ```
   Lần đầu nó tải bge-m3 (~2GB) và tạo venv CPU riêng (tách biệt, không ảnh hưởng vLLM).

2. (Khuyên làm) Nhúng sẵn 63 đoạn kiến thức MỘT LẦN để khỏi nhúng lúc chạy:
   ```bash
   # chạy trong thư mục app, khi embedding server đang chạy
   EMBEDDING_BASE_URL=http://localhost:3333/v1    EMBEDDING_API_KEY=$VLLM_API_KEY    EMBEDDING_MODEL=bge-m3    node scripts/ingest-knowledge.mjs
   ```
   Lệnh này ghi vector bge-m3 vào `knowledge/knowledge-base.json` (rồi deploy lại).

3. Thêm vào `.env` của app:
   ```
   EMBEDDING_BASE_URL=http://103.73.232.112:3333/v1
   EMBEDDING_API_KEY=656261a19e127d69f618267d7b47123045603fb5d0cc6c5f
   EMBEDDING_MODEL=bge-m3
   ```

> Muốn chạy embedding trên GPU thay vì CPU: chỉ khả thi khi GPU còn trống (vd đổi
> chat model sang 72B-AWQ ~40GB sẽ dư chỗ) — khi đó dùng `start-embeddings.sh`.

## 8. Mẹo & xử lý lỗi thường gặp

- **Model mạnh (mặc định hiện tại): Qwen2.5-VL-72B-Instruct-AWQ.** Bản nén 4-bit
  (~40GB) — model MẠNH NHẤT dòng Qwen2.5-VL chạy được trên 1× H100 80GB, còn dư
  bộ nhớ cho KV cache. Cùng dòng nên app không phải sửa.
  + 72B chậm hơn 7B (vài giây ~ chục giây mỗi ảnh). Muốn nhanh hơn: hạ
    `--max-model-len` (vd 8192), hoặc giảm độ phân giải ảnh — đặt biến môi trường
    khi serve: `VLLM_QWEN2_VL_MAX_PIXELS` nhỏ hơn (vd `1003520`), hoặc resize ảnh
    phía client trước khi gửi.
  + Nếu vLLM không tự nhận AWQ: thêm `--quantization awq_marlin` (hoặc `--quantization awq`).
- **Bản 32B (BF16):** `Qwen/Qwen2.5-VL-32B-Instruct` ~64GB, RẤT sát trần 80GB, dễ
  OOM khi xử lý ảnh và KHÔNG có bản AWQ chính thức → không khuyến nghị trên 1 card.
- **Quay lại 7B (nhẹ, nhanh):** đặt
  `MODEL_REPO=Qwen/Qwen2.5-VL-7B-Instruct MODEL_DIR=/network-volume/models/qwen2.5-vl-7b bash vllm-server/prepare-model.sh`
  rồi serve `MODEL_ID=/network-volume/models/qwen2.5-vl-7b ... --dtype bfloat16`.
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
- **`CUDA out of memory` / GPU gần như không còn trống (vài MB free):** tiến trình
  vLLM cũ còn sót đang giữ VRAM. Sửa: `pkill -9 -f vllm; pkill -9 -f EngineCore` rồi
  `nvidia-smi` kiểm tra GPU đã trống chưa, sau đó chạy lại. Thêm
  `export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` để giảm phân mảnh.
- **OOM (hết VRAM):** giảm `--max-model-len` và/hoặc `--gpu-memory-utilization`.
- **Lỗi không nhận `response_format: json_object`:** vLLM bản mới hỗ trợ sẵn; hãy
  `pip install -U vllm` để cập nhật.
- **Gọi từ ngoài không được nhưng localhost được:** kiểm tra đã `--host 0.0.0.0`
  chưa, và cổng bạn bind có đúng là cổng đã public không.
- **Giữ server chạy nền:** dùng `tmux` (như bước 4) hoặc `nohup bash vllm-server/start-llm.sh > vllm.log 2>&1 &`.
- **Bảo mật:** luôn đặt `--api-key`. Endpoint đang public, không nên để trống.
