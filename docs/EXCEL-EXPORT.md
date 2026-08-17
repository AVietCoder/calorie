# Phân hệ Excel — Xuất thực đơn & Nhập file thông minh

Tài liệu kiến trúc cho `lib/excel/`, `lib/family-menu/{ingredients,units,pricing,shopping,plan-export}.js`
và `knowledge/{excel-theme,excel-template-profiles,ingredient-catalog,ingredient-prices}.json`.

---

## 1. Vấn đề

Trước bản này hệ thống **chưa có** chức năng xuất thực đơn ra Excel. Chỗ duy nhất
dùng Excel là nút tải file mẫu trống ở `/menu-library` (nay là `drfit-mau-nhap-thuc-don.xlsx`, 17 cột) và bộ đọc file đó.
Kế hoạch tuần và danh sách đi chợ chỉ hiển thị trên web.

Yêu cầu: file sinh ra phải **không phân biệt được** với 43 file thực đơn mẫu do
các bệnh viện / nhà thuốc / trung tâm dinh dưỡng công bố, đồng thời in đẹp trên A4
và có thêm dinh dưỡng, đi chợ, tổng hợp.

---

## 2. Kiến trúc

```
                    ┌──────────── XUẤT ────────────┐

  Supabase ──▶ plan-export.js ──▶ templates/*.js ──▶ styles.js ──▶ renderer.js ──▶ .xlsx
              (DATA)              (TEMPLATE)         (STYLE)       (ENGINE)
                                        ▲                ▲
                                        │                │
                              templates/index.js    theme.js
                                (REGISTRY)      ◀── knowledge/excel-theme.json
                                                          ▲
                                        scripts/extract-excel-templates.py
                                                          ▲
                                              43 file mẫu tham chiếu


                    ┌──────────── NHẬP ────────────┐

  Upload ──▶ read-sheet.js ──▶ analyze-layout.js ──▶ [ai-structure.js] ──▶ normalize.js ──▶ DB
             (lưới thô)        (5 chiến lược)         (chỉ khi cần)        (days[])
```

Năm tầng tách bạch, mỗi tầng chỉ phụ thuộc tầng dưới:

| Tầng | File | Trách nhiệm | KHÔNG được làm |
|---|---|---|---|
| **Data** | `plan-export.js`, `shopping.js` | Đọc DB, tính toán, chuẩn hoá | Biết về Excel |
| **Template** | `templates/*.js` | Khai báo khối nội dung | Query DB, gọi ExcelJS |
| **Style** | `theme.js`, `styles.js` | Vai trò → style | Biết về nội dung |
| **Engine** | `renderer.js`, `measure.js`, `page-setup.js` | Khối → worksheet | Biết về thực đơn |
| **API** | `index.js` | Mặt tiền công khai | — |

---

## 3. Design system không hard-code

`scripts/extract-excel-templates.py` quét corpus file mẫu, suy ra ngữ pháp bố cục
và bộ token màu/font/kích thước, rồi ghi ra hai artifact:

- `knowledge/excel-template-profiles.json` — fingerprint đầy đủ 43 file (phân tích, huấn luyện AI)
- `knowledge/excel-theme.json` — token rút gọn, đây là thứ `theme.js` nạp lúc chạy

Thêm file mẫu mới → chạy lại script → theme tự đổi. **Không sửa code.**

```bash
pip install -r scripts/requirements.txt
python3 scripts/extract-excel-templates.py --src "./Thực đơn mẫu"
```

### Token đã trích (canonical — giá trị modal của 43 file)

| Vai trò | Nền | Chữ | Cỡ |
|---|---|---|---|
| `title` | `FF2F6B4F` | `FFFFFFFF` | 16 đậm |
| `meta` | `FFE9F5EE` | `FF2F6B4F` | 11 nghiêng |
| `tableHeader` | `FF5D9277` | `FFFFFFFF` | 11 đậm |
| `rowLabel` | `FFDDECE3` | `FF2F6B4F` | 11 đậm |
| `sectionHeader` | `FF2F7666` | `FFFFFFFF` | 11 đậm |
| `note` | `FFFFF4DA` | `FF7A5814` | 11 nghiêng |
| `numeric` | `FFF4FAF7` | — | 11 |

Font **Carlito** (đồng nhất số đo với Calibri, nên thay thế font không làm lệch layout).

**Quan trọng: corpus KHÔNG dùng border.** Bảng được phân tách hoàn toàn bằng dải
màu nền. `styles.js` tôn trọng quy tắc này — `border` chỉ bật khi template yêu
cầu rõ ràng (ô tick "đã mua").

---

## 4. Ngữ pháp bố cục

Trích từ corpus, `renderer.js` dựng theo đúng trình tự này:

```
title → meta → spacer → table → spacer → section* → spacer → note
```

Ba biến thể chiếm 100% corpus:

| Tần suất | Chuỗi khối |
|---|---|
| 19/43 | title → meta → table → note |
| 18/43 | title → meta → table → section → note |
| 6/43 | title → meta → table → section → section → note |

