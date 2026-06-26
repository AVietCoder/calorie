#!/usr/bin/env bash
# =============================================================================
#  start-embeddings.sh — (OPTIONAL) Serve an embedding model with vLLM so the
#  app's RAG can do semantic search instead of keyword-only search.
#
#  Skip this if you don't need semantic RAG — the app works fine without it.
#
#  IMPORTANT: this is a SECOND vLLM process sharing the SAME GPU as the chat
#  model. To leave room, start the chat model (start-llm.sh) with a lower
#  --gpu-memory-utilization (e.g. 0.75), then run this one (it's tiny).
# =============================================================================
set -euo pipefail

# ⚠️ LƯU Ý: nếu GPU đã đầy vì model chat (vd 32B chiếm ~79GB) thì KHÔNG chạy được
# bản GPU này. Hãy dùng bản CHẠY CPU thay thế: vllm-server/start-embeddings-cpu.sh

export NETWORK_VOLUME="${NETWORK_VOLUME:-/workspace/network-volume}"
export HF_HOME="${HF_HOME:-$NETWORK_VOLUME/huggingface}"
mkdir -p "$HF_HOME"

# BAAI/bge-m3: strong multilingual embeddings (incl. Vietnamese), 1024-dim, ~2GB.
MODEL_ID="${MODEL_ID:-BAAI/bge-m3}"
SERVED_NAME="${SERVED_NAME:-bge-m3}"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3333}"            # your other public port
VLLM_API_KEY="${VLLM_API_KEY:-change-me-please}"

echo "▶ Serving EMBEDDINGS $MODEL_ID as '$SERVED_NAME' on $HOST:$PORT"

exec vllm serve "$MODEL_ID" \
  --served-model-name "$SERVED_NAME" \
  --task embed \
  --host "$HOST" \
  --port "$PORT" \
  --api-key "$VLLM_API_KEY" \
  --gpu-memory-utilization 0.10 \
  --trust-remote-code
