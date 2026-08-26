================================================================================
 BENCHMARK MODEL VISION — Vietnamese_StreetFood_14Class
================================================================================

Đây là BENCHMARK (đo và so sánh), KHÔNG train, KHÔNG fine-tune.
Toàn bộ code nằm trong thư mục testmodel/. Không file nào của dự án chính bị sửa.


--------------------------------------------------------------------------------
 CHẠY — MỘT LỆNH DUY NHẤT
--------------------------------------------------------------------------------

  cd d:/Project/THT-D3
  py testmodel/benchmark.py

QUAN TRỌNG — ID MODEL PHẢI ĐÚNG TÊN SERVER ĐĂNG KÝ
  Server vLLM đăng ký model theo --served-model-name, tên đó KHÔNG nhất thiết
  giống tên trọng số. Ở đây trọng số là qwen3-vl-32b-instruct-fp8 nhưng id phải
  gọi là "qwen2.5-vl". Đặt LLM_VISION_MODEL="qwen3-vl" là mọi lời gọi trả
  HTTP 404 và bảng điểm ra 0%.
  Benchmark nay kiểm id ngay giây đầu và in ra danh sách id có thật.

LƯU Ý VỀ LỆNH PYTHON: trên máy này `python` KHÔNG chạy được (Windows đang trỏ
alias sang Microsoft Store). Phải dùng `py`. Kiểm tra bằng:  py --version
(đang là Python 3.11.0)

Mặc định lấy tối đa 15 ảnh MỖI class (~187 ảnh), chạy khoảng 3 phút.


 Các cách chạy khác:

  py testmodel/benchmark.py --all              # toàn bộ 1070 ảnh test (~15 phút)
  py testmodel/benchmark.py --per-class 40     # 40 ảnh mỗi class
  py testmodel/benchmark.py --models project   # chỉ chạy model của dự án
  py testmodel/benchmark.py --no-cache         # bỏ cache, đo lại từ đầu
  py testmodel/benchmark.py --seed 7           # đổi bộ ảnh được lấy mẫu


--------------------------------------------------------------------------------
 ĐÃ ĐO ĐƯỢC GÌ (187 ảnh, 15 ảnh mỗi class, seed 42, bài closed14)
--------------------------------------------------------------------------------

  BIẾN THỂ       ACCURACY  MACRO-F1   LATENCY  GỌI/ẢNH   McNemar p vs base
  base             70.05%    0.6953     818ms     1.00   —
  gloss            92.51%    0.9245     918ms     1.00   0.000   HƠN rõ rệt
  gloss_hires      92.51%    0.9245     917ms     1.00   0.000   HƠN rõ rệt
  cascade          92.51%    0.9250    1332ms     1.00   0.000   HƠN rõ rệt
  vote3            92.51%    0.9233    4272ms     3.00   0.000   HƠN rõ rệt
  hires            68.98%    0.6888     816ms     1.00   0.625   không phân biệt được

TOÀN BỘ MỨC TĂNG ĐẾN TỪ CHÚ GIẢI NHÃN. Mọi cơ chế cộng thêm — nâng độ phân giải,
cascade, bỏ phiếu 3 lượt — đều dừng ở đúng 173/187, không cứu thêm được ảnh nào,
chỉ tốn thêm thời gian. vote3 gọi gấp 3 lần mà kết quả y hệt gloss.

VÌ SAO CHÚ GIẢI LẠI ĂN NHIỀU ĐIỂM ĐẾN THẾ
  data.yaml đặt tên hai class gần như trùng chữ, và ánh xạ NGƯỢC với trực giác:
      class 4  "Grilled Pork with Vermicelli"  = Bún chả
      class 6  "Grilled Pork Vermicelli"       = Bún thịt nướng
  Ở mốc base, 14/56 lỗi là model đảo qua đảo lại đúng cặp này. Mở ảnh gốc ra xem
  thì model KHÔNG nhìn sai — nó phân biệt đúng hai món rồi gán nhầm chuỗi tiếng
  Anh. Đó là lỗi ĐẶT TÊN NHÃN, không phải lỗi thị giác, và không model nào đoán
  ra quy ước đó nếu không được nói.
  Đây cũng là lý do phần lớn khoảng cách 70% → 92.5% KHÔNG phải "model dốt" — nó
  là bài toán ra đề mập mờ. Đừng đọc con số 70% như thước đo năng lực model.

