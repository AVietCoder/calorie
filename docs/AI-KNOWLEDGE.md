# 🧠 Tích hợp kiến thức PDF cho AI (RAG)

Tài liệu này giải thích cách AI trong app đã được nâng cấp để **"học" và tư vấn dựa
trên 6 tài liệu PDF dinh dưỡng** (tiểu đường, gout, gan nhiễm mỡ, mỡ máu cao, bệnh
thận, bệnh tiêu hóa).

---

## 1. Tại sao dùng RAG thay vì fine-tune?

Bạn hỏi giữa **fine-tune mô hình** hay **"cách nào đó khác"**. Với mục tiêu *"cho AI
học các tài liệu PDF"*, cách đúng về mặt kỹ thuật là **RAG (Retrieval-Augmented
Generation)**, không phải fine-tune. Lý do:

| | Fine-tuning | **RAG (đã dùng)** |
|---|---|---|
| Dạy *kiến thức/sự thật* | ❌ Kém — fine-tune dạy *văn phong/định dạng*, không nhớ chính xác nội dung | ✅ Tốt — AI đọc trực tiếp đoạn văn gốc |
| Chi phí | Tốn tiền train + train lại mỗi lần đổi tài liệu | ✅ Gần như miễn phí |
| Cập nhật tài liệu | Phải train lại cả mô hình | ✅ Chỉ chạy lại 1 script |
| Trích dẫn nguồn | Không | ✅ Có thể nói "theo tài liệu …" |
| Chạy "trong file zip" | Không thể (cần dịch vụ train riêng của OpenAI) | ✅ Chạy ngay trong code |

➡️ Vì vậy app dùng RAG: khi người dùng chat, hệ thống **lấy ra những đoạn tài liệu
liên quan đến bệnh của họ** rồi chèn vào prompt làm "kiến thức nền" cho AI.

---

## 2. Các file đã thêm / sửa

```
api/
  knowledge/
    knowledge-base.json        ← (MỚI) dữ liệu: 63 đoạn trích từ 6 PDF, gắn nhãn theo bệnh
  lib/
    knowledge.js               ← (MỚI) bộ truy xuất: chọn đúng tài liệu theo bệnh + xếp hạng
  chat.js                      ← (SỬA) chèn kiến thức vào prompt tư vấn & phân tích ảnh
  coach-dynamic.js             ← (SỬA) chèn kiến thức khi tạo thực đơn 7 ngày

scripts/
  sources/*.pdf                ← (MỚI) 6 PDF gốc (để build lại offline)
  build-knowledge-base.py      ← (MỚI) trích xuất PDF → knowledge-base.json
  ingest-knowledge.mjs         ← (MỚI) TÙY CHỌN: thêm embedding để tìm kiếm thông minh hơn
  requirements.txt             ← (MỚI) thư viện python cho build script

vercel.json                    ← (SỬA) đảm bảo file knowledge được đóng gói khi deploy
```

> **Không thêm thư viện npm mới.** Bộ truy xuất chỉ dùng `openai` (đã có sẵn) và các
> module built-in (`fs`, `path`). Vì thế `package.json` không đổi.

---

## 3. Cách hoạt động

Khi người dùng nhắn tin / tạo thực đơn:

1. App đọc trường `disease` trong hồ sơ người dùng (vd: `"Gout"`, `"Tiểu đường"`,
   `"Bệnh thận"`…).
2. `knowledge.js` **so khớp tên bệnh** (không phân biệt hoa thường / dấu tiếng Việt)
   với nhãn của từng tài liệu → chọn đúng tài liệu của bệnh đó.
3. Lấy các đoạn liên quan nhất, chèn vào prompt dưới mục
   **"TÀI LIỆU CHUYÊN MÔN VỀ DINH DƯỠNG THEO BỆNH LÝ"**, kèm hướng dẫn để AI ưu tiên
   tuân theo (món nên ăn / nên tránh).
4. Nếu người dùng **không có bệnh** (hoặc bệnh không có tài liệu, vd "Huyết áp cao"),
   hệ thống **không chèn gì** → AI tư vấn như bình thường.

### Hai chế độ truy xuất

- **Mặc định — định tuyến theo bệnh (không cần cài gì):** dùng được ngay. Vì câu hỏi
  của người dùng là tiếng Việt còn tài liệu là tiếng Anh, việc chọn tài liệu dựa trên
  *tên bệnh* là cách ổn định nhất.
- **Tùy chọn — tìm kiếm ngữ nghĩa (semantic):** nếu chạy `scripts/ingest-knowledge.mjs`
  một lần, mỗi đoạn sẽ có thêm *embedding*. Khi đó AI tìm theo **ý nghĩa câu hỏi cụ thể**
  (vd *"cá hồi có tốt cho người gút không?"*) và khớp được cả câu tiếng Việt với tài
  liệu tiếng Anh. App tự động chuyển sang chế độ này khi thấy có embedding.

---

## 4. Cách chạy lại / bảo trì

### A. Cập nhật khi sửa hoặc thêm tài liệu PDF
```bash
pip install -r scripts/requirements.txt        # lần đầu
# 1) bỏ PDF mới vào scripts/sources/
# 2) nếu là bệnh mới, thêm 1 mục vào DISEASE_MAP trong build-knowledge-base.py
python scripts/build-knowledge-base.py          # tạo lại api/knowledge/knowledge-base.json
```

### B. (Tùy chọn) Bật tìm kiếm ngữ nghĩa
```bash
OPENAI_API_KEY=sk-... node scripts/ingest-knowledge.mjs
```
Chạy lại bước này mỗi khi build lại knowledge-base ở bước A.

> Nếu **không** chạy bước B, app vẫn hoạt động tốt nhờ định tuyến theo bệnh.

---

## 5. Biến môi trường (giữ nguyên như cũ)

App vẫn dùng các biến cũ; không cần thêm biến mới:
- `OPENAI_API_KEY` — bắt buộc (đã dùng cho chat). Cũng dùng cho embedding (nếu bật).
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — như cũ.

---

## 6. Kiểm thử nhanh

1. Vào phần thiết lập, chọn mục tiêu **"Cải thiện / hỗ trợ điều trị bệnh"** và chọn
   bệnh (vd **Gout**).
2. Vào màn hình chat, hỏi: *"Tôi ăn lòng heo và uống bia có sao không?"*
3. AI sẽ cảnh báo dựa trên tài liệu gout (hạn chế nội tạng, rượu bia, đồ ngọt…) và
   gợi ý món thay thế — thay vì trả lời chung chung như trước.

Trong log server bạn sẽ thấy dòng như:
`📚 [chat] đã chèn 3 đoạn kiến thức (mode=lexical, bệnh=gout)`
