#!/usr/bin/env bash
# =============================================================================
#  test-llm.sh — Quick checks that your vLLM server is up and answering.
#  Usage:
#     ./test-llm.sh                  # tests http://localhost:4444 with key "change-me-please"
#     BASE=http://103.73.232.112:4444 KEY=yourtoken ./test-llm.sh
# =============================================================================
set -euo pipefail

BASE="${BASE:-http://localhost:4444}"
KEY="${KEY:-change-me-please}"
MODEL="${MODEL:-qwen2.5-vl}"

echo "== 1) List models =="
curl -s "$BASE/v1/models" -H "Authorization: Bearer $KEY" | head -c 800
echo; echo

echo "== 2) Text chat completion =="
curl -s "$BASE/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Trả lời ngắn gọn: 1 tô phở bò khoảng bao nhiêu calo?\"}],
    \"max_tokens\": 80
  }" | head -c 1200
echo; echo

echo "== 3) Vision (image) completion — uses a tiny red dot image =="
# 1x1 red pixel PNG (base64). Just proves the vision path accepts image_url.
IMG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
curl -s "$BASE/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": [
      {\"type\": \"text\", \"text\": \"Ảnh này màu gì? Trả lời 1 từ.\"},
      {\"type\": \"image_url\", \"image_url\": {\"url\": \"$IMG\"}}
    ]}],
    \"max_tokens\": 20
  }" | head -c 1000
echo; echo
echo "✅ If all three returned JSON with content, your API is ready for the app."
