/**
 * lib/excel/import/read-meta.js — đọc phần METADATA của bộ thực đơn chuẩn.
 *
 * Mỗi file trong "Thực đơn mẫu/" có 5 sheet, nhưng trước đây hệ thống chỉ đọc
 * sheet "DỮ LIỆU" (ngày × bữa × món × nguyên liệu). Ba sheet còn lại chứa
 * những thứ không có ở đâu khác:
 *
 *   THÔNG TIN XỬ LÝ  — tệp gốc, ngày xử lý, nguồn tra cứu dinh dưỡng và giá
 *   THỰC ĐƠN         — ghi chú cho TỪNG BỮA, gồm cờ "CẦN KIỂM TRA"
 *
 * Vì sao cờ CẦN KIỂM TRA quan trọng: 82 bữa trong bộ dữ liệu được đánh dấu là
 * dinh dưỡng chưa đầy đủ / đã suy đoán. Đây là ứng dụng sức khoẻ, hiển thị
 * những con số đó y như số đã kiểm chứng là sai về mặt trách nhiệm.
 *
 * Thuần: chỉ đọc lưới, không DB, không LLM. Sheet nào thiếu thì trả về rỗng —
 * file nhập của người dùng không có mấy sheet này và vẫn phải nhập được.
 */

/*
 * Nhãn ngày/bữa dùng LẠI bộ nhận diện của analyze-layout.js.
 *
 * Bảng tra cứng ("bữa sáng" → breakfast) chỉ khớp được 49% vì bộ thực đơn chuẩn
 * viết đủ kiểu: "Bữa sáng 7h00", "Bữa phụ chiều", "Bữa trưa/tối", "Bữa xế
 * chiều", "Bữa phụ 1 15h00"… Nhánh nhập tự do đã phải giải đúng bài toán này
 * rồi; viết bảng thứ hai ở đây là chắc chắn hai bên lệch nhau theo thời gian.
 */
import { matchMeal, mealFromTime, parseDayIndex } from './analyze-layout.js';

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const low = (v) => norm(v).toLowerCase();

const findSheet = (sheets, re) => sheets.find((s) => re.test(s.name));

/** Hàng tiêu đề = hàng đầu tiên (trong 10 hàng đầu) có >= n ô khác nhau. */
function headerRow(grid, n = 4) {
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    if (new Set((grid[i] || []).filter(Boolean).map(norm)).size >= n) return i;
  }
  return -1;
}

/**
 * Sheet "THÔNG TIN XỬ LÝ" là các cặp nhãn–giá trị nằm ngang:
 *   | Tệp gốc | X.xlsx | Phân loại | GOUT |
 * Quét mọi ô: ô nào là nhãn đã biết thì lấy ô ngay bên phải làm giá trị.
 */
export function readProcessingInfo(sheets) {
  const sheet = findSheet(sheets, /THÔNG TIN XỬ LÝ/i);
  if (!sheet) return null;

  const LABELS = {
    'tệp gốc': 'sourceFile',
    'phân loại': 'category',
    'ngày xử lý': 'processedAt',
    'trạng thái': 'status',
    'nguồn dinh dưỡng': 'nutritionSource',
    'tài liệu phương pháp': 'methodDoc',
    'nguồn tham khảo giá': 'priceSource',
    'giá trái cây': 'priceSourceFruit',
  };

  const out = {};
  for (const row of sheet.grid) {
    for (let c = 0; c < row.length - 1; c++) {
      const key = LABELS[low(row[c])];
      const val = norm(row[c + 1]);
      if (key && val && !out[key]) out[key] = val;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Sheet "THỰC ĐƠN": mỗi hàng là MỘT BỮA, cột cuối là ghi chú.
 *
 * Ghi chú gộp nhiều mệnh đề bằng dấu ";", trong đó hai loại đáng chú ý:
 *   "CẦN KIỂM TRA: …"  → số liệu chưa đầy đủ, phải cảnh báo
 *   "Đã chuẩn hóa từ …" → tên món đã bị sửa so với tài liệu gốc
 *
 * @returns {Map<string, { note: string, needsReview: boolean }>}
 *          khoá "dayIndex:mealType"
 */
export function readMealNotes(sheets) {
  const out = new Map();
  const sheet = findSheet(sheets, /^THỰC ĐƠN$/i);
  if (!sheet) return out;

  const hr = headerRow(sheet.grid);
  if (hr < 0) return out;

  const head = (sheet.grid[hr] || []).map(low);
  const iDay = head.findIndex((h) => h === 'ngày');
  const iMeal = head.findIndex((h) => h === 'bữa ăn');
  const iNote = head.findIndex((h) => h.startsWith('ghi ch'));
  if (iDay < 0 || iMeal < 0 || iNote < 0) return out;

  for (const row of sheet.grid.slice(hr + 1)) {
    const dayIndex = parseDayIndex(row[iDay]);
    // matchMeal trước, mealFromTime sau: "Bữa sáng 7h00" phải ăn theo chữ, còn
    // "7h00" trơ trọi mới suy từ giờ.
    const mealType = matchMeal(row[iMeal]) || mealFromTime(row[iMeal]);
    const note = norm(row[iNote]);
    if (!dayIndex || !mealType || !note) continue;

    const key = `${dayIndex}:${mealType}`;
    const prev = out.get(key);
    /* Nhiều nhãn cùng quy về một bữa ("Bữa phụ sáng" và "Bữa phụ chiều" đều là
       snack). Gộp ghi chú thay vì để cái sau đè cái trước, và chỉ cần MỘT dòng
       gắn cờ là cả bữa phải được coi là cần rà soát. */
    const merged = prev && prev.note !== note ? `${prev.note}\n${note}` : note;
    out.set(key, {
      note: merged,
      needsReview: (prev?.needsReview || false) || /CẦN KIỂM TRA/i.test(note),
    });
  }
  return out;
}

export default { readProcessingInfo, readMealNotes };
