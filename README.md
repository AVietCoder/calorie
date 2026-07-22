# Calorie AI

Calorie AI là nền tảng hỗ trợ cá nhân hóa dinh dưỡng bằng trí tuệ nhân tạo, được xây dựng với mục tiêu giúp người dùng hiểu rõ cơ thể mình, theo dõi lượng năng lượng nạp vào mỗi ngày và xây dựng một lộ trình ăn uống phù hợp với mục tiêu sức khỏe. Thay vì chỉ dừng lại ở việc đếm calories, sản phẩm được định hướng như một "AI Nutrition Coach" có khả năng đồng hành cùng người dùng trong suốt quá trình thay đổi thể trạng: từ giai đoạn thiết lập hồ sơ ban đầu, tính toán chỉ số nền tảng, sinh thực đơn 7 ngày, theo dõi tiến độ, cho đến việc phân tích bữa ăn thực tế và tự động điều chỉnh lại kế hoạch ăn uống khi hành vi sử dụng thay đổi.

Hệ sinh thái gồm **hai mặt trận**: web app (repo này, triển khai serverless trên Vercel) và **ứng dụng di động React Native** (`calorie-ai-mobile`) dùng chung toàn bộ backend. Điểm cốt lõi của Calorie AI nằm ở sự kết hợp giữa **dữ liệu định lượng dinh dưỡng tất định (deterministic)**, **kho tri thức y khoa có kiểm soát (RAG)**, **trợ lý ảo giọng nói (AI Agent)** và giao diện theo dõi trực quan — tạo nên trải nghiệm gần với một huấn luyện viên dinh dưỡng số hơn là một công cụ tính calories đơn thuần.

## Mô tả sản phẩm

Calorie AI được thiết kế để giải quyết một vấn đề rất phổ biến: phần lớn người dùng muốn ăn uống khoa học hơn nhưng lại thiếu một hệ thống đủ đơn giản để duy trì hằng ngày và đủ thông minh để phản ánh đúng tình trạng cá nhân. Sản phẩm cho phép người dùng bắt đầu từ hồ sơ sức khỏe của chính mình, bao gồm giới tính, năm sinh, chiều cao, cân nặng, cân nặng mục tiêu, mức độ vận động, deadline mong muốn, tốc độ thay đổi thể trạng, thói quen ăn uống và các yếu tố cá nhân hóa sâu hơn như dị ứng, bệnh lý hoặc nhóm macro cần ưu tiên. Từ những dữ liệu này, hệ thống tính toán BMR, TDEE, calories mục tiêu mỗi ngày và phân bổ macro phù hợp để làm nền cho toàn bộ lộ trình dinh dưỡng.

Trên nền dữ liệu đó, sản phẩm tạo ra một thực đơn 7 ngày có định hướng rõ ràng theo mục tiêu của người dùng như giảm cân, giữ cân, tăng cân hoặc tăng cơ. Thực đơn không chỉ đóng vai trò như một bản gợi ý cố định mà còn là một lộ trình có thể thích nghi theo hành vi thực tế. Khi người dùng ăn khác kế hoạch, gửi mô tả món ăn hoặc tải ảnh bữa ăn lên hệ thống, AI sẽ phân tích món ăn, ước lượng calories và các thành phần dinh dưỡng quan trọng như protein, fat, carbs, fiber, sugar và sodium. Sau đó, hệ thống tiếp tục xác nhận thời điểm bữa ăn, ghi nhận vào lịch sử sử dụng và điều chỉnh lại kế hoạch ăn uống trong ngày hoặc trong tuần để giữ cho tổng thể lộ trình vẫn bám sát mục tiêu ban đầu.

Một điểm quan trọng của Calorie AI là tính liên tục trong trải nghiệm. Người dùng không chỉ nhận kế hoạch một lần rồi tự theo dõi, mà có thể quan sát tiến trình qua dashboard dinh dưỡng trực quan, xem lịch thực đơn 7 ngày, mở chi tiết từng bữa và nhận phản hồi từ AI Coach trong cùng một hệ sinh thái — trên web lẫn trên điện thoại, kể cả **rảnh tay bằng giọng nói**. Khi deadline cũ kết thúc, sản phẩm hỗ trợ tái thiết lập chặng đường mới để người dùng tiếp tục quá trình cải thiện thể trạng mà không phải bắt đầu lại từ đầu.

