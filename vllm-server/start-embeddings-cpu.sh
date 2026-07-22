#!/usr/bin/env bash
# =============================================================================
#  start-embeddings-cpu.sh — Run the bge-m3 embedding server on CPU.
#
#  Use this (not start-embeddings.sh) because your GPU is FULL with the 32B
#  chat model. This runs embeddings on CPU in an ISOLATED venv, so it never
#  conflicts with the vLLM venv's pinned transformers and never touches the GPU.
#
#  After it's up:  set in the app's .env  ->
#     EMBEDDING_BASE_URL=http://103.73.232.112:3333/v1
#     EMBEDDING_API_KEY=<same token as VLLM_API_KEY, or empty>
#     EMBEDDING_MODEL=bge-m3
#  (and run scripts/ingest-knowledge.mjs once to pre-bake chunk vectors — see README)
# =============================================================================
set -euo pipefail

export NETWORK_VOLUME="${NETWORK_VOLUME:-/network-volume}"
export HF_HOME="${HF_HOME:-$NETWORK_VOLUME/huggingface}"
export PATH="$HOME/.local/bin:$PATH"
EMBED_VENV="${EMBED_VENV:-$NETWORK_VOLUME/embed-venv}"

# Isolated CPU venv (separate from vLLM's venv on purpose)
if [ ! -x "$EMBED_VENV/bin/python" ]; then
  echo "▶ Creating CPU embedding venv at $EMBED_VENV (one-time)..."
  uv venv "$EMBED_VENV" --python 3.10
  source "$EMBED_VENV/bin/activate"
  # CPU-only torch (small, no CUDA) + a tiny FastAPI server + sentence-transformers
  uv pip install --torch-backend=cpu torch sentence-transformers fastapi "uvicorn[standard]"
else
  source "$EMBED_VENV/bin/activate"
fi

export EMBED_MODEL="${EMBED_MODEL:-BAAI/bge-m3}"
export EMBED_SERVED_NAME="${EMBED_SERVED_NAME:-bge-m3}"
export EMBED_PORT="${EMBED_PORT:-3333}"
export EMBED_API_KEY="${EMBED_API_KEY:-${VLLM_API_KEY:-}}"

DIR="$(cd "$(dirname "$0")" && pwd)"
echo "▶ Embedding server (CPU) on 0.0.0.0:$EMBED_PORT  model='$EMBED_SERVED_NAME'"
echo "  (chạy nền: nohup bash vllm-server/start-embeddings-cpu.sh > $NETWORK_VOLUME/embed.log 2>&1 &)"
exec python "$DIR/embed_server.py"