CASCADE KHÔNG SHIP — có lý do bằng số:
  Cổng dự định là "model tự nhận không chắc thì hỏi lại lượt 2". Đo ra: model
  khai confidence="high" trên 187/187 ảnh, kể cả những ảnh nó đoán sai. Cổng
  không kích hoạt lần nào (0/187). Lời tự khai của model là một HẰNG SỐ, không
  mang thông tin.
  Cổng thay thế dựa trên logprob (server có bật) thì có tín hiệu thật nhưng yếu:
  gọi lại 28.9% số ảnh mới bắt được 60.7% số lỗi, và TRẦN TRÊN chỉ 88.24% — vẫn
  thấp hơn 92.51% mà gloss đạt được với đúng 1 lời gọi. Nên bỏ cascade.
  Chạy lại phân tích này bằng:  py testmodel/analyze_gate.py --variant base

ĐỘ PHÂN GIẢI: xem mục GIỚI HẠN ở cuối file trước khi kết luận bất cứ điều gì.


PIPELINE THẬT CỦA APP — TRƯỚC/SAU khi thêm chú giải vào lib/vision.js
(70 ảnh, 5 ảnh mỗi class, seed 42, cùng một bộ ảnh cho cả hai lượt)

                  ACCURACY   LATENCY   sai→đúng   đúng→sai   McNemar p
  trước             60.00%     15.5s          —          —   —
  sau               75.71%     14.5s         13          2   0.0074

  +15.71 điểm, p = 0.0074 → HƠN rõ rệt. Vẫn đúng 1 lời gọi mỗi ảnh, không chậm
  thêm. Thay đổi duy nhất: thêm mục "cặp dễ nhầm" cho bún chả / bún thịt nướng /
  bún đậu mắm tôm / xôi vs cơm / bánh giò / cốm / gỏi cuốn vs nem rán / bánh
  cuốn vs bún lá / cháo vs phở, vào cả VISION_PROMPT_VI lẫn VISION_PROMPT_EN.

  Mức tăng ở đây (+15.7) THẤP HƠN ở bài closed14 (+22.5) — hợp lý, vì bài mở khó
  hơn: app còn phải tự nghĩ ra tên món chứ không được cho sẵn 14 lựa chọn, và
  còn nhiều lỗi không liên quan tới cặp dễ nhầm.

  LƯU Ý VỀ CON SỐ 60.00%: lượt 'trước' ban đầu chấm ra 58.57%. Chênh lệch KHÔNG
  phải do model — do một lỗi trong bảng ánh xạ của chính benchmark: câu trả lời
  "Bún thịt nướng kèm tôm và nem rán" bị luật loại trừ "nem rán" đánh trượt, dù
  món chính đúng là bún thịt nướng. Sửa luật (chỉ loại khi cụm cấm là món CHÍNH,
  đứng trước mọi cụm hợp lệ) rồi chấm lại từ câu trả lời đã lưu — không gọi lại
  model lần nào. Cả hai lượt đều chấm bằng cùng một bảng đã sửa.



--------------------------------------------------------------------------------
 SO SÁNH CÁC CÁCH GỌI API (biến thể)
--------------------------------------------------------------------------------

Câu hỏi "chỉnh gì trong API thì nhận diện tốt lên" chỉ trả lời được bằng cách đo
nhiều cách gọi trên CÙNG bộ ảnh. Mỗi cách gọi gọi là một BIẾN THỂ, khai trong
testmodel/variants.py. Model và trọng số không đổi — vẫn là benchmark.

  py testmodel/benchmark.py --variant all --models project
  py testmodel/benchmark.py --variant base,gloss --models project