## Tính năng cốt lõi

1. **Thiết lập & cá nhân hóa hồ sơ sức khỏe** — thu thập chỉ số cơ thể, mục tiêu, bệnh lý, dị ứng, macro ưu tiên; tính BMR / TDEE / calories mục tiêu / phân bổ macro làm "khung chuẩn" cho mọi đề xuất về sau.
2. **Phân tích & lập kế hoạch dinh dưỡng** — AI sinh thực đơn 7 ngày có cấu trúc (bữa chính, bữa phụ, đủ 10 trường dinh dưỡng mỗi bữa), tái cân bằng động khi người dùng ăn lệch kế hoạch.
3. **AI Coach & phân tích bữa ăn thông minh** — hỏi đáp dinh dưỡng theo ngữ cảnh cá nhân; phân tích món ăn từ **văn bản** hoặc **ảnh chụp** (vision model đếm từng món trên đĩa); xác nhận bữa và ghi vào lịch sử.
4. **Theo dõi tiến trình & điều chỉnh động** — dashboard chỉ số, biểu đồ tuần, cảnh báo sức khỏe dựa trên 7 ngày ăn gần nhất, nhật ký ảnh món ăn.
5. **Knowledge Base y khoa (RAG)** — kho tài liệu dinh dưỡng theo bệnh lý (tiểu đường, gout, gan nhiễm mỡ, mỡ máu, thận, tiêu hóa) + PDF do quản trị viên tải lên; AI **neo khuyến nghị vào tài liệu** thay vì trả lời tự do, có cơ chế từ chối khi tài liệu không chứa câu trả lời (chi tiết ở mục RAG bên dưới).
6. **Trợ lý ảo giọng nói — AI Agent (mobile)** — đánh thức bằng "Xin chào Calorie", ra lệnh và trò chuyện rảnh tay: đặt nhắc uống nước/uống thuốc, điều hướng app, hỏi số liệu đã nạp, tạo thực đơn mới, ghi bữa ăn bằng giọng nói (chi tiết ở mục AI Agents bên dưới).

## Kiến trúc hệ thống

```
┌─────────────────┐        ┌───────────────────────────┐
│  Web (Vercel)   │        │  Mobile (Expo RN)         │
│  public/*.html  │        │  calorie-ai-mobile        │
│  Chart.js, i18n │        │  Voice Agent + màn hình   │
└────────┬────────┘        └─────┬─────────────────┬───┘
         │  HTTPS                │ dữ liệu         │ hội thoại Trợ lý
         ▼                       ▼                 │ (đi thẳng, né trần 60s)
┌──────────────────────────────────────────┐       │
│  Serverless API (Node, Vercel /api/*)     │      │
│  auth · setup · diet-info · chat          │      │
│  coach-dynamic · analyze-food · kb-query  │      │
│  food-diary · chat-history · admin        │      │
├──────────────┬───────────────┬────────────┤      │
│ Supabase     │ Engine dinh   │ RAG (FTS)  │      │
│ Auth+Postgres│ dưỡng tất định│ 2 lớp KB   │      │
└──────────────┴───────┬───────┴────────────┘      │
                       ▼                           ▼
              ┌────────────────────────────────────────┐
              │  vLLM self-host (OpenAI-compatible /v1)│
              │  Qwen3-VL 32B FP8 — text + vision      │
              └────────────────────────────────────────┘
```

| Endpoint                    | Vai trò                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `POST /api/auth`            | Đăng ký / đăng nhập / refresh phiên (Supabase Auth)          |
| `POST /api/setup`           | Lưu hồ sơ sức khỏe, tính BMR/TDEE/macro                      |
| `GET /api/diet-info`        | Chỉ số nền + hồ sơ cho dashboard                             |
| `POST /api/chat`            | Hội thoại AI Coach: văn bản + ảnh, phân tích món, ghi bữa    |
| `POST /api/coach-dynamic`   | Sinh/cập nhật thực đơn 7 ngày, ước tính món lẻ, health check |
| `POST /api/analyze-food`    | Phân tích ảnh món ăn độc lập (thêm món ngoài thực đơn)       |
| `POST /api/kb-query`        | Hỏi đáp **STRICT** trên Knowledge Base (có cổng từ chối)     |
| `GET /api/food-diary`       | Nhật ký ảnh món ăn đã phân tích                              |
| `GET /api/chat-history`     | Lịch sử hội thoại                                            |
| `/api/admin` + `admin.html` | Tải PDF vào Knowledge Base, quản trị kho món                 |

