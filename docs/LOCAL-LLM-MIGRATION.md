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

## Bản hoàn chỉnh: sửa phân tích ảnh + thực đơn bị cụt

### 1) Thực đơn 7 ngày bị lỗi parse (`Expected ',' or ']'`)
- Nguyên nhân: JSON thực đơn bị **cắt giữa chừng** vì `max_tokens` quá nhỏ (3000).
- Sửa: nâng `max_tokens` lên **6000** ở coach-dynamic.js (sinh plan) và đường update_plan
  trong chat.js. Parser thực đơn thêm khoan dung dấu phẩy thừa.

### 2) Phân tích ảnh: prose dài + hỏi "ăn vào bữa nào" + thẻ 0 kcal
- Nguyên nhân: prompt cũ cho phép markdown dài VÀ tự bảo model hỏi bữa ăn; `max_tokens`
  600 khiến phần `<data>` bị cắt → thẻ hiện 0 kcal.
- Sửa prompt ảnh (`buildNutritionPrompt`):
  + Bắt buộc nhận xét NGẮN 1–2 câu, CẤM markdown (###, gạch đầu dòng, in đậm).
  + CẤM hỏi "bạn ăn vào bữa nào" — giao diện đã có nút chọn buổi/ngày.
  + Nhấn mạnh nhìn kỹ để **phân biệt cháo (mặn) vs chè (ngọt)**, phở vs bún bò…
- Bỏ `appendMealTimeFollowUp` ở đường ảnh; nâng `max_tokens` ảnh lên **1200** (đủ chỗ cho
  nhận xét ngắn + thẻ `<data>` đầy đủ, không bị cụt).

### 3) Ảnh KHÔNG phải món ăn
- Model trả `<error>…</error>` → backend hiện câu xin lỗi "đây không phải món ăn…",
  KHÔNG hiện thẻ chọn bữa. (Trước đây hỏi nhầm "ăn vào bữa nào".)

### Lưu ý
- Sinh thực đơn 7 ngày bằng 32B vẫn khá lâu (~80–100s) vì model lớn + đầu ra dài.
  Muốn nhận diện ảnh nét hơn (giảm nhầm món): tăng `max_pixels` khi chạy vLLM
  (vd `'{"max_pixels": 1605632}'`), đổi lại ảnh xử lý chậm hơn một chút.

---

## Bản tổng hợp: timeout Vercel + render markdown + lịch sử ảnh

### 1) Vercel Runtime Timeout 60s (coach-dynamic / chat)
- Nguyên nhân: 32B sinh thực đơn 7 ngày mất ~80–100s > 60s.
- Sửa: `vercel.json` nâng `maxDuration` cho `api/chat.js` và `api/coach-dynamic.js` lên **300**
  (analyze-food lên 120).
- ⚠️ QUAN TRỌNG: `maxDuration > 60` **chỉ áp dụng trên gói Vercel Pro/Enterprise**. Gói
  **Hobby (free) bị giới hạn cứng 60s** → không thể chạy plan 32B trong 60s. Lựa chọn:
  (a) nâng cấp Vercel Pro, hoặc (b) dùng model nhỏ/nhanh hơn cho khâu sinh thực đơn.

### 2) Trả lời có ** và ### hiện ký tự thô
- Frontend trước dùng `innerText` nên `**`/`###` hiện nguyên ký tự.
- Sửa `public/chat.js`: thêm `renderMarkdown` AN TOÀN (escape HTML trước, rồi chuyển
  `# … ######` → `<h1>…<h6>`, `**đậm**` → `<strong>`, `*nghiêng*` → `<em>`,
  gạch đầu dòng → `<ul><li>`), dùng `innerHTML`. CSS trong `chat.css` chỉnh cỡ tiêu đề
  vừa với bong bóng chat. (Không cho phép chèn thẻ HTML lạ → an toàn XSS.)

### 3) Lịch sử chat cho ảnh
- Đường ảnh: khi chưa chọn bữa, lưu nhãn người dùng là **"Phân tích món ăn: <tên món>"**
  (thay vì "[ảnh]"/"Phân tích hình ảnh này") → load lại có nghĩa. Trường hợp đã chọn
  thời điểm ăn vẫn theo luồng xác nhận bữa sẵn có.

### 4) Nhận diện ảnh còn sai (nui vs mì, cháo vs chè…)
- Đây là GIỚI HẠN CỦA MODEL vision, prompt đã ép phân biệt kỹ. Muốn chính xác hơn:
  tăng độ phân giải ảnh khi chạy vLLM: `--mm-processor-kwargs '{"max_pixels": 1605632}'`
  (hoặc 2007040) — nét hơn, đổi lại chậm hơn một chút.

---

## "lỡ ăn" chậm + nhận diện ảnh tốt hơn

### 1) "lỡ ăn / lỡ ăn mất rồi" suy nghĩ rất lâu
- Nguyên nhân: "lỡ ăn" nằm trong `UPDATE_RE` → bị định tuyến vào nhánh **coach** (nặng,
  có thể sinh lại thực đơn 7 ngày ~80s). Câu "sáng tôi ăn..." không khớp → nhánh analyze (nhanh).
- Sửa: bỏ "lỡ ăn / vừa ăn / sáng nay / trưa nay / tối nay / hôm nay ăn / ghi nhận" khỏi
  `UPDATE_RE`. Giờ "lỡ ăn hủ tiếu" chạy y hệt "sáng tôi ăn hủ tiếu": nhanh + hỏi lại bữa.

### 2) Nhận diện ảnh sai nhiều → 2 hướng
**A. Tăng độ chính xác cho Qwen (MIỄN PHÍ, ưu tiên) — chỉnh ở server vLLM:**
- vLLM hạ ảnh xuống `max_pixels` trước khi model "nhìn". Đang đặt 1003520 (~1MP) là khá thấp.
  Tăng lên để nét hơn:
  `--mm-processor-kwargs '{"min_pixels": 200704, "max_pixels": 2007040}'`  (~2MP)
  (muốn nét hơn nữa: 2611200 ~ 2.6MP; đổi lại ảnh xử lý chậm hơn + tốn VRAM hơn).
- App đã gửi ảnh full resolution (không nén nhỏ) nên nút thắt là ở `max_pixels` này.

**B. Phối hợp API mạnh hơn (BẬT khi cần) — Google Gemini Flash:**
- Vì sao Gemini: VLM tổng quát mạnh, nhận diện món VIỆT tốt hơn hẳn các API "food" chuyên
  dụng phương Tây (LogMeal, Calorie Mama… vốn train chủ yếu món Âu Mỹ), lại rẻ + có bậc miễn phí.
- Đã tích hợp sẵn `lib/vision.js`: đặt `GEMINI_API_KEY` => ảnh nhận diện bằng Gemini, LỖI
  thì TỰ fallback về Qwen. Không đặt key => giữ 100% Qwen local. Áp dụng cho cả chat ảnh
  lẫn "thêm món ngoài thực đơn" (analyze-food).
- Lấy key miễn phí: https://aistudio.google.com/apikey . Model mặc định gemini-2.0-flash.

> Gợi ý: thử (A) trước (miễn phí). Nếu vẫn chưa đủ chính xác thì bật (B).