Các biến thể có sẵn:
  base         mốc so sánh — y hệt cách app đang gọi
  gloss        thêm chú giải tên Việt + dấu hiệu phân biệt cho từng nhãn
  hires        ép upscale ảnh (min_pixels 1.0MP)
  gloss_hires  cả hai
  cascade      1 lượt; model tự nhận không chắc thì hỏi lại lượt 2 giữa 2 ứng viên
  vote3        3 lượt temp 0.8 rồi bỏ phiếu (đo TRẦN TRÊN của self-consistency)

Chạy từ 2 biến thể trở lên thì cuối chương trình in thêm bảng SO TỪNG ẢNH:

  BIẾN THỂ      ACC    Δ ACC   sai→đúng  đúng→sai      p   gọi/ảnh  KẾT LUẬN

  p = McNemar hai phía (bản chính xác, nhị thức — mẫu nhỏ nên không xấp xỉ
  chi-bình-phương). p >= 0.05 nghĩa là chênh lệch CHƯA đủ bằng chứng, dù cột
  Δ ACC có dương. Cột Δ một mình rất dễ đọc nhầm nhiễu thành cải tiến, nhất là
  ở mức 187 ảnh — nên đừng ship chỉ vì con số đẹp.

  'gọi/ảnh' > 1 nghĩa là biến thể đó tốn thêm lời gọi mạng. Hơn 3 điểm nhờ gọi
  gấp 3 lần KHÔNG cùng loại với hơn 3 điểm mà vẫn 1 lần gọi.

CACHE TÁCH THEO BIẾN THỂ: results/cache/<model>__<biến thể>.jsonl. Gộp chung là
hỏng cả phép đo — chạy gloss xong rồi chạy base sẽ đọc lại kết quả của gloss mà
tưởng của base, hai biến thể ra điểm y hệt nhau, trông như "cải tiến không có
tác dụng" trong khi chưa hề gọi model lần nào.


--------------------------------------------------------------------------------
 ĐO PIPELINE THẬT CỦA APP (không chỉ bài 14 nhãn)
--------------------------------------------------------------------------------

Bài closed14 (chọn 1 trong 14 nhãn cho sẵn) chỉ là PROXY. App thật hỏi MỞ, dùng
prompt ~4000 token trong lib/vision.js + guided_json, rồi trả về tên món tiếng
Việt tự do. Điểm cao ở bài đóng KHÔNG bảo đảm app thật nhận đúng.

  py testmodel/benchmark.py --models app-pipeline --per-class 5 --tag truoc

Cách hoạt động: testmodel/app_pipeline.mjs mở MỘT tiến trình Node, import thẳng
analyzeFoodImage từ lib/vision.js (không chép prompt sang Python — chép là hôm
nay giống, sửa lib/vision.js một lần là lệch, rồi benchmark âm thầm đo một thứ
không còn tồn tại). Tên món trả về được dịch sang class id bằng bảng tay ở
testmodel/dish_map.py.

  Bảng ánh xạ KHÔNG đoán mò: "Bún" trơ trọi trả -1 (mơ hồ giữa 4 món bún trong
  bộ), "Nem rán" trả -1 (món chiên, còn class "Spring Rolls" của bộ này là GỎI
  CUỐN tươi), "Phở gà" trả -1 (class 11 là phở BÒ). Không khớp = INVALID = tính
  SAI. Kiểm bảng bằng:  py testmodel/test_dish_map.py

  --tag đặt nhãn cho lượt chạy và tách cache riêng, để đo TRƯỚC và SAU khi sửa
  lib/vision.js:   --tag truoc   …sửa code…   --tag sau