## Công nghệ áp dụng

- **Frontend web**: HTML/CSS/JavaScript thuần + **Chart.js** cho biểu đồ dinh dưỡng; i18n song ngữ Việt–Anh.
- **Mobile**: **React Native (Expo SDK 55)** — React Navigation, Reanimated, chart-kit; đồng bộ offline-first bằng AsyncStorage (cache thực đơn + lịch sử chat).
- **Backend**: **Node.js serverless functions** trên **Vercel** — mỗi API là một function độc lập, cấu hình `maxDuration` riêng trong `vercel.json`.
- **Dữ liệu & xác thực**: **Supabase** (Auth + PostgreSQL) — hồ sơ, thực đơn tuần, lịch sử chat, kho món ăn `foods`, cache mốc dinh dưỡng `nutrition_anchors`, hai bảng tri thức `kb_base_chunks` / `admin_kb_chunks`; **Supabase Storage** lưu PDF gốc (bucket `admin-pdfs`, signed URL); **Cloudinary** lưu ảnh nhật ký món ăn (tùy chọn mirror PDF).
- **LLM tự vận hành (self-host)**: **Qwen3-VL 32B (FP8)** phục vụ qua **vLLM** với giao thức **OpenAI-compatible** (`/v1/chat/completions`). Toàn bộ cấu hình qua biến môi trường `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` (`lib/llm.js`) — đổi server/model không cần sửa code. Một model duy nhất xử lý cả **văn bản lẫn hình ảnh** (vision). Tùy chọn **Gemini** làm vision provider ưu tiên, tự fallback về Qwen khi lỗi (`lib/vision.js`).
- **Engine dinh dưỡng tất định** (`lib/nutrition.js`): LLM chỉ **nhận diện** món + định lượng; **con số** do engine tính — bóc định lượng (phân số, số từ Việt/Anh, đơn vị) → mốc chuẩn per-100g/per-unit theo thứ tự **USDA FDC → OpenFoodFacts → bảng tham chiếu VN → AI temp 0 seed 42** (có cache DB + RAM) → nhân tuyến tính → kiểm định **Atwater** (kcal ≈ 4P + 4C + 9F). Cùng một món luôn ra cùng một con số giữa các lần gọi.
- **RAG không embeddings**: truy hồi bằng **PostgreSQL Full Text Search** (tsvector + GIN + ts_rank) — xem mục kế tiếp.
- **Wake word on-device**: **Picovoice Porcupine** ("Xin chào Calorie") chạy hoàn toàn trên máy, không stream âm thanh lên cloud.

---

## RAG — Knowledge Base có kiểm soát

### Vì sao chọn Full Text Search thay vì embeddings?

Kho tri thức của bài toán này là **tài liệu khuyến nghị ăn uống theo bệnh lý** — truy vấn của người dùng chứa đúng các từ khóa chuyên môn xuất hiện trong tài liệu (tên bệnh, tên thực phẩm, tên chất). Với đặc thù đó, PostgreSQL FTS (`tsvector` + chỉ mục `GIN` + xếp hạng `ts_rank` + `websearch_to_tsquery`) cho kết quả chính xác, **không cần máy chủ embedding, không vector DB, không thêm chi phí mạng** — toàn bộ ranking diễn ra ngay trong Supabase Postgres, mỗi truy vấn chỉ là một RPC. Điều này cũng làm hệ thống **dễ kiểm chứng**: điểm `rank` của từng đoạn được trả về trong `trace`, nhìn được vì sao một đoạn được chọn.

### Kiến trúc kho tri thức 2 lớp

| Lớp                     | Bảng              | Nguồn                                                                                                                          | Đặc điểm                                                                                 |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **Base** (tích hợp sẵn) | `kb_base_chunks`  | 6 tài liệu bệnh lý (tiểu đường, gan nhiễm mỡ, gout, mỡ máu, thận, tiêu hóa) → 63 đoạn, seed từ `knowledge/knowledge-base.json` | Có `disease_key` + nhãn tiếng Việt để **định tuyến theo bệnh lý trong hồ sơ** người dùng |
| **Admin KB** (mở rộng)  | `admin_kb_chunks` | PDF do quản trị viên tải lên qua `admin.html` (kho hiện tại: 74 tài liệu)                                                      | Cập nhật nóng, không cần deploy lại; file gốc lưu Supabase Storage                       |

