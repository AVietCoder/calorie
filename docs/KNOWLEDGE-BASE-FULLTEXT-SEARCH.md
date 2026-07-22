# Knowledge Base — PostgreSQL Full Text Search (không dùng embedding)

Tài liệu này mô tả kiến trúc **hiện hành** của Knowledge Base sau khi refactor
loại bỏ hoàn toàn embedding. Đây là nguồn tham khảo chính; `docs/AI-KNOWLEDGE.md`
và `docs/RAG-UPGRADE.md` là tài liệu lịch sử (đã đánh dấu lỗi thời).

## 1. Nguyên tắc cốt lõi

**Không có embedding ở bất kỳ đâu trong dự án.** Cụ thể, những thứ sau đã bị
xoá hoàn toàn và KHÔNG được phép quay lại:

- Model embedding BGE-M3
- OpenAI Embeddings / Lovable Embeddings
- Endpoint `/v1/embeddings`
- pgvector / bất kỳ vector database nào
- Mọi hàm `embedTexts()`, `embedQuery()`, `pingEmbeddings()`, `embedChunksWithFallback()`

Toàn bộ tìm kiếm tài liệu chạy bằng **PostgreSQL Full Text Search**:
`tsvector` (cột sinh tự động — generated column) + chỉ mục **GIN** + xếp hạng
bằng **`ts_rank`**, được lộ ra cho ứng dụng qua 2 hàm RPC.

## 2. Hai nguồn kiến thức, một cơ chế tìm kiếm

| Nguồn | Bảng Postgres | Nạp dữ liệu bằng | Dùng cho |
|---|---|---|---|
| **A. Tài liệu nền có sẵn** (tiểu đường, gout, gan nhiễm mỡ, mỡ máu, thận, tiêu hoá) | `kb_base_chunks` | `scripts/seed-base-knowledge.mjs` (nạp từ `knowledge/knowledge-base.json`) | Gợi ý dinh dưỡng theo bệnh lý trong chat/coach |
| **B. PDF admin tải lên** | `admin_kb_chunks` | `/admin.html` → `POST /api/admin?action=upload` | Hỏi-đáp Knowledge Base nghiêm ngặt (`/api/kb-query`) + bổ sung ngữ cảnh cho chat |

Cả hai bảng đều có cột `tsv tsvector generated always as (to_tsvector('simple', text)) stored`
và chỉ mục `GIN`. Cấu hình tìm kiếm dùng `'simple'` (chỉ lowercase + tách từ,
KHÔNG stemming) vì Postgres không có sẵn dictionary tiếng Việt, và stemming
tiếng Anh sẽ làm sai lệch việc khớp từ tiếng Việt.

## 3. Pipeline khi upload PDF

```
PDF (multipart) → pdf-parse (trích văn bản) → chunker.js (chia đoạn ~1000 ký tự,
overlap 150) → lưu text vào Supabase (admin_kb_chunks, KHÔNG có embedding)
→ Postgres TỰ ĐỘNG tạo chỉ mục tìm kiếm (cột tsv là generated column + GIN index)
```

Không có bước "tạo embedding" nào trong pipeline. File: `api/admin.js` (action
`upload`), dùng `lib/rag/parse-pdf.js`, `lib/rag/chunker.js`, `lib/rag/store.js`.

## 4. Pipeline khi hỏi (chat hoặc Knowledge-Base-only)

```
Câu hỏi → search_admin_kb_chunks(query, N) + search_base_kb_chunks(query, N)
        (2 hàm RPC Postgres, mỗi hàm: tsvector @@ websearch_to_tsquery(...),
         xếp hạng bằng ts_rank, trả về Top N — mặc định 8, có thể 5-10)
        → gộp + cộng điểm ưu tiên theo bệnh lý/nguồn (JS, không phải embedding)
        → đưa NGUYÊN VĂN các đoạn (top 5-10) vào prompt hệ thống của Qwen
        → Qwen trả lời DỰA TRÊN các đoạn đó
```

File chính: `lib/knowledge.js` (`retrieveKnowledge`), `lib/rag/store.js`
(`searchAdminChunks`), `lib/rag/kb-base-store.js` (`searchBaseChunks`).

### Chế độ Knowledge-Base nghiêm ngặt (`/api/kb-query`)

`lib/rag/kb-answer.js` gọi `retrieveKnowledge({ kbOnly: true })` (chỉ tìm
trong PDF admin, không trộn tài liệu nền), rồi bắt buộc Qwen **chỉ được dùng
thông tin trong các đoạn trích** — không dùng kiến thức nền, không tự bịa số
liệu. Nếu không có đoạn nào khớp đủ tốt, trả lời đúng nguyên văn:

> **"Không tìm thấy trong Knowledge Base."**

(hằng số `KB_NOT_FOUND` trong `lib/knowledge.js`).

## 5. Ngưỡng tin cậy (confidence gate)