Loại khối hỗ trợ: `title`, `meta`, `spacer`, `table`, `section`, `note`, `raw`.

---

## 5. Chỗ bản sinh **tốt hơn** file mẫu

Đo trên 43 file: **không file nào** set print area, fit-to-width, khổ giấy,
freeze pane hay header/footer (đúng 1 file có orientation). In trực tiếp sẽ tràn
3–4 trang và mất dòng tiêu đề.

`page-setup.js` bổ sung:
- khổ A4, tự chọn ngang/dọc theo số cột
- fit 1 trang theo chiều ngang, tràn tự do theo chiều dọc
- lặp lại hàng tiêu đề bảng ở mọi trang (`printTitlesRow`)
- footer "Trang x / y" + ngày xuất

> **Bẫy đã xử lý:** trong chuỗi header/footer của Excel, `&9` (cỡ chữ 9) đứng
> ngay trước chữ số sẽ bị đọc thành `&927`. Vì vậy phần ngày luôn có tiền tố chữ.

---

## 6. Workbook 4 sheet

| Sheet | Template | Nội dung |
|---|---|---|
| **THỰC ĐƠN** | `weekly-menu.js` | Lưới Ngày × Bữa, giống mẫu ~100%. Thêm khối thành viên và khối "món đã bị Rule Engine đổi". Không có cột dinh dưỡng. |
| **DINH DƯỠNG** | `nutrition.js` | Từng món × 7 chỉ số, dòng tổng, khối tổng theo ngày. Chỉ in cột thực sự có số liệu. |
| **ĐI CHỢ** | `shopping-list.js` | ✓ / Nguyên liệu / Đơn vị / Số lượng / Đơn giá / Thành tiền / Có thể thay bằng. Mỗi nhóm một section + tạm tính. Cuối là TỔNG CHI PHÍ DỰ KIẾN. |
| **TỔNG HỢP** | `summary.js` | Dinh dưỡng cả tuần, quy mô kế hoạch, chi phí, chi phí theo nhóm. |

Thêm sheet mới = viết `(model) => SheetSpec` rồi đăng ký trong
`templates/index.js`. Không đụng renderer, API hay UI.

---

## 7. Chuỗi giá nguyên liệu

```
Admin (household) → Admin (region) → Admin (global)
    → knowledge/ingredient-prices.json (regionPrices)
    → knowledge/ingredient-prices.json (prices × hệ số vùng)
    → null  ⇒ in "-", KHÔNG chặn export
```

Bảng `ingredient_prices` là **tuỳ chọn**: nếu chưa chạy
`migrations/excel_export_and_pricing.sql`, `pricing.js` tự lùi về bảng tĩnh và
ghi log cảnh báo. Đơn giá được quy đổi sang đúng đơn vị đang hiển thị
(140.000 đ/kg + hiển thị theo `g` → 140 đ/g; đ/kg → đ/bó qua `gramsPerUnit`).

---

## 8. Ingredient Dictionary

`knowledge/ingredient-catalog.json` giải bài toán "ba rọi" = "thịt ba chỉ" =
"ba chỉ heo". Bốn vòng khớp trong `ingredients.js`:

1. khớp chính xác tên đã chuẩn hoá (bỏ dấu, bỏ định lượng)
2. khớp sau khi bỏ cả động từ chế biến (`luộc`, `kho`, `xào`…)
3. khớp cụm dài nhất theo ranh giới từ — `"30 g tôm tươi"` → `tom`
4. khớp từ khoá nhóm → ra được category nhưng không ra item

Không khớp gì → nhóm "Khác", giữ nguyên tên, giá `-`. Không bao giờ ném lỗi.

Từ điển cũng khai báo `purchaseUnit`, `gramsPerUnit`, `roundTo`, `packSize`,
và bảng `substitutes` cho cột "Có thể thay bằng".

---

## 9. Quy đổi đơn vị & làm tròn

Hai việc **khác nhau**, đừng gộp:

```js
convertForDisplay(1200, 'g')            // → { qty: 1.2, unit: 'kg' }   chỉ đổi cách VIẾT
roundForPurchase(750, 'g', 'Rau muống') // → { qty: 3,   unit: 'bó' }   đổi cả GIÁ TRỊ
```

Thứ tự ưu tiên trong `roundForPurchase`:
1. đơn vị đếm được (`gramsPerUnit`) → 750 g rau muống = 2,5 bó → **3 bó**
2. lốc/hộp cố định (`packSize`) → 2.400 ml sữa = **14 hộp** 180 ml
3. cân/thể tích → 1.200 g thịt = **1,2 kg** (bước 0,1)
4. đơn vị đếm sẵn → làm tròn lên bội số

`exact_qty` luôn được giữ, dùng cho ghi chú "cần 2,2 – mua 3" và để tính lại khi
đổi số suất.

---

## 10. Bộ nhập thông minh