### Pipeline INGEST (nạp tài liệu) — 5 bước

1. **Upload**: quản trị viên tải PDF qua `admin.html` → `/api/admin`; file gốc lưu vào Supabase Storage (bucket riêng tư `admin-pdfs`, tải về bằng signed URL 1 giờ).
2. **Parse**: `lib/rag/parse-pdf.js` trích văn bản từng trang.
3. **Chunk**: `lib/rag/chunker.js` cắt đoạn **theo đoạn văn/câu** (không cắt giữa từ), có **overlap** giữa các đoạn liên tiếp để không mất ngữ cảnh ở ranh giới; bảng biểu dài được hard-wrap an toàn.
4. **Lưu**: các đoạn ghi vào `admin_kb_chunks` (Postgres) kèm chỉ số đoạn, tên tài liệu.
5. **Đánh chỉ mục**: migration `migrations/fulltext_search.sql` tạo cột `tsv` (tsvector) + chỉ mục GIN + hai hàm RPC `search_admin_kb_chunks` / `search_base_kb_chunks`. Lớp Base được seed một lần bằng `scripts/seed-base-knowledge.mjs` (JSON build từ `scripts/ingest-knowledge.mjs`).

### Pipeline TRUY HỒI (retrieval) — 4 bước cho mỗi câu hỏi

1. **Tạo truy vấn**: ghép `bệnh lý trong hồ sơ + câu hỏi` → `websearch_to_tsquery` (hiểu cú pháp tìm kiếm tự nhiên).
2. **Tìm song song 2 lớp**: gọi đồng thời 2 RPC trên `kb_base_chunks` và `admin_kb_chunks`, mỗi bên lấy dư (topK + 4) ứng viên kèm điểm `ts_rank`.
3. **Định tuyến & xếp hạng**: đoạn thuộc đúng bệnh lý của người dùng được **cộng điểm** (`RAG_ROUTE_BONUS`, mặc định +0.05 — chỉ ưu tiên, không lọc cứng); trộn 2 lớp, sắp theo điểm.
4. **Cắt theo ngân sách**: chọn tối đa `topK` đoạn trong giới hạn ký tự (`maxChars`) — giữ prompt gọn để model không "chốt EOS sớm". Mọi lỗi ở tầng này trả kết quả rỗng, **không bao giờ làm gãy luồng chat**.

### Hai chế độ trả lời — cốt lõi của "neo vào tài liệu để không bịa"

**Chế độ 1 — STRICT (tra cứu Knowledge Base, `/api/kb-query`):** dùng khi người dùng hỏi trực tiếp kho tài liệu. Có **hai lớp cổng chống bịa**:

- **Cổng tin cậy chạy TRƯỚC khi gọi LLM** (`kbHasConfidentHit`): không có đoạn nào khớp FTS hoặc điểm cao nhất dưới ngưỡng `RAG_KB_MIN_RANK` → trả về **đúng một câu chuẩn** `"Không tìm thấy trong Knowledge Base."` — model **không được gọi**, nên không tồn tại cơ hội bịa.
- **Prompt strict** khi qua cổng: cấm tuyệt đối kiến thức nền, buộc nêu tên mục/thực phẩm mà số liệu lấy ra, và nếu trích đoạn không chứa đúng dữ kiện được hỏi thì vẫn phải trả câu từ chối chuẩn ở trên (double gate).
- Response kèm **trace minh bạch**: engine, số đoạn dùng, điểm rank từng đoạn, preview nguồn, thời gian xử lý — kiểm chứng được pipeline bằng mắt.

**Chế độ 2 — BLENDED (AI Coach: chat, thực đơn, health check):** trích đoạn KB được **tiêm vào prompt như nguồn ưu tiên** (`buildKnowledgeSection`) với quy tắc: khuyến nghị theo bệnh lý **bắt buộc** bám tài liệu; món thuộc nhóm "nên tránh" theo tài liệu → cảnh báo + gợi ý thay thế; và khi tài liệu **không đề cập** điều được hỏi, model được phép dùng kiến thức dinh dưỡng phổ quát nhưng **phải nói rõ đây là khuyến nghị chung và cấm bịa số liệu y khoa cụ thể**.