Vì hàm RPC chỉ trả về dòng nào **thực sự khớp** (`tsv @@ websearch_to_tsquery(...)`
trong mệnh đề `WHERE`), có kết quả trả về nghĩa là đã có một khớp từ khoá thật
sự — không phải suy đoán. `kbHasConfidentHit()` áp thêm một ngưỡng `ts_rank`
tối thiểu (`RAG_KB_MIN_RANK`, mặc định `0.01`) làm lớp an toàn phụ chống lại
một khớp từ khoá quá yếu (VD: chỉ khớp một từ rất phổ biến).

## 6. Cài đặt (không cần embedding server)

```bash
# 1) Trên Supabase SQL Editor, chạy lần lượt:
#      migrations/admin.sql
#      migrations/fulltext_search.sql
#    (fulltext_search.sql tạo tsv + GIN cho admin_kb_chunks, tạo bảng
#     kb_base_chunks + tsv + GIN, tạo 2 hàm RPC, và dọn sạch mọi cột/extension
#     liên quan embedding nếu từng tồn tại.)

# 2) (tuỳ chọn) Nạp kho kiến thức bệnh lý có sẵn vào Postgres:
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-base-knowledge.mjs

# 3) Kiểm tra:
node scripts/verify-kb.mjs
#   hoặc gọi API: GET /api/admin?action=ftscheck  (cần đăng nhập admin)
#            GET /api/kb-query?action=ping        (cần đăng nhập)
```

Không cần đặt bất kỳ biến môi trường `EMBEDDING_*` nào. Toàn bộ tính năng
Knowledge Base chạy được chỉ với `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
+ (`SUPABASE_ANON_KEY` cho auth) + cấu hình LLM (`LLM_BASE_URL`, ...).

## 7. Bản đồ file (đã refactor)

| File | Vai trò |
|---|---|
| `migrations/fulltext_search.sql` | Xoá embedding/pgvector; tạo `tsv` + GIN cho `admin_kb_chunks`; tạo bảng `kb_base_chunks` + `tsv` + GIN; tạo RPC `search_admin_kb_chunks`, `search_base_kb_chunks`. |
| `migrations/admin.sql` | Schema gốc cho `admin_pdfs` / `admin_kb_chunks` (đã bỏ cột `embedding`). |
| `lib/rag/store.js` | CRUD `admin_pdfs`/`admin_kb_chunks` + `searchAdminChunks()` (RPC). |
| `lib/rag/kb-base-store.js` | Truy vấn `kb_base_chunks` qua `searchBaseChunks()` (RPC). |
| `lib/rag/parse-pdf.js` | Trích văn bản từ PDF (`pdf-parse`) — không đổi. |
| `lib/rag/chunker.js` | Chia văn bản thành đoạn — không đổi, không liên quan embedding. |
| `lib/rag/storage.js` | Lưu file PDF gốc vào Supabase Storage — không đổi. |
| `lib/rag/kb-answer.js` | Trả lời nghiêm ngặt CHỈ từ Knowledge Base (dùng bởi `/api/kb-query`). |
| `lib/knowledge.js` | Lớp truy hồi hợp nhất (base + admin) cho chat/coach; xây prompt. |
| `api/admin.js` | Upload/xoá/liệt kê PDF; không còn logic fallback embedding. |
| `api/kb-query.js` | Hỏi-đáp Knowledge Base nghiêm ngặt; `?action=ping`/`status`. |
| `api/chat.js`, `api/coach-dynamic.js` | Gọi `retrieveKnowledge()`/`buildKnowledgeSection()` — không đổi API, chỉ đổi bên trong. |
| `lib/nutrition.js` | Đã bỏ khớp món ăn theo ngữ nghĩa (embedding); chỉ còn exact/alias match. |
| `scripts/seed-base-knowledge.mjs` | Nạp `knowledge/knowledge-base.json` vào bảng `kb_base_chunks`. |
| `scripts/verify-kb.mjs` | Kiểm thử end-to-end pipeline (chunk → lưu → Full Text Search). |

## 8. Những gì đã bị xoá hoàn toàn

- `lib/rag/embeddings.js` (BGE-M3 / OpenAI / Lovable embeddings, `/v1/embeddings`)
- `lib/rag/retrieval.js` (BM25/cosine hybrid ranking trong JS — không cần nữa vì Postgres đã xếp hạng)
- `scripts/embed-server-local.mjs`, `scripts/ingest-knowledge.mjs`, `scripts/verify-rag.mjs`
- `vllm-server/embed_server.py`, `vllm-server/start-embeddings.sh`, `vllm-server/start-embeddings-cpu.sh`
- `migrations/rag_embedding_observability.sql` (cột chẩn đoán embedding)
- Cột `admin_kb_chunks.embedding`, `admin_pdfs.embedding_count/embedding_model/embedding_dim/embedding_error`, `foods.embedding`
- Toàn bộ biến môi trường `EMBEDDING_*`
