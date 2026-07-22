#!/usr/bin/env bash
# =============================================================================
#  start-llm.sh — Serve a vision-language LLM on your H100 with vLLM,
#                 exposing an OpenAI-compatible API for the calorie app.
#
#  Run this ON THE SERVER (after `ssh -p 61543 root@103.73.232.112 ...`).
#  See vllm-server/README.md for the full step-by-step guide.
#
#  IMPORTANT — DRIVER / CUDA:
#  This box has NVIDIA driver 550.54.15 -> supports CUDA 12.4 only.
#  The latest vLLM (needed for Qwen3-VL) ships PyTorch built for CUDA 12.6/12.8
#  and will FAIL with "driver is too old". So we pin a CUDA-12.4-compatible
#  stack (vLLM 0.8.5 + torch 2.6 cu124) and use Qwen2.5-VL.
#  If you can get a newer driver image (>=570 / CUDA 12.8), you may instead use
#  the latest vLLM + Qwen/Qwen3-VL-8B-Instruct (see README section 8).
# =============================================================================
set -euo pipefail

# --- 1) Persist big files on your mounted network volume -------------------
#     CHANGE THIS to the real mount path (your server uses /network-volume).
export NETWORK_VOLUME="${NETWORK_VOLUME:-/network-volume}"
export HF_HOME="${HF_HOME:-$NETWORK_VOLUME/huggingface}"
mkdir -p "$HF_HOME"

# --- 2) Which model to serve ----------------------------------------------
# Qwen2.5-VL-7B-Instruct: vision + text, good Vietnamese, JSON output,
# runs comfortably on a single H100 80GB with the CUDA-12.4 stack below.
# Higher quality (still single H100): Qwen/Qwen2.5-VL-32B-Instruct
MODEL_ID="${MODEL_ID:-Qwen/Qwen2.5-VL-7B-Instruct}"

# This short name is what the calorie app sends as `model`. Keep it in sync
# with LLM_MODEL / LLM_VISION_MODEL in the app's .env.
SERVED_NAME="${SERVED_NAME:-qwen2.5-vl}"

# --- 3) Network: bind so the app (and Vercel) can reach it -----------------
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-4444}"

# --- 4) Security: protect the public endpoint with a token -----------------
# Put the SAME value into LLM_API_KEY in the app's .env. Generate: openssl rand -hex 24
VLLM_API_KEY="${VLLM_API_KEY:-change-me-please}"

# --- 5) Launch -------------------------------------------------------------
echo "▶ Serving $MODEL_ID  as '$SERVED_NAME'  on $HOST:$PORT"
echo "  HF cache: $HF_HOME"

# mm-processor-kwargs: max_pixels 3211264 (~3.2MP, = 448*448*16) — nâng từ 2MP
# để model ĐẾM tốt các vật thể nhỏ (nhiều miếng sushi/bánh trong 1 ảnh).
# H100 80GB dư VRAM cho mức này; sau khi nâng hãy đo lại latency + VRAM
# (nvidia-smi), nếu chậm/OOM thì hạ về 2007040. Client cũng có thể override
# per-request qua env QWEN_MAX_PIXELS ở app Vercel.
exec vllm serve "$MODEL_ID" \
  --served-model-name "$SERVED_NAME" \
  --host "$HOST" \
  --port "$PORT" \
  --api-key "$VLLM_API_KEY" \
  --dtype bfloat16 \
  --max-model-len 32768 \
  --gpu-memory-utilization 0.90 \
  --mm-processor-kwargs '{"min_pixels": 200704, "max_pixels": 3211264}' \
  --trust-remote-code
