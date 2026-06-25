#!/usr/bin/env bash
# =============================================================================
#  install-vllm.sh — Install a CUDA-12.4-compatible vLLM on this H100 box.
#
#  Why pinned? This server's driver (550.54.15) supports CUDA 12.4 only.
#  The latest vLLM bundles PyTorch for CUDA 12.6/12.8 and fails with
#  "NVIDIA driver is too old". vLLM 0.8.5 + torch 2.6 (cu124) matches the
#  driver and supports Qwen2.5-VL.
#
#  Run once. Re-run only if you recreate the venv.
# =============================================================================
set -euo pipefail

export NETWORK_VOLUME="${NETWORK_VOLUME:-/network-volume}"   # <-- your real mount
export HF_HOME="${HF_HOME:-$NETWORK_VOLUME/huggingface}"
mkdir -p "$HF_HOME"

# 1) Make sure uv is installed and on PATH
if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"

# 2) Fresh, clean venv on the network volume (avoids leftover wrong torch)
rm -rf "$NETWORK_VOLUME/vllm-venv"
uv venv --python 3.10 "$NETWORK_VOLUME/vllm-venv"
source "$NETWORK_VOLUME/vllm-venv/bin/activate"

# 3) Install vLLM 0.8.5 with PyTorch built for CUDA 12.4 (cu124)
#     Pin transformers==4.51.3: newer transformers (5.x) break vLLM 0.8.5's
#     tokenizer (AttributeError: all_special_tokens_extended).
uv pip install "vllm==0.8.5" "transformers==4.51.3" --torch-backend=cu124

# 3b) uv venvs are minimal — Triton (GPU kernels) needs setuptools/wheel at import
uv pip install setuptools wheel

# 4) Verify torch can actually see the GPU (this is what was failing before)
python - <<'PY'
import torch
print("torch:", torch.__version__, "| built for CUDA:", torch.version.cuda)
print("GPU available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("GPU:", torch.cuda.get_device_name(0))
PY

echo
echo "✅ If 'GPU available: True' above, you're ready. Next: bash vllm-server/start-llm.sh"
