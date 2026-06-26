#!/usr/bin/env bash
# =============================================================================
#  prepare-model.sh — Download Qwen2.5-VL and patch its config so it LOADS on
#  vLLM 0.8.5 (the CUDA-12.4-compatible version this box requires).
#
#  Fixes:
#    ValueError: Found conflicts between 'rope_type=default' and 'type=mrope'.
#
#  Strategy: the current model config ships BOTH keys. We consolidate them into
#  ONE modern key  rope_type="mrope"  (carrying the multimodal-RoPE value vLLM
#  needs) and drop the legacy 'type'. This is robust even if transformers tries
#  to re-normalise the field.
#
#  IMPORTANT: after this, you MUST serve the LOCAL folder ($MODEL_DIR), NOT the
#  repo name "Qwen/Qwen2.5-VL-7B-Instruct" (the repo name reads the UNPATCHED
#  config from the HF cache and the error comes back).
# =============================================================================
set -euo pipefail

export NETWORK_VOLUME="${NETWORK_VOLUME:-/network-volume}"
export HF_HOME="${HF_HOME:-$NETWORK_VOLUME/huggingface}"
export MODEL_REPO="${MODEL_REPO:-Qwen/Qwen2.5-VL-7B-Instruct}"
export MODEL_DIR="${MODEL_DIR:-$NETWORK_VOLUME/models/qwen2.5-vl-7b}"

source "$NETWORK_VOLUME/vllm-venv/bin/activate" 2>/dev/null || true

echo "▶ Disk space on $NETWORK_VOLUME:"; df -h "$NETWORK_VOLUME" | tail -1
echo "▶ Target dir: $MODEL_DIR"; mkdir -p "$MODEL_DIR"

echo "▶ Downloading $MODEL_REPO  (first time ~16GB; reuses cache if present)..."
python - <<'PYEOF'
import os
from huggingface_hub import snapshot_download
d = snapshot_download(repo_id=os.environ["MODEL_REPO"], local_dir=os.environ["MODEL_DIR"])
print("Downloaded to:", d)
PYEOF

CFG="$MODEL_DIR/config.json"
[ -f "$CFG" ] || { echo "❌ $CFG missing — download failed (disk? network?). See errors above."; exit 1; }

echo "▶ Patching $CFG (consolidate rope_scaling -> single modern key)"
python - <<'PYEOF'
import json, os
p = os.path.join(os.environ["MODEL_DIR"], "config.json")
c = json.load(open(p))
n = 0
def fix(rs):
    # carry the mrope value into the modern key, drop the legacy 'type'
    val = "mrope" if (rs.get("type") == "mrope" or rs.get("rope_type") == "mrope") \
          else (rs.get("rope_type") or rs.get("type"))
    rs.pop("type", None)
    rs["rope_type"] = val
def walk(d):
    global n
    if isinstance(d, dict):
        rs = d.get("rope_scaling")
        if isinstance(rs, dict) and ("type" in rs or "rope_type" in rs):
            if "type" in rs and "rope_type" in rs:
                n += 1
            fix(rs)
        for v in d.values(): walk(v)
    elif isinstance(d, list):
        for v in d: walk(v)
walk(c)
json.dump(c, open(p, "w"), indent=2)
print(f"  consolidated rope_scaling (had conflict in {n} place(s)).")

# Verify on disk
c2 = json.load(open(p))
bad = []
def chk(d, path="root"):
    if isinstance(d, dict):
        rs = d.get("rope_scaling")
        if isinstance(rs, dict) and "type" in rs and "rope_type" in rs:
            bad.append(path)
        for k, v in d.items(): chk(v, f"{path}.{k}")
chk(c2)
print("  on-disk conflict remaining:", bad if bad else "NONE (good)")
PYEOF

echo "▶ Double-check via transformers (does it re-introduce the conflict?)"
python - <<'PYEOF'
import os
try:
    from transformers import AutoConfig
    cfg = AutoConfig.from_pretrained(os.environ["MODEL_DIR"])
    d = cfg.to_dict()
    bad = []
    def chk(x, path="root"):
        if isinstance(x, dict):
            rs = x.get("rope_scaling")
            if isinstance(rs, dict) and "type" in rs and "rope_type" in rs:
                bad.append((path, rs))
            for k, v in x.items(): chk(v, f"{path}.{k}")
    chk(d)
    print("  transformers-loaded conflict:", bad if bad else "NONE (good)")
except Exception as e:
    print("  (transformers check skipped:", e, ")")
PYEOF

echo
echo "✅ Done. Serve the LOCAL folder (NOT the repo name):"
echo "   MODEL_ID=$MODEL_DIR bash vllm-server/start-llm.sh"
