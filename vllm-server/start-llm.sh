#!/usr/bin/env bash
# =============================================================================
#  start-llm.sh — Serve Qwen2.5-VL-32B-Instruct on your H100 with vLLM,
#                 tuned for SPEED, exposing an OpenAI-compatible API.
#
#  MODEL: Qwen2.5-VL-32B-Instruct (BF16). Cùng dòng Qwen2.5-VL nên app KHÔNG
#  phải sửa (served-model-name vẫn "qwen2.5-vl").
#
#  DRIVER/CUDA: máy này driver 550 -> CUDA 12.4 -> vLLM 0.8.5 + torch cu124 +
#  transformers 4.51.3 (xem install-vllm.sh). Không đổi.
#
#  QUY TRÌNH: chạy prepare-model.sh MỘT LẦN (tải + vá config) rồi chạy script này.
#
#  TỐI ƯU TỐC ĐỘ (đã bật sẵn):
#   --enable-prefix-caching : cache phần prompt hệ thống tĩnh (rất dài) -> các
#                             lượt sau bỏ qua bước tính lại -> phản hồi nhanh hơn nhiều.
#   --kv-cache-dtype fp8    : KV cache 8-bit -> tiết kiệm VRAM (quan trọng vì 32B
#                             rất sát trần 80GB) + cho context dài hơn / nhiều
#                             request song song hơn.
#   --mm-processor-kwargs   : giới hạn độ phân giải ảnh (max_pixels) -> ít token
#                             ảnh hơn -> nhận diện ảnh NHANH hơn nhiều (vẫn đủ nét
#                             cho món ăn). Mặc định Qwen có thể lên tới ~16k token/ảnh.
# =============================================================================
set -euo pipefail

export NETWORK_VOLUME="${NETWORK_VOLUME:-/network-volume}"
export HF_HOME="${HF_HOME:-$NETWORK_VOLUME/huggingface}"
mkdir -p "$HF_HOME"

# Thư mục model đã tải + vá bởi prepare-model.sh (KHÔNG dùng tên repo trực tiếp,
# vì cần config đã vá rope_scaling).
MODEL_ID="${MODEL_ID:-$NETWORK_VOLUME/models/qwen2.5-vl-32b}"

# Alias app gọi. Giữ "qwen2.5-vl" để .env của app khỏi đổi.
SERVED_NAME="${SERVED_NAME:-qwen2.5-vl}"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-4444}"
VLLM_API_KEY="${VLLM_API_KEY:-change-me-please}"

echo "▶ Serving $MODEL_ID  as '$SERVED_NAME'  on $HOST:$PORT  (tuned for speed)"

exec vllm serve "$MODEL_ID" \
  --served-model-name "$SERVED_NAME" \
  --host "$HOST" \
  --port "$PORT" \
  --api-key "$VLLM_API_KEY" \
  --dtype bfloat16 \
  --max-model-len 16384 \
  --gpu-memory-utilization 0.92 \
  --kv-cache-dtype fp8 \
  --enable-prefix-caching \
  --mm-processor-kwargs '{"min_pixels": 200704, "max_pixels": 1003520}' \
  --trust-remote-code

# ───────────────────────────────────────────────────────────────────────────
# NẾU BỊ OOM lúc khởi động (32B rất sát 80GB), hạ dần theo thứ tự:
#   1) bỏ bớt context:        --max-model-len 8192
#   2) hạ mức dùng VRAM:       --gpu-memory-utilization 0.90
#   3) (nếu fp8 KV lỗi) bỏ:    --kv-cache-dtype fp8
# NẾU MUỐN ẢNH NÉT HƠN (chậm hơn): tăng max_pixels (vd 1605632 ~ 2048 token/ảnh).
# NẾU vLLM KHÔNG nhận quantization nào: 32B là BF16 nên không cần --quantization.
# ───────────────────────────────────────────────────────────────────────────