LƯU Ý: pipeline app chậm hơn bài đóng cả chục lần (sinh JSON dinh dưỡng đầy đủ
chứ không phải một nhãn), nên nó KHÔNG tự chạy trong lượt mặc định — phải gọi
đích danh --models app-pipeline.


--------------------------------------------------------------------------------
 "KHI NÀO COI LÀ MODEL KHÔNG CHẮC?" — TRẢ LỜI BẰNG SỐ
--------------------------------------------------------------------------------

  py testmodel/analyze_gate.py --variant base

Cascade chỉ đáng làm nếu phát hiện được ảnh sắp sai. Script này kiểm hai ứng
viên làm cổng trên cache đã đo: logprob trung bình của token sinh ra (xác suất
THẬT, server có bật logprobs) và trường "confidence" model tự khai.

Nó in luôn TRẦN TRÊN của cascade: giả sử lượt 2 sửa đúng HẾT phần cổng bắt
được thì accuracy tối đa lên tới đâu. Nếu trần đó còn thấp hơn một biến thể
chỉ sửa prompt, thì cascade không đáng làm — dồn công vào prompt.


--------------------------------------------------------------------------------
 CẦN CHUẨN BỊ GÌ
--------------------------------------------------------------------------------

1. Thư viện Python — MÁY BẠN ĐÃ CÓ ĐỦ, không cần cài gì thêm:
      requests, numpy, matplotlib
   (Cố ý KHÔNG dùng scikit-learn: máy bạn chưa có, mà precision/recall/F1 và
    confusion matrix thì tự tính bằng numpy được, đỡ phải cài thêm.)

2. Model của dự án: đọc tự động LLM_BASE_URL / LLM_API_KEY / LLM_VISION_MODEL
   từ file .env.local ở thư mục gốc dự án. Không phải khai lại.

3. Muốn so với model NGOÀI thì đặt khoá tương ứng rồi chạy lại. Thiếu khoá nào
   thì benchmark ghi "bỏ qua — chưa đặt ..." và vẫn chạy tiếp model còn lại,
   KHÔNG bịa số:

      set OPENAI_API_KEY=sk-...           (gpt-4o-mini)
      set GEMINI_API_KEY=...              (gemini-2.5-flash)
      set ANTHROPIC_API_KEY=sk-ant-...    (claude-sonnet-4)

   PowerShell thì dùng:  $env:OPENAI_API_KEY="sk-..."

   Muốn đổi sang model khác thì sửa cuối file adapters.py (hàm build_adapters).
   Đặt sai id thì preflight báo ngay giây đầu KÈM danh sách id có thật, không
   phải chạy hết vài phút mới biết. gemini-2.0-flash đã bị Google gỡ nên mặc
   định chuyển sang gemini-2.5-flash.


--------------------------------------------------------------------------------
 KẾT QUẢ NẰM Ở ĐÂU
--------------------------------------------------------------------------------

  testmodel/results/
     summary.csv                 mỗi model một dòng: accuracy, macro-P/R/F1,
                                 correct/wrong/invalid, latency trung bình + p50 + p95
     predictions.csv             TỪNG ảnh: nhãn thật, nhãn model đoán, cách khớp,
                                 latency, lỗi (nếu có), và nguyên văn model trả lời
     per_class.csv               accuracy / precision / recall / F1 của từng class
     confusion_<model>.csv       confusion matrix dạng bảng
     confusion_<model>.png       confusion matrix dạng hình
     cache/<model>.jsonl         cache để chạy lại không mất công

Cuối chương trình in ra bảng:

  MODEL | ACCURACY | MACRO-F1 | AVG LATENCY | CORRECT | WRONG | INVALID


--------------------------------------------------------------------------------
 CÁCH BENCHMARK LÀM VIỆC (đọc để hiểu con số, tránh hiểu nhầm)
--------------------------------------------------------------------------------

