# RAG / Embedding — Nguyên nhân gốc & Cách sửa

> ⚠️ **Toàn bộ tài liệu này đã LỖI THỜI.** Dự án đã refactor để KHÔNG dùng
> embedding ở bất kỳ đâu — không còn `embeddings.create()`, không còn
> `scripts/ingest-knowledge.mjs` hay `vllm-server/embed_server.py` (cả hai đã
> bị xoá). Retrieval hiện chạy bằng PostgreSQL Full Text Search (tsvector +
> GIN + ts_rank). Xem [`docs/KNOWLEDGE-BASE-FULLTEXT-SEARCH.md`](docs/KNOWLEDGE-BASE-FULLTEXT-SEARCH.md).
> Nội dung bên dưới chỉ còn giá trị lịch sử (ghi lại một lỗi đã từng gặp).

> TL;DR — Lỗi `resp.data is not iterable` **không** nằm ở PDF, chunk hay Supabase.
> Gốc rễ là **OpenAI SDK v6**: khi gọi `embeddings.create()` mà **không** truyền
> `encoding_format`, SDK tự gửi `encoding_format:"base64"` rồi giải mã base64 ở phía
> client. Các embedding server tự host (vLLM `--task embed`, `embed_server.py`, HF TEI…)
> trả về **mảng float**, nên bước giải mã của SDK hoặc **crash** (`resp.data is not iterable`)
> hoặc **âm thầm trả vector rác**. Bản sửa: **ép `encoding_format:"float"`** + parse phòng thủ.

---

## 1. Nguyên nhân gốc (root cause)

Đường dẫn lỗi: `api/admin.js` (upload) → `lib/rag/embeddings.js` → `embedTexts()`:

```js
// TRƯỚC (lib/rag/embeddings.js)
const resp = await c.embeddings.create({ model: EMBEDDING_MODEL, input: batch });
for (const row of resp.data) out.push(row.embedding);   // ← ném "resp.data is not iterable"
```

`openai@^6` (bản resolve 6.45.0) đã đổi hành vi `embeddings.create()`
([openai-node #1312](https://github.com/openai/openai-node/pull/1312)):

* Nếu caller **không** truyền `encoding_format`, SDK **tự thêm `encoding_format:"base64"`**
  vào request để "tối ưu băng thông".
* Sau đó SDK giả định server trả `data[i].embedding` là **chuỗi base64** và tự
  `Float32Array`-decode ở client.

Điều đó chỉ đúng với **OpenAI Cloud**. Backend tự host của dự án trả **mảng float**
(xem `vllm-server/embed_server.py`, và vLLM `--task embed`). Hệ quả có **2 mặt**, cùng một gốc:

| Backend trả về | Hành vi SDK v6 (base64 mặc định) | Kết quả |
|---|---|---|
| `data:[{embedding:[floats]}]` (embed_server.py, một số vLLM) | decode mảng float như base64 | **vector rác, dim sai** → semantic search vô nghĩa, **không báo lỗi** |
| shape khác (vd `{embeddings:[...]}`, hoặc thiếu `data`) | `resp.data` = undefined | **`TypeError: resp.data is not iterable`** ← đúng lỗi bạn gặp |

### Bằng chứng tái hiện (đã chạy thực tế)

Chạy `embedTexts` cũ với 3 loại mock backend, in ra `encoding_format` mà SDK gửi:

```
[FLOAT-server]  received encoding_format="base64"  → 2 vecs, dim=2, CORRECT_VALUES=false   ← hỏng âm thầm
[BASE64-server] received encoding_format="base64"  → 8 dims, CORRECT_VALUES=true
[NODATA-server] received encoding_format="base64"  → ❌ TypeError: resp.data is not iterable ← lỗi của bạn
```

→ Kết luận: SDK **luôn** ép base64; tùy backend mà lỗi biểu hiện thành crash hoặc hỏng dữ liệu.

---

## 2. Những gì đã sửa

### 2.1 `lib/rag/embeddings.js` — **viết lại, sửa gốc rễ**
* **Ép `encoding_format:"float"`** trên MỌI request → SDK trả thẳng mảng float, không round-trip base64.
  Đây là chuẩn được **OpenAI Cloud + vLLM + embed_server.py + HF TEI** hỗ trợ đồng nhất.
* **Parse phòng thủ** (`extractVectors`/`coerceEmbedding`): chấp nhận `float[]`, chuỗi base64,
  và các shape khác (`{data:[{embedding}]}`, `{data:[[...]]}`, `{embeddings:[...]}`, mảng trần).
* **Kiểm tra dimension nhất quán** + giá trị hữu hạn → không bao giờ lưu vector rác nữa.
* **`pingEmbeddings()`**: tự chẩn đoán backend (embed 1 câu, báo dim/shape/sample) — dùng để
  kiểm tra cấu hình TRƯỚC khi upload PDF lớn.
* **Log chi tiết** theo batch (bật bằng `RAG_DEBUG=1`); lỗi thì **luôn** log rõ nguyên nhân.

### 2.2 `scripts/ingest-knowledge.mjs` — sửa **cùng lỗi**
Trước đây tự gọi `openai.embeddings.create(... )` (thiếu `encoding_format`) → **cùng bug**.
Nay **tái dùng `embedTexts`** đã sửa (một nguồn chân lý duy nhất).

### 2.3 `vllm-server/embed_server.py` — tương thích đầy đủ (phòng thủ)
Honor `encoding_format` (`float` **và** `base64`), thêm `/health`, thêm log mỗi request.
(App luôn xin `float`, nhưng server giờ đúng chuẩn cho *mọi* client.)

### 2.4 Ưu tiên dữ liệu PDF + "Không tìm thấy trong Knowledge Base"
* `lib/knowledge.js`: thêm chế độ `kbOnly` (chỉ tìm trong PDF admin), trả **điểm tin cậy**
  (`bestDense` cosine, `bestBm25`), thêm `kbHasConfidentHit()` + `buildStrictKbSection()` +
  hằng `KB_NOT_FOUND`.
* `lib/rag/kb-answer.js` (mới): `answerFromKnowledgeBase()` —
  1) tìm **chỉ trong** PDF, 2) nếu không đạt ngưỡng tin cậy → trả **đúng** câu
  `"Không tìm thấy trong Knowledge Base"`, 3) nếu đạt → prompt **nghiêm ngặt**
  (CHỈ dùng trích đoạn, cấm kiến thức nền, cấm bịa số) rồi gọi LLM.
