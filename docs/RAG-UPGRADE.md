# Nâng cấp: Lưu/Tải PDF + RAG (Calorie AI)

Tài liệu này tóm tắt những thay đổi đã thực hiện và cách bật/tinh chỉnh chúng.

---

## 1) Upload PDF → lưu được & tải về được (không còn phụ thuộc Cloudinary)

### Trước đây
File PDF gốc chỉ được lưu **nếu** đã cấu hình Cloudinary. Nếu chưa, file bị mất —
chỉ còn lại phần văn bản đã trích. Link tải lại dựng URL `fl_attachment` thủ công
trên Cloudinary (dễ hỏng với file `raw`).

### Bây giờ
- File gốc được lưu vào **Supabase Storage** (bucket riêng tư `admin-pdfs`) — đây là
  nơi lưu **CHÍNH**. App tự tạo bucket khi upload lần đầu.
- Link tải về dùng **signed URL ngắn hạn** (mặc định 1 giờ) do server cấp, nên thẻ
  `<a download>` hoạt động ngay mà không lộ file ra public, không cần header `Authorization`.
- **Cloudinary trở thành tùy chọn** (mirror). Nếu vẫn cấu hình, file được lưu song song
  ở cả hai; nếu không, mọi thứ vẫn chạy bằng Supabase Storage.