GROUND TRUTH
  Dataset gốc là YOLO detection (mỗi dòng nhãn = "class_id x y w h ..."), không
  phải classification. Nhưng đã kiểm: cả 1070/1070 ảnh trong test đều chỉ có
  ĐÚNG MỘT class, không ảnh nào đa class, không nhãn nào rỗng — nên dùng làm bài
  phân loại là hợp lệ, ground truth chính là class id đó.
  Ảnh nào có từ 2 class trở lên sẽ bị LOẠI kèm cảnh báo, không tự chọn bừa một
  class (đoán hộ ground truth là cách nhanh nhất để có bảng điểm sai).

CÔNG BẰNG GIỮA CÁC MODEL
  Mọi model nhận CÙNG bộ ảnh, CÙNG danh sách 14 class, CÙNG một prompt, không
  đổi một chữ. Model của dự án được gọi với đúng tham số mà app thật đang dùng
  (temperature 0, top_p 1, seed 42, mm_processor_kwargs min/max pixels lấy từ
  lib/vision.js) — lệch tham số thì con số đo được không còn phản ánh chất
  lượng model mà app thực sự chạy.

LẤY MẪU
  Mặc định lấy đều mỗi class (stratified), không lấy ngẫu nhiên toàn cục. Lý do:
  test set rất lệch — class hiếm nhất chỉ 9 ảnh, class nhiều nhất 234 ảnh. Lấy
  ngẫu nhiên sẽ để lọt class hiếm, mà macro-F1 lại tính trung bình theo class
  nên mất một class là lệch hẳn kết quả. Seed cố định (42) để lặp lại được.

INVALID TÍNH THẾ NÀO
  INVALID = model không trả ra nhãn hợp lệ, hoặc gọi API lỗi. Nó VẪN được tính
  là một lần đoán SAI ở mẫu số accuracy. Bỏ ra ngoài sẽ thưởng cho model hay im
  lặng hoặc hay lỗi.

MACRO-F1
  Trung bình cộng F1 của 14 class, không trọng số theo số ảnh — class hiếm nặng
  ngang class phổ biến. Với test set lệch như thế này, hãy nhìn macro-F1 chứ
  đừng chỉ nhìn accuracy: một model chỉ đoán giỏi vài class đông vẫn có
  accuracy cao mà macro-F1 thấp.

BÓC NHÃN TỪ CÂU TRẢ LỜI
  Ba mức, chặt trước lỏng sau: (1) JSON đúng định dạng đã yêu cầu, (2) tên class
  xuất hiện nguyên vẹn trong câu trả lời, (3) nhiều tên cùng khớp thì lấy tên
  DÀI NHẤT (vì "Grilled Pork" là khúc con của "Grilled Pork Vermicelli").
  KHÔNG đoán mò kiểu "có chữ rice thì chắc là Broken Rice" — đoán hộ model sẽ
  thổi phồng điểm của nó. Không khớp được thì tính INVALID.

CACHE / RESUME
  Mỗi ảnh đo XONG ghi ngay một dòng vào cache/<model>.jsonl. Ctrl+C hay mất
  mạng giữa chừng thì chạy lại chỉ đo phần còn thiếu. Muốn đo lại sạch thì thêm
  --no-cache, hoặc xoá thư mục results/cache/.

  Dòng tiến độ tách riêng "đo mới" và "cache", vì gộp lại thì mấy chục ảnh đầu
  hiện 0s trông như model chạy tức thì trong khi chưa hề gọi mạng. Thời gian còn
  lại cũng chỉ ước tính trên phần đo mới.

  Ảnh nào LỖI thì KHÔNG ghi cache. Nếu ghi, cache sẽ quay ra hại: một lần chạy
  dính rate-limit hay sai tên model làm hỏng cả trăm ảnh, rồi mọi lần chạy sau
  đều phát lại y nguyên lỗi cũ mà không gọi mạng lần nào — sửa xong lỗi vẫn thấy
  kết quả hỏng. Lỗi = coi như chưa đo, lần sau tự thử lại.

