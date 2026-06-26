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

---

## Cập nhật: sửa thẻ "Xác nhận bữa ăn" + prompt cho model local

### Vì sao thẻ chọn bữa ăn biến mất khi đổi sang local
Thẻ này chỉ hiện khi câu trả lời của bot chứa khối `<data>{...}</data>`. GPT-4.1 tuân
thủ rất tốt yêu cầu chèn thẻ này; Qwen2.5-VL-7B (model nhỏ hơn) thì hay quên, hoặc
bọc JSON trong ```json, hoặc trả object trần → frontend không bắt được → mất thẻ.

### Cách sửa (đã áp dụng trong `api/chat.js`)
1. **Trường có cấu trúc `mealData`**: coach prompt giờ yêu cầu model điền `mealData`
   (object dinh dưỡng) khi `action="analyze_only"` và người dùng nhắc một món cụ thể.
   Dựa vào trường JSON đáng tin hơn nhiều so với bắt model tự chèn thẻ `<data>`.
2. **Backend tự dựng thẻ `<data>` sạch** từ `mealData` (đường văn bản) và chuẩn hoá lại
   thẻ ở đường ảnh → frontend luôn nhận đúng một thẻ `<data>` hợp lệ. **Không phải sửa frontend.**
3. **`extractDataBlock` khoan dung**: đọc được cả `<data>`, ```json fences, lẫn object trần,
   và bỏ qua dấu phẩy thừa — phòng các kiểu định dạng lệch của model nhỏ.

### Điều chỉnh prompt engineering cho Qwen so với OpenAI
- **Nhiệt độ thấp** (`temperature: 0.2–0.3`) cho mọi tác vụ JSON/số liệu: model nhỏ cần
  nhiệt độ thấp để giữ đúng format và con số ổn định (trước đây không set → mặc định cao).
- **Chỉ thị định dạng tường minh + ví dụ mẫu**: thêm câu lệnh "BẮT BUỘC", cấm dùng ```json,
  và một ví dụ JSON đầy đủ đặt ở CUỐI prompt (model nhỏ bám ví dụ gần cuối tốt hơn).
- **Đừng phụ thuộc model tự bọc thẻ**: ưu tiên trường JSON có cấu trúc rồi để backend xử lý.
- **`response_format: json_object`** vLLM chỉ đảm bảo JSON *hợp lệ cú pháp*, không ép schema.
  Vì vậy phải nêu rõ schema + ví dụ; backend luôn parse phòng thủ (`safeJsonParse`, fallback).
- Tiếng Việt và nhận diện ảnh: Qwen2.5-VL xử lý tốt, không cần đổi.

### Không còn dùng token OpenAI
Mọi lệnh gọi sinh văn bản/ảnh đều qua `lib/llm.js` → vLLM. Embeddings chỉ gọi OpenAI nếu
bạn **chủ động** đặt `OPENAI_API_KEY`. Không đặt biến đó ⇒ 0 token OpenAI; RAG dùng tìm kiếm
từ khoá (hoặc server embedding local nếu bạn bật `EMBEDDING_BASE_URL`).

---

## Bản tối ưu cho Qwen2.5-VL-32B-Instruct (chat / ảnh / RAG / tốc độ)

### 1) Thẻ "Xác nhận bữa ăn" (đã sửa, giữ nguyên ở bản này)
Dùng trường JSON `mealData` + backend tự dựng thẻ `<data>` sạch + `extractDataBlock`
khoan dung (đọc cả ```json fences / object trần). 32B tuân thủ format tốt hơn 7B
nên thẻ này hiện ổn định hơn. Không phải sửa frontend.

### 2) Tốc độ — bật ở vLLM (xem vllm-server/start-llm.sh)
- **`--enable-prefix-caching`**: prompt hệ thống dài & tĩnh được cache → các lượt sau
  bỏ qua prefill → giảm mạnh độ trễ token đầu. (Lợi nhất cho app này.)
- **`--kv-cache-dtype fp8`**: KV cache 8-bit → tiết kiệm VRAM (32B rất sát 80GB) →
  cho context dài hơn và nhiều request song song hơn.
- **`--mm-processor-kwargs '{"max_pixels":1003520}'`**: giới hạn token ảnh (~1280
  thay vì tới ~16k) → nhận diện ảnh nhanh hơn nhiều, vẫn đủ nét cho món ăn.

### 3) Tốc độ — phía app
- **`temperature` thấp (0.2–0.3)** cho mọi tác vụ JSON/số liệu: ổn định format + nhanh hơn.
- **`max_tokens` có trần**: chat coach 4000, sinh thực đơn 6000, ước tính món 500 →
  chặn sinh lan man, độ trễ dự đoán được (vẫn đủ chỗ cho thực đơn 7 ngày).
- RAG giữ top-k hợp lý (6) để cân bằng chất lượng và độ dài prompt.

### 4) Đảm bảo 0 token OpenAI (đã siết trong code)
- Embeddings giờ **chỉ** gọi OpenAI khi đặt **cả** `EMBEDDING_PROVIDER=openai` **và**
  `OPENAI_API_KEY`. Không đặt `EMBEDDING_PROVIDER=openai` ⇒ **không bao giờ** gọi OpenAI,
  dù còn sót `OPENAI_API_KEY` trong môi trường.
- Chat/ảnh luôn qua `lib/llm.js` → `LLM_BASE_URL` (server local). Không chạm OpenAI.
- RAG ngữ nghĩa local: bật server bge-m3 (start-embeddings.sh) + đặt `EMBEDDING_BASE_URL`.
  Không bật thì RAG dùng keyword (vẫn tốt với 63 đoạn có định tuyến theo bệnh).

### Giữ nguyên tính năng cũ
Mọi luồng (phân tích ảnh món ăn, chat dinh dưỡng có RAG, sinh & cập nhật thực đơn 7
ngày, thẻ chọn bữa/ngày) giữ nguyên hành vi — các thay đổi chỉ là cấu hình & tinh chỉnh.
