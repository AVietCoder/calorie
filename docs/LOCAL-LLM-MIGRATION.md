# Chuyển từ OpenAI API → Model local (vLLM)

Tóm tắt những gì đã đổi trong code để app dùng **model local qua vLLM** thay cho
OpenAI. Nguyên tắc: vLLM tương thích API OpenAI, nên ta giữ nguyên thư viện
`openai` và chỉ **trỏ baseURL** sang server của bạn + đọc tên model từ biến môi trường.

## File mới

- **`lib/llm.js`** — Tạo sẵn 1 client OpenAI đã trỏ về vLLM (`LLM_BASE_URL`,
  `LLM_API_KEY`) và export tên model (`LLM_MODEL`, `LLM_VISION_MODEL`).
  Tất cả nơi cần gọi LLM đều import từ đây → đổi model/đổi server chỉ sửa 1 chỗ (env).
- **`.env.example`** — Mẫu cấu hình đầy đủ (đã thêm nhóm biến LLM/EMBEDDING).
- **`vllm-server/`** — Script + hướng dẫn dựng vLLM trên server H100.

## File đã sửa

| File | Trước | Sau |
|------|-------|-----|
| `api/analyze-food.js` | `new OpenAI({apiKey: OPENAI_API_KEY})`, model `gpt-4.1` (vision) | import `llm` từ `lib/llm.js`, model = `LLM_VISION_MODEL` |
| `api/chat.js` | model `gpt-4.1` (vision) + `gpt-4.1` (JSON) | `LLM_VISION_MODEL` + `LLM_MODEL` |
| `api/coach-dynamic.js` | model `gpt-4o` (JSON) | `LLM_MODEL` |
| `lib/rag/embeddings.js` | chỉ OpenAI cloud | hỗ trợ thêm server embedding tự host (`EMBEDDING_BASE_URL`), tự lùi về keyword nếu không cấu hình |
| `scripts/ingest-knowledge.mjs` | chỉ OpenAI cloud | hỗ trợ thêm `EMBEDDING_BASE_URL` |

## Điều quan trọng

- **Định dạng request không đổi.** Cách gửi ảnh (`type: "image_url"` + data URL base64)
  và chế độ JSON (`response_format: { type: "json_object" }`) đều được vLLM hỗ trợ,
  nên logic phân tích ảnh và sinh thực đơn giữ nguyên.
- **Tương thích ngược.** Nếu bạn KHÔNG đặt biến `LLM_*` mà đặt `OPENAI_API_KEY`,
  app vẫn chạy bằng OpenAI cloud như cũ. Muốn quay lại chỉ cần đổi env.
- **Embeddings là tuỳ chọn.** Kho kiến thức đi kèm vốn không có sẵn vector và hệ
  thống RAG tự lùi về tìm kiếm từ khoá. Chỉ cần dựng server embedding khi muốn
  tìm kiếm ngữ nghĩa (xem `vllm-server/README.md`, mục 7).

## Cấu hình tối thiểu để chạy

Trong `.env`:

```
LLM_BASE_URL=http://103.73.232.112:4444/v1
LLM_API_KEY=<token bạn đặt khi chạy vLLM, hoặc EMPTY>
LLM_MODEL=qwen2.5-vl
LLM_VISION_MODEL=qwen2.5-vl
```

(Cùng với các biến Supabase đã có sẵn của dự án.)