MODEL LỖI
  Trước khi đo, mỗi model bị kiểm tra một lần (preflight): id model có tồn tại
  không, khoá có hợp lệ không. Sai thì bỏ qua ngay kèm lý do và danh sách id
  đúng, không đốt hàng trăm ảnh để nhận cùng một câu lỗi.

  Lỗi TẠM THỜI khi đang đo (429 quá tải, 5xx, đứt mạng) được thử lại tối đa 4
  lượt, giãn dần 2s → 5s → 12s, và nghe theo Retry-After nếu máy chủ có gửi.
  Lỗi 400/401/404 thì không thử lại vì thử bao nhiêu lần cũng vậy.

  Lỗi ở một ảnh: ghi vào predictions.csv (cột error) và đi tiếp.
  Model hỏng TOÀN BỘ lời gọi: KHÔNG xếp hạng cùng các model khác, mà in riêng
  "KHÔNG CHẠY ĐƯỢC". Báo 0.00% cho một model chưa hề nhìn thấy tấm ảnh nào là
  so sánh sai bản chất — một bên đoán kém, một bên không chạy.
  Model hỏng trên 50% lời gọi bị gắn dấu (!) kèm cảnh báo, vì số liệu của nó
  chỉ dựa trên phần ảnh còn lại.


--------------------------------------------------------------------------------
 GIỚI HẠN — ĐỌC TRƯỚC KHI TRÍCH SỐ
--------------------------------------------------------------------------------

ĐỘ PHÂN GIẢI KHÔNG ĐO ĐƯỢC TRÊN BỘ NÀY
  Cả 1070 ảnh test đều đúng 640x640 = 409.600 pixel. Con số đó nằm gọn giữa
  min_pixels 200.704 và max_pixels 3.211.264, nên KHÔNG ảnh nào bị phóng to
  hay thu nhỏ — mọi thiết lập pixel budget trong khoảng đó cho ra y hệt nhau.
  Biến thể `hires` chỉ đo được chiều PHÓNG TO (ép min_pixels lên 1.0MP), tức
  chiều NGƯỢC với thực tế: ảnh người dùng chụp bằng điện thoại là 12MP và bị
  THU NHỎ xuống max_pixels. Bộ test này không nói được gì về chiều đó.
  → Đừng lấy kết quả `hires` làm căn cứ chỉnh QWEN_MAX_PIXELS.

BÀI ĐÓNG ≠ BÀI THẬT
  closed14 cho sẵn 14 nhãn để chọn. App thật hỏi mở, mọi món mọi quốc gia. Điểm
  ở đây là proxy, không phải chất lượng sản phẩm. Đo đường thật bằng
  --models app-pipeline (xem mục riêng phía trên).

PHẠM VI DATASET
  Chỉ có món đường phố Việt Nam, 14 món. Không nói được gì về món Hàn/Nhật/Ý mà
  app cũng phải nhận, cũng không nói được gì về ảnh chụp thiếu sáng, ảnh nhiều
  món trên một mâm, hay ảnh không phải đồ ăn.

KHÔNG TRAIN
  Không có bước học nào, không đụng trọng số. Mọi thay đổi đều ở tầng API:
  prompt, tham số decode, số lượt gọi.


--------------------------------------------------------------------------------
 GHI CHÚ VỀ MODEL CỦA DỰ ÁN
--------------------------------------------------------------------------------

Server vLLM khai model id là "qwen2.5-vl", nhưng đường dẫn trọng số thật là
/network-volume/models/qwen3-vl-32b-instruct-fp8 — tức đang chạy
Qwen3-VL-32B-Instruct FP8, không phải Qwen2.5-VL. Tên id chỉ là nhãn đặt lúc
khởi động vLLM. Benchmark gọi theo id nên vẫn đúng model, nhưng khi đọc kết quả
thì nhớ đây là Qwen3-VL-32B.
================================================================================