```
Upload → read-sheet.js → đúng mẫu chuẩn? ──có──▶ parser cũ (giữ nguyên)
                              │không
                              ▼
                     analyze-layout.js  (5 chiến lược, tự chấm điểm)
                              │
                     đủ tin cậy (≥0,7)? ──không──▶ ai-structure.js
                              │có                        │thất bại
                              ▼                          ▼
                        normalize.js  ◀──────────────────┘
                              │
                        days[] → persistTemplateDays()
```

### Năm chiến lược layout

| id | Hình dạng | Ví dụ trong corpus |
|---|---|---|
| `pivot` | ngày là hàng, bữa là cột | 36 file |
| `record` | mỗi hàng = (ngày, bữa, món) | BV Đức Giang |
| `single-meal` | ngày là hàng, cả bảng một bữa | Vinmec "Gợi ý bữa sáng" |
| `menu-catalog` | STT 1..N, cột là thành phần bữa | "20 thực đơn bữa chính" ×2 |
| `meal-rows` | thực đơn 1 ngày, hàng là bữa/giờ | Vạn Phước, Sơn Kỳ, Tân Sơn Nhì |

**Kết quả đo: 43/43 file mẫu đọc được bằng heuristic thuần, chưa cần gọi AI.**
AI là lớp dự phòng cho các bố cục ngoài 5 hình dạng trên.

Thêm bố cục mới = thêm một detector vào `LAYOUT_STRATEGIES` + một reader vào
`READERS`. Không sửa hàm đang chạy.

### Ràng buộc chống ảo giác của AI

`ai-structure.js` **chỉ** cho LLM trả về **bản đồ toạ độ** ("hàng 6 là Thứ Hai",
"cột 3 là bữa trưa"). Nội dung món luôn đọc thẳng từ ô trong file. LLM có ảo giác
thì cùng lắm là ánh xạ sai (bắt được bằng `validateStructure`), **không bao giờ**
tạo ra món không tồn tại. Mọi toạ độ ngoài lưới đều bị loại.

### Hai cái bẫy kỹ thuật đã xử lý

1. **`\b` không hoạt động sau ký tự tiếng Việt.** `\b` của JavaScript chỉ hiểu
   `[A-Za-z0-9_]`, nên `/thứ\s*tư\b/` **trượt** với "Thứ Tư" (ư là non-word).
   Bug này khiến mọi file dùng "Thứ Hai…Chủ Nhật" chỉ đọc được 6/7 ngày. Đã thay
   bằng lookahead Unicode `(?![\p{L}\p{N}])` với cờ `u`.

2. **ExcelJS không đọc được file do openpyxl/LibreOffice sinh** (thiếu
   `docProps/app.xml`, reader của ExcelJS bắt buộc có). Mà đó chính là dạng file
   người dùng hay có. Vì vậy chiều **đọc** dùng SheetJS (khoan dung), chiều
   **ghi** dùng ExcelJS (ghi được style). Script trích design system viết bằng
   Python/openpyxl.

---

## 11. Tương thích ngược

| Thứ | Trạng thái |
|---|---|
| Mẫu chuẩn (16 cột cũ) | Vẫn nhận diện y hệt; cột `price` là tuỳ chọn nên file cũ nhập bình thường, giá ra chuỗi rỗng |
| `buildShoppingList()` | Giữ nguyên `{ name, total_qty, unit }`; mọi trường mới là **bổ sung** |
| Bảng DB cũ | Không sửa/xoá cột nào; migration mới hoàn toàn additive |
| Chưa chạy migration | `pricing.js` lùi về bảng tĩnh, `buildShoppingList` lùi về bộ cột cũ |
| Chưa build theme artifact | `theme.js` dùng token fallback, export vẫn chạy |
| LLM chết / timeout | Bộ nhập lùi về heuristic |

---

## 12. Kiểm thử

```bash
npm run verify:excel                                  # dựng 4 sheet + kiểm tra dictionary/đơn vị/giá
node scripts/verify-excel-export.mjs --import file.xlsx  # chạy ngược bộ nhập trên file thật
```

Không cần Supabase, không cần LLM — script dựng model giả.

---

## 13. Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `EXCEL_IMPORT_AI_THRESHOLD` | `0.7` | Dưới ngưỡng tin cậy này mới gọi LLM |
| `EXCEL_IMPORT_AI_TIMEOUT_MS` | `25000` | Timeout cho lượt gọi LLM nhận diện |
| `EXCEL_IMPORT_MAX_ESTIMATES` | `60` | Số món tối đa được ước tính dinh dưỡng mỗi lần nhập |

---

## 14. API

```
GET  /api/family-menu?resource=export&plan_id=…[&sheets=menu,shopping][&servings=6][&start_date=2026-07-27]
GET  /api/family-menu?resource=import-template
GET  /api/family-menu?resource=shopping-list&plan_id=…[&servings=6]
POST /api/family-menu  { action: 'upload_template_excel', use_ai?: 'false', sheet_name?: '…' }
```

`servings` đổi số suất **ngay lúc xuất**, không phải sinh lại kế hoạch — mọi định
lượng và danh sách mua được nhân lại theo hệ số.