**Chính sách khi câu hỏi nằm NGOÀI phạm vi tài liệu (3 tầng):**

| Tầng | Tình huống                                              | Hành vi                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Hỏi tra cứu KB (`/api/kb-query`) mà tài liệu không chứa | **Từ chối chuẩn** "Không tìm thấy trong Knowledge Base." — chặn trước khi gọi LLM                                                                                                                                                           |
| 2    | Tư vấn coach, tài liệu không phủ                        | Trả lời từ kiến thức dinh dưỡng phổ quát, **dán nhãn "khuyến nghị chung"**, không số liệu y khoa bịa                                                                                                                                        |
| 3    | Con số dinh dưỡng (calories/macro)                      | **Không bao giờ tự do**: luôn qua engine tất định (USDA → OFF → tham chiếu VN → AI temp 0 seed 42 + Atwater); `nutritionFromKnowledgeBase` ưu tiên số trong tài liệu upload với cùng cổng tin cậy, không đạt → `found:false`, giữ số engine |

### Grounding số liệu từ tài liệu

Ngoài hỏi đáp, KB còn được dùng để **ghi đè số liệu dinh dưỡng**: khi phân tích món ăn, `nutritionFromKnowledgeBase` tra đúng món + khẩu phần trong tài liệu upload (cùng cổng tin cậy + prompt strict chỉ-dùng-số-trong-trích-đoạn, temp 0). Có số chuẩn trong tài liệu → dùng; không có → giữ nguyên kết quả engine/vision. Nghĩa là tài liệu của quản trị viên trở thành **nguồn số liệu ưu tiên nhất** của toàn hệ thống.

### Tinh chỉnh qua biến môi trường

`RAG_ROUTE_BONUS` (điểm cộng đúng bệnh lý), `RAG_ADMIN_BONUS`, `RAG_KB_MIN_RANK` (ngưỡng cổng tin cậy), `RAG_DEBUG=1` (log chi tiết pipeline). Kiểm tra nhanh: `GET /api/kb-query?action=ping` (smoke test FTS), `?action=status` (số PDF/đoạn đang có).

---

## AI Agents — Trợ lý ảo giọng nói (mobile)

Trợ lý trên app di động được thiết kế theo đúng mô hình **agent**: một bộ **phân loại ý định**, một bộ **công cụ (tools)** thao tác vào chính app, và **LLM** cho phần hội thoại — thay vì "mọi câu đều ném vào chatbot".

### Pipeline một lượt nói — 6 bước

1. **Wake word (on-device)**: Porcupine lắng nghe "Xin chào Calorie" ngay trên máy — không stream âm thanh lên mạng, tiết kiệm pin; hoặc chạm nút mic. Mic được **điều phối** giữa engine wake và STT (tạm dừng Porcupine khi vào lượt nói, bật lại khi idle).
2. **STT (nhận giọng)**: `expo-speech-recognition` qua một **arbiter đơn sở hữu** (`voice/recognizer.js`) — session mới chiếm quyền mic sạch sẽ, khử transcript trùng lặp; chốt lượt theo **im lặng ~2.2s** (trần 15s), kèm gợi ý từ vựng (`contextualStrings`) cho tên món Việt.
3. **Phân loại ý định** (`agent/classify.js` — hàm thuần, dùng chung với màn Chat): `COMMAND | LOG_MEAL | ANALYZE_FOOD | RECOMMEND | GENERAL`. Quy tắc quan trọng: chỉ `LOG_MEAL` mới được hỏi "ăn vào bữa nào?"; xin gợi ý (RECOMMEND) thì **không bao giờ** bị hỏi bữa.
4. **Thực thi**:
   - **COMMAND** → gọi thẳng **tools trong app, không cần LLM** (phản hồi tức thì): đặt nhắc uống nước/thuốc/bữa ăn (parse giờ Việt–Anh "3 giờ chiều"/"3pm"), điều hướng tab, hỏi calo/macro còn lại hôm nay (tính từ dữ liệu cục bộ), tạo lại thực đơn, sửa cân nặng hồ sơ.
   - **Còn lại** → **lượt hội thoại LLM đi thẳng vLLM** (xem mục dưới); có món cụ thể thì kèm thẻ dinh dưỡng `<data>`.
