# Hệ thống RAG (kiến thức dinh dưỡng) cho Calorie AI

Tài liệu này mô tả cách AI "học" từ tài liệu dinh dưỡng, phần **Admin tải PDF**,
và phần **fix lỗi deploy trên Vercel**.

---

## 1. Tổng quan — RAG gồm 2 lớp

AI không fine-tune; thay vào đó, mỗi lần chat ta **truy hồi (retrieve)** các đoạn
tài liệu liên quan rồi chèn vào prompt. Có **2 nguồn kiến thức** ghép lại tự động
trong `api/lib/knowledge.js`:

| Lớp | Nguồn | Cách chọn | Quản lý ở đâu |
|-----|-------|-----------|---------------|
| **A. Cơ sở theo bệnh lý** (có sẵn) | `api/knowledge/knowledge-base.json` (6 tài liệu: tiểu đường, gút, gan nhiễm mỡ, mỡ máu, thận, tiêu hóa) | Định tuyến theo `profile.disease` của người dùng | Sinh ra từ `scripts/sources/*.pdf` bằng `scripts/build-knowledge-base.py` |
| **B. Bổ sung (admin upload)** | Supabase `admin_kb_chunks` | Tương đồng ngữ nghĩa (semantic) với câu hỏi, hoặc trùng từ khóa | Trang **/admin.html**, file gốc lưu trên **Cloudinary** |

> Lớp B **độc lập** với lớp A (đúng như thiết kế trong `migrations/admin.sql`):
> admin upload là kiến thức tổng quát, không gắn bệnh lý, được truy hồi theo
> ngữ nghĩa và ghép thêm vào phần kiến thức của chat.

Quy trình của lớp B đi theo đúng mô hình RAG tham khảo
(parse → chunk → embed → store → retrieve), nhưng dùng **pdf-parse + OpenAI
embeddings + Supabase + Cloudinary** thay cho LangChain/Pinecone.

---

## 2. Fix lỗi deploy Vercel (`import.meta`)

**Lỗi:** `SyntaxError: Cannot use 'import.meta' outside a module` tại
`api/lib/knowledge.js`.

**Nguyên nhân:** Vercel biên dịch file ESM (`import/export`) sang CommonJS bằng
esbuild. Cú pháp `import.meta.url` không có tương đương trong CommonJS nên gây lỗi
cú pháp lúc nạp module. (Các `import/export` khác thì dịch được sang `require`.)

**Cách fix:** Bỏ hoàn toàn `import.meta.url`. Khi cần đường dẫn file, dùng
`process.cwd()` + `fs` (xem `BUNDLE_PATHS` trong `knowledge.js`). **Không** thêm
`"type": "module"` vào `package.json` vì `api/index.js` đang là CommonJS
(`require`/`module.exports`) — thêm vào sẽ làm hỏng file đó.

---

## 3. Cài đặt (BẮT BUỘC làm theo thứ tự)

### 3.1. Chạy migration trên Supabase
Mở **Supabase → SQL Editor**, dán toàn bộ nội dung `migrations/admin.sql` và chạy
**một lần**. Nó tạo: cột `profiles.is_admin`, bảng `admin_pdfs`, `admin_kb_chunks`
(và `chat_images`, `ai_usage_logs` cho tính năng khác), kèm RLS.

### 3.2. Biến môi trường (Vercel → Settings → Environment Variables)

| Biến | Bắt buộc? | Ghi chú |
|------|-----------|---------|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | ✅ (đã có) | Như cũ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ **mới, bắt buộc** | RLS chỉ cho admin/service-role đọc bảng admin → server phải dùng key này. Lấy ở Supabase → Project Settings → API → `service_role`. |
| `OPENAI_API_KEY` | ⭐ nên có (đã có) | Dùng cho embedding. Thiếu thì vẫn chạy nhưng lớp B chỉ so khớp từ khóa. |
| **Cloudinary (UNSIGNED — khuyến nghị, đơn giản nhất):** `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_UPLOAD_PRESET` | ⭐ nên có | Lưu file PDF gốc lên Cloudinary bằng upload preset (không cần API secret). Tên có tiền tố `VITE_` cũng được chấp nhận. Thiếu thì upload vẫn chạy nhưng **không** lưu file gốc lên cloud (phần chữ vẫn lưu Supabase). |
| **Cloudinary (SIGNED — tùy chọn, để BẬT xóa file):** thêm `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET` (hoặc dùng `CLOUDINARY_URL`) | tùy chọn | Unsigned KHÔNG xóa được file qua API. Thêm key/secret để khi xóa tài liệu thì xóa luôn file trên Cloudinary. |
| `CLOUDINARY_PDF_FOLDER` | tùy chọn | Mặc định `calorie-rag-pdfs`. |
| `ADMIN_EMAILS` | tùy chọn | Danh sách email admin, phân tách bằng dấu phẩy — dùng để cấp admin nhanh. |
| `EMBEDDING_MODEL` | tùy chọn | Mặc định `text-embedding-3-small` (1536 chiều). |