### Cần cấu hình gì
Bắt buộc (đa số dự án đã có sẵn):

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...     # BẮT BUỘC để ghi Storage + bypass RLS
SUPABASE_ANON_KEY=...
```

Tùy chọn:

```
SUPABASE_PDF_BUCKET=admin-pdfs    # đổi tên bucket nếu muốn (mặc định admin-pdfs)
SUPABASE_SIGNED_URL_TTL=3600      # thời hạn link tải (giây), mặc định 1 giờ
```

### Migration
Chạy lại `migrations/admin.sql` trên Supabase SQL Editor (an toàn, idempotent).
Nó thêm 2 cột `storage_path`, `storage_bucket` vào `admin_pdfs`. Bucket Storage được
app tạo tự động; nếu muốn tạo trước bằng SQL, xem ghi chú cuối file migration.

### Các API mới/đổi
- `GET  /api/admin?action=list` — mỗi tài liệu có thêm `download_url` (Storage signed URL,
  fallback Cloudinary) và `download_kind`.
- `GET  /api/admin?action=download&id=<uuid>` — đường dẫn tải dự phòng (redirect 302 sang
  signed URL mới).
- `POST /api/admin?action=upload` — lưu Storage trước, Cloudinary sau (nếu có); trả về
  `download_url` ngay.
- `POST /api/admin?action=delete&id=<uuid>` — xóa cả object trong Storage và Cloudinary.

---

## 2) Nâng cấp RAG (tăng chất lượng trả lời của LLM)

### Vấn đề lớn nhất đã sửa
`knowledge/knowledge-base.json` (63 đoạn kiến thức bệnh lý) **không có embedding** →
base layer trước đây chỉ chạy bằng từ khóa, không có tìm kiếm ngữ nghĩa.

### Pipeline mới (`lib/rag/retrieval.js`)
Tìm kiếm **hybrid** thay vì chọn một trong hai:

1. **Dense** — cosine trên embedding OpenAI (khi có).
2. **Lexical** — **BM25** (tf bão hòa + idf) thay cho đếm trùng từ thô.
3. **Fusion** — **Reciprocal Rank Fusion (RRF)** hợp nhất 2 bảng xếp hạng (không cần
   hai thang điểm cùng đơn vị).
4. **MMR** — Maximal Marginal Relevance chọn top-k vừa liên quan vừa **đa dạng** (tránh
   nhồi cho LLM 3 đoạn gần trùng nhau).

Tất cả thuần JS, không cần pgvector — giữ nguyên thiết kế "embedding lưu JSON trong
Supabase, cosine tính bằng JS".

### Những cải tiến khác (`lib/knowledge.js`)
- **Gộp 1 pool thống nhất**: kiến thức nền (định tuyến theo bệnh) + tài liệu admin được
  xếp hạng chung, thay vì 2 lần lọc thô riêng biệt.
- **Định tuyến theo bệnh = điểm thưởng** (không còn lọc cứng): đoạn rất khớp từ tài liệu
  khác vẫn có thể nổi lên khi thực sự liên quan, nhưng tài liệu đúng bệnh luôn được ưu tiên.
- **Lazy-embed base layer**: khi có `OPENAI_API_KEY`, app tự tạo embedding cho 63 đoạn nền
  **một lần** rồi cache trong RAM → base layer cũng có semantic, **không cần build lại**.
  (Có cooldown 5 phút nếu lỗi để tránh gọi lặp.)
- **Cache đoạn admin** (TTL mặc định 60s) + **tự dọn cache** khi upload/xóa → tài liệu mới
  có hiệu lực ngay.
- **Ngưỡng theo ngân sách ký tự** + luôn trả ít nhất vài đoạn khi có định tuyến (không bao
  giờ "đói" ngữ cảnh).
- **Guard query rỗng**: người dùng khỏe mạnh, không bệnh, không câu hỏi → không chèn kiến
  thức bệnh lý vô nghĩa.

### Tinh chỉnh prompt theo mục tiêu app ("fine-tune")
> Lưu ý: app dùng **OpenAI API** nên không thể fine-tune model trực tiếp ở đây (việc đó
> cần dataset huấn luyện + bản model riêng). Thay vào đó, khối hướng dẫn RAG trong
> `buildKnowledgeSection()` đã được tinh chỉnh để mô hình: bám tài liệu khi tư vấn bệnh lý,
> diễn đạt sang món Việt cụ thể, không chép nguyên văn tiếng Anh, không bịa số liệu y khoa,
> và vẫn tôn trọng mục tiêu calo/macro. Đây là cách tối ưu đúng cho kiến trúc hiện tại.
>
> Nếu sau này bạn muốn fine-tune thật, hướng đi là: thu thập cặp (câu hỏi dinh dưỡng → câu
> trả lời mẫu chuẩn) dạng JSONL, chạy fine-tune model `gpt-4.1`/`4o-mini`, rồi đổi tên model
> trong `api/chat.js` và `api/coach-dynamic.js`. RAG ở trên vẫn dùng song song được.

### (Khuyến nghị) Bake embedding sẵn để bỏ chi phí cold-start
Lazy-embed thêm ~1 lần gọi API ở lần chat đầu sau cold-start. Muốn loại bỏ hẳn, chạy 1 lần:

```
OPENAI_API_KEY=sk-... node scripts/ingest-knowledge.mjs
```

Lệnh này ghi embedding thẳng vào `knowledge/knowledge-base.json`. Sau đó lazy-embed sẽ tự
bỏ qua (vì đã có sẵn).

### Tham số tinh chỉnh (env, đều có mặc định hợp lý)
```
EMBEDDING_MODEL=text-embedding-3-small   # đổi sang text-embedding-3-large để chính xác hơn (tốn hơn)
RAG_LAZY_EMBED_BASE=1                     # =0 để tắt lazy-embed base layer
RAG_ADMIN_CACHE_TTL_MS=60000             # TTL cache đoạn admin (ms)
RAG_ROUTE_BONUS=0.015                    # điểm thưởng cho đoạn đúng bệnh
RAG_ADMIN_BONUS=0.004                    # điểm thưởng nhẹ cho tài liệu admin
RAG_MMR_LAMBDA=0.7                       # 1=ưu tiên liên quan, 0=ưu tiên đa dạng
```

---

## 3) Tương thích ngược
- Chữ ký `retrieveKnowledge({ message, disease, topK, maxChars })` và
  `buildKnowledgeSection(result)` **giữ nguyên** → `api/chat.js` và `api/coach-dynamic.js`
  không cần sửa.
- Không thêm dependency mới (Supabase Storage nằm trong `@supabase/supabase-js` đã có).
- Tài liệu cũ chỉ có link Cloudinary vẫn tải được (fallback).

## 4) Đã kiểm thử
- `lib/rag/retrieval.js`: 11/11 unit test (BM25, RRF, MMR, hybridRank).
- `lib/knowledge.js`: định tuyến bệnh (gút, tiểu đường, mỡ máu, thận...), chế độ lexical,
  guard query rỗng, ngân sách ký tự — đều đạt.
- Toàn bộ module import sạch; `node --check` không lỗi cú pháp.