5. **Slot-filling ghi bữa**: câu nói kiểu "tôi vừa ăn 2 quả trứng" → trợ lý nhận diện món, hỏi bữa **đúng một lần** nếu chưa rõ, rồi ghi qua backend (`meal_time_update`) — cùng một luồng với nút xác nhận trên màn Chat, thực đơn được tái cân bằng và đồng bộ về màn Kế hoạch.
6. **TTS**: đọc câu trả lời (đã lọc markdown/ký tự lạ để giọng đọc tự nhiên), xong tự lắng nghe tiếp khi vừa hỏi người dùng — hội thoại liền mạch, rảnh tay hoàn toàn.

### Tích hợp LLM kiểu hybrid — quyết định kiến trúc quan trọng

Vercel gói Hobby **giết mọi request quá 60 giây**, trong khi lượt coach của `/api/chat` (prompt chứa cả thực đơn 7 ngày, sinh tối đa 2.500 token) chạy ~60s ở tốc độ ~42 token/giây của server vLLM — nghĩa là hội thoại của Trợ lý thường xuyên chết đúng ngưỡng. Giải pháp: **tách đường hội thoại khỏi đường dữ liệu**.

|          | Đường HỘI THOẠI (mới)                                                                                      | Đường DỮ LIỆU                               |
| -------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Đi qua   | App → **thẳng vLLM** (`/v1/chat/completions`)                                                              | App → backend Vercel → Supabase             |
| Cấu hình | `process.env.LLM_BASE_URL / LLM_API_KEY / LLM_MODEL` — cùng bộ biến với backend, nhúng qua `app.config.js` | `EXPO_PUBLIC_API_BASE_URL`                  |
| Prompt   | **Gọn kiểu thoại** (1–3 câu + `mealData` JSON khi có món) → phản hồi **~3 giây**                           | Prompt đầy đủ (KB, foods DB, thực đơn)      |
| Dùng cho | Lượt trò chuyện của Trợ lý                                                                                 | Ghi bữa, sinh/đổi thực đơn, lịch sử, hồ sơ  |
| Khi lỗi  | **Tự fallback** về `/api/chat` như cũ                                                                      | Timeout 65s (chờ hết cửa sổ 60s của Vercel) |

Kết quả: hội thoại giọng nói không còn dính trần 60s và nhanh hơn ~20 lần ở các câu bị xếp nhánh coach, trong khi mọi thao tác **ghi dữ liệu** vẫn đi qua backend để giữ nguyên tính đúng đắn (engine dinh dưỡng, tái cân bằng thực đơn, lịch sử, nhật ký). Parse phản hồi chịu lỗi ở client (bỏ `<think>`, cứu JSON cắt cụt, chặn output thoái hóa) — cùng triết lý chống hỏng với backend.

---

## User Flow

1. Người dùng truy cập hệ thống và tạo tài khoản hoặc đăng nhập.
2. Người dùng hoàn thiện hồ sơ cá nhân với các thông tin cơ thể, mục tiêu và thói quen ăn uống.
3. Hệ thống tính toán BMR, TDEE, calories mục tiêu mỗi ngày và tỷ lệ macro phù hợp.
4. AI tạo thực đơn 7 ngày đầu tiên dựa trên dữ liệu hồ sơ và định hướng sức khỏe của người dùng.
5. Người dùng theo dõi các chỉ số dinh dưỡng và tiến trình cá nhân qua dashboard trực quan.
6. Trong quá trình sử dụng, người dùng trò chuyện với AI Coach (gõ chữ, nói, hoặc gửi ảnh món ăn) để hỏi dinh dưỡng, khẩu phần, cách điều chỉnh bữa.
7. Hệ thống phân tích món, hiển thị thẻ dinh dưỡng, xác nhận bữa và ghi vào lịch sử; thực đơn được tái cân bằng khi ăn lệch kế hoạch.
8. Trên mobile, người dùng nói "Xin chào Calorie" để ra lệnh rảnh tay: đặt nhắc, hỏi số liệu, ghi bữa, đổi thực đơn.
9. Quản trị viên tải tài liệu y khoa vào Knowledge Base; AI lập tức dùng tài liệu mới để tư vấn theo bệnh lý.
10. Khi hoàn thành hoặc vượt qua deadline, người dùng cập nhật chỉ số để bắt đầu chặng mới, kế thừa lịch sử cũ.