### 3.3. Cấp quyền admin
Một trong hai cách:
- Thêm email vào `ADMIN_EMAILS`, **hoặc**
- Chạy SQL: `update public.profiles set is_admin = true where id = '<user-uuid>';`

### 3.4. Cài dependency
`package.json` đã thêm `pdf-parse` và `cloudinary`. Chạy `npm install` (Vercel tự
chạy khi deploy).

---

## 4. Dùng trang Admin (`/admin.html`)
- Đăng nhập bằng tài khoản admin → vào `/admin.html` (hoặc bấm mục **ADMIN** ở
  thanh điều hướng, chỉ hiện với admin).
- Kéo–thả hoặc chọn **PDF** → bấm **Tải lên & xử lý**. Hệ thống sẽ:
  1. Lưu file gốc lên **Cloudinary** (nếu đã cấu hình).
  2. Trích văn bản (`pdf-parse`).
  3. Chia đoạn (~1200 ký tự, chồng lấp 200).
  4. Tạo embedding (nếu có `OPENAI_API_KEY`).
  5. Lưu các đoạn vào `admin_kb_chunks`, metadata vào `admin_pdfs`.
- Bảng "Tài liệu đã tải lên" cho xem trạng thái, số đoạn, số embedding, link file
  Cloudinary, và nút **Xóa**. Xóa luôn xóa chunk trong Supabase; file trên
  Cloudinary chỉ bị xóa nếu đang ở chế độ SIGNED (có api_key + api_secret) —
  ở chế độ unsigned thì file gốc vẫn được giữ lại trên Cloudinary.
- PDF scan ảnh (không có text) sẽ báo lỗi vì không trích được nội dung.

---

## 5. Tài liệu được dùng trong chat như thế nào
`api/chat.js` và `api/coach-dynamic.js` gọi `retrieveKnowledge({message, disease, topK})`:
- Lấy đoạn theo **bệnh lý** từ lớp A (knowledge-base.json).
- Lấy thêm đoạn **liên quan ngữ nghĩa** từ lớp B (admin_kb_chunks).
- Ghép lại (giới hạn ký tự) rồi `buildKnowledgeSection()` tạo khối hướng dẫn tiếng
  Việt chèn vào system prompt. Hai hàm này **không đổi chữ ký**, nên các file gọi
  không cần sửa.

---

## 6. Bản đồ file

```
api/
  admin.js                  # API admin: whoami / list / upload / delete
  lib/
    cloudinary.js           # upload/destroy PDF trên Cloudinary (tùy chọn, graceful)
    admin-auth.js           # xác thực + kiểm tra quyền admin (is_admin / ADMIN_EMAILS)
    knowledge.js            # RAG: lớp A (bundle) + lớp B (admin) — ĐÃ bỏ import.meta
    supabase.js             # thêm supabaseAdmin (service-role)
    rag/
      parse-pdf.js          # pdf-parse -> text
      chunker.js            # chia đoạn theo đoạn/câu + overlap
      embeddings.js         # OpenAI embeddings (text-embedding-3-small)
      store.js              # CRUD admin_pdfs / admin_kb_chunks (service-role)
  knowledge/knowledge-base.json   # cơ sở theo bệnh lý (lớp A)
public/
  admin.html / admin.js / admin.css   # trang quản trị
  admin-link.js             # chèn mục ADMIN vào nav (chỉ admin)
migrations/admin.sql        # schema admin (nguồn chuẩn) — chạy trên Supabase
scripts/                    # build-knowledge-base.py, ingest-knowledge.mjs (cho lớp A)
```

---

## 7. Cập nhật cơ sở theo bệnh lý (lớp A) — như cũ
Thêm PDF vào `scripts/sources/`, sửa `DISEASE_MAP` trong
`scripts/build-knowledge-base.py`, chạy `python build-knowledge-base.py` để sinh
lại `knowledge-base.json`, rồi deploy lại. (Tùy chọn) chạy
`node scripts/ingest-knowledge.mjs` để nhúng embedding cho lớp A. Bệnh mới nhớ
thêm vào dropdown trong `public/setup.html`.