* `api/kb-query.js` (mới): endpoint `POST /api/kb-query` cho hỏi–đáp KB;
  kèm `GET ?action=ping` và `?action=status` để soi pipeline.

### 2.5 Log/debug toàn pipeline (`api/admin.js`)
Mỗi bước upload in log rõ ràng: nhận file → lưu → **extract (chars/pages)** →
**chunk (số lượng/độ dài TB)** → **ping backend** → **embed (dim/số vector/thời gian)** →
**save (inserted/embedded)** → **ready**. Nếu embed lỗi: ghi rõ lý do và **lưu vào cột
`embedding_error`** của PDF (không còn "âm thầm text-only").
Thêm `GET /api/admin?action=embping` để admin tự test backend.

### 2.6 `lib/rag/chunker.js` — chunk đúng kích thước hơn
PDF dạng **bảng** (như bảng thực phẩm) ít dấu ngắt câu/đoạn → trước đây tạo chunk quá to
(TB ~2422 ký tự dù đặt mục tiêu 1000). Thêm `hardWrap()` cắt cứng theo ranh giới từ ⇒
TB **~945 ký tự**, sát mục tiêu → retrieval chính xác hơn.

### 2.7 Migration (tùy chọn) — `migrations/rag_embedding_observability.sql`
Thêm cột chẩn đoán vào `admin_pdfs`: `embedding_model`, `embedding_dim`, `embedding_error`.
**An toàn/idempotent**; nếu chưa chạy, app vẫn hoạt động (chỉ mất phần hiển thị chẩn đoán —
app ghi các cột này theo kiểu "best-effort", không bao giờ chặn trạng thái `ready`).

---

## 3. Cách chạy

```bash
npm install                      # cài phụ thuộc (openai, pdf-parse, @supabase/supabase-js…)

# (khuyến nghị) chạy migration trên Supabase SQL Editor:
#   migrations/admin.sql                          (nếu chưa có)
#   migrations/rag_embedding_observability.sql    (mới, tùy chọn)
```

Cấu hình embedding trong `.env` (xem `.env.example`), ví dụ server bge-m3 tự host:

```env
EMBEDDING_BASE_URL=http://<host>:3333/v1
EMBEDDING_API_KEY=EMPTY
EMBEDDING_MODEL=bge-m3
# RAG_DEBUG=1   # bật log chi tiết từng bước
```

Khởi động embedding server (CPU) nếu dùng bản tự host:
```bash
bash vllm-server/start-embeddings-cpu.sh
```

---

## 4. Cách kiểm tra RAG hoạt động