## Workflow vận hành

Workflow của Calorie AI là một chuỗi xử lý liên kết giữa dữ liệu người dùng, logic dinh dưỡng và AI. Hồ sơ sức khỏe được chuẩn hóa thành khung định lượng (BMR/TDEE/calories/macro); AI sinh thực đơn 7 ngày trên khung đó và giữ kế hoạch làm **trạng thái trung tâm**. Khi người dùng gửi món ăn (chữ/ảnh/giọng nói), hệ thống nhận diện món → engine tất định tính số → xác nhận bữa → ghi lịch sử → đánh giá có cần tái cân bằng phần còn lại của ngày/tuần hay không. Mỗi câu hỏi gửi tới AI đều được đóng gói kèm hồ sơ, mục tiêu, thực đơn hiện tại, lịch sử tương tác, kho món đã lưu và **trích đoạn Knowledge Base liên quan** — AI không phản hồi như chatbot độc lập mà như một thành phần trong chuỗi vận hành có kiểm soát.

## Cài đặt & triển khai

### Backend + Web (repo này)

```bash
npm install
npx vercel dev          # chạy local (mặc định cổng 3000)
```

Biến môi trường bắt buộc: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (vd `qwen2.5-vl`). Tùy chọn: `LLM_VISION_MODEL`, `GEMINI_API_KEY` (vision ưu tiên), `FDC_API_KEY` (USDA), `CLOUDINARY_*` (nhật ký ảnh), `RAG_*` (tinh chỉnh RAG).

Trên Supabase cần chạy các migration trong `migrations/` (đặc biệt `fulltext_search.sql` cho RAG và `nutrition_anchors.sql` cho cache dinh dưỡng), sau đó seed lớp tri thức nền:

```bash
node scripts/seed-base-knowledge.mjs
node scripts/test-nutrition.mjs     # bộ hồi quy engine dinh dưỡng: 48/48 offline
```

Server LLM: xem `vllm-server/` — vLLM phục vụ Qwen3-VL 32B FP8, bật OpenAI-compatible API; backend chỉ cần trỏ `LLM_BASE_URL` vào đó.

### Mobile (`calorie-ai-mobile`)

```bash
npm install
npx expo start -c
```

- `.env`: `EXPO_PUBLIC_API_BASE_URL` (trỏ backend; bỏ trống dùng bản Vercel production) + `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL` cho đường hội thoại đi thẳng của Trợ lý (kéo nhanh bằng `vercel env pull`; thiếu thì Trợ lý tự dùng đường backend).
- Wake word "Xin chào Calorie" cần bản **EAS/dev build** + `EXPO_PUBLIC_PICOVOICE_ACCESS_KEY` (xem README của repo mobile); thiếu key thì nút "chạm để nói" vẫn hoạt động đầy đủ.

## Giá trị sản phẩm

Calorie AI mang lại giá trị ở cả góc độ người dùng lẫn góc độ công nghệ. Với người dùng, sản phẩm biến việc ăn uống lành mạnh thành một hành trình có định hướng rõ ràng, dễ theo dõi và thích ứng với đời sống thực tế. Với góc độ hệ thống, đây là một mô hình ứng dụng AI mang tính thực hành cao: **RAG có cổng kiểm soát** thay vì để mô hình trả lời tự do, **engine dinh dưỡng tất định** thay vì tin con số của LLM, **agent giọng nói** định tuyến ý định trước khi tốn một lượt suy luận, và **LLM tự vận hành** giúp chủ động chi phí lẫn dữ liệu. Sản phẩm đặc biệt phù hợp với định hướng phát triển các giải pháp AI ứng dụng trong sức khỏe đời sống, nơi AI không chỉ tạo nội dung mà phải vận hành như một thành phần có logic, có bối cảnh và có tính nhất quán trong toàn bộ hành trình người dùng.

## Nhóm tác giả

**Tác giả:** Vũ Trí Việt (Le Hong Phong High School for the Gifted)  

**Đồng tác giả:** Hồng Tú Quỳnh (Tran Dai Nghia High School for the Gifted)