### 4.1 Kiểm thử END-TO-END offline (không cần GPU/Supabase/tải model) — **khuyến nghị**
Script này chạy **module thật** (`parse-pdf → chunker → embeddings → retrieval → grounding`)
trên **PDF thật**, dùng một embedding server offline trả **mảng float** (đúng kịch bản từng gây lỗi):

```bash
npm run verify:rag -- /đường/dẫn/VTN_FCT_2007.pdf
# hoặc: node scripts/verify-rag.mjs /đường/dẫn/tới.pdf
```

Kết quả mong đợi (đã chạy thực tế với `VTN_FCT_2007.pdf`, **17/17 PASS**):

```
STAGE 1 ✅ ping OK dim=1024, vector float hữu hạn (không bị base64 làm hỏng)
STAGE 2 ✅ PDF: 1.339.688 ký tự, 567 trang
STAGE 3 ✅ 1622 chunks, TB 945 ký tự
STAGE 4 ✅ embed 1200 vector, dim nhất quán, KHÔNG rác
STAGE 5 ✅ "gạo tẻ / protein / vitamin C" → ANSWER (cosine cao)
        ✅ truy vấn ngoài chủ đề → "Không tìm thấy trong Knowledge Base"
RESULT  ✅ ALL CHECKS PASSED
```

> Ghi chú trung thực: embedding offline trong harness là bản **thay thế xác định** (hashing,
> 1024-dim) để kiểm chứng *đường ống* + bản sửa `encoding_format`. Chất lượng ngữ nghĩa thật
> đến từ **bge-m3**; hãy trỏ `EMBEDDING_BASE_URL` tới bge-m3 khi chạy production.

### 4.2 Kiểm tra backend embedding thật (production)
```bash
# qua admin (cần đăng nhập admin):
GET /api/admin?action=embping         → { ok:true, ping:{ dim, shape, sample } }
# hoặc qua endpoint KB:
GET /api/kb-query?action=ping
GET /api/kb-query?action=status       → { store:{ready,pdfs,chunks}, embeddings:{kind,model} }
```

### 4.3 Kiểm tra hỏi–đáp KB (ưu tiên PDF, không bịa)
```bash
POST /api/kb-query   { "question": "Gạo tẻ có bao nhiêu protein trên 100g?", "lang": "vi" }
# → { success, found, answer, trace:{ mode, chunks_used, confidence, sources[...] } }

POST /api/kb-query   { "question": "cách cấu hình Kubernetes ingress", "lang": "vi" }
# → answer == "Không tìm thấy trong Knowledge Base"
```

### 4.4 Upload lại chính PDF để xem log pipeline
Vào `/admin.html`, upload `VTN_FCT_2007.pdf`, xem log server:
```
📄 [admin][upload] extracted 1339688 chars from 567 page(s)
✂️ [admin][upload] chunked into 1622 chunks (avg 945 chars)
🧠 [admin][upload] embedding via self-hosted (bge-m3) @ http://.../v1
✅ [admin][upload] embedded 1622/1622 chunks (dim=1024) in ...ms
💾 [admin][upload] saved 1622 chunks (1622 with vectors)
🎉 [admin][upload] READY
```

---

## 5. File đã thêm/đổi

**Sửa gốc rễ & pipeline**
* `lib/rag/embeddings.js` ......... viết lại: `encoding_format:"float"` + parse phòng thủ + `pingEmbeddings()` + log
* `lib/rag/chunker.js` ............ `hardWrap()` cho PDF dạng bảng
* `api/admin.js` .................. log từng bước + ping fail-fast + lưu `embedding_error`
* `scripts/ingest-knowledge.mjs` .. sửa cùng lỗi (tái dùng `embedTexts`)
* `vllm-server/embed_server.py` ... honor `encoding_format` + `/health` + log

**Ưu tiên PDF / "Không tìm thấy trong Knowledge Base"**
* `lib/knowledge.js` .............. `kbOnly`, điểm tin cậy, `kbHasConfidentHit()`, `buildStrictKbSection()`, `KB_NOT_FOUND`
* `lib/rag/kb-answer.js` (mới) .... `answerFromKnowledgeBase()`
* `api/kb-query.js` (mới) ......... endpoint hỏi–đáp KB + chẩn đoán

**Kiểm thử & cấu hình**
* `scripts/verify-rag.mjs` (mới) .. kiểm thử end-to-end offline
* `scripts/embed-server-local.mjs` (mới) .. embedding server offline (OpenAI-compatible, trả float)
* `migrations/rag_embedding_observability.sql` (mới) .. cột chẩn đoán (tùy chọn)
* `.env.example`, `package.json` .. biến debug + script `verify:rag`, `embed:server`, `ingest:kb`
