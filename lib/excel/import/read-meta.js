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
 * Đầu SHEET NGUỒN (sheet đầu tiên, dạng lưới gốc) — xuất xứ THẬT của thực đơn.
 *
 * Vài hàng đầu là các cặp nhãn–giá trị rải ngang:
 *   ["Nguồn", "https://…", "Ngày đăng", "21/06/2023"]
 *   ["Đơn vị", "Nhà thuốc FPT Long Châu", "Kiểm duyệt nội dung", "DSĐH …"]
 *   ["Mẫu khẩu phần", "1.800 kcal/ngày", "G–P–L", "58%–20%–22%"]
 *
 * Đây mới là nguồn người dùng cần thấy — link bài gốc của bệnh viện/nhà thuốc,
 * ngày đăng, ai tham vấn y khoa — chứ không phải link USDA ở sheet xử lý.
 */
const SOURCE_LABELS = {
  'nguồn': 'url', 'nguồn chính': 'url', 'link bài viết': 'url',
  'nguồn đối chiếu': 'urlAlt',

  // Mỗi đơn vị gọi ngày một kiểu — thiếu biến thể nào là mất ngày của file đó.
  'ngày đăng': 'publishedAt', 'ngày bài viết': 'publishedAt',
  'cập nhật': 'publishedAt', 'ngày cập nhật': 'publishedAt',
  'cập nhật lần cuối': 'publishedAt', 'cập nhật bài viết': 'publishedAt',
  'xuất bản/cập nhật': 'publishedAt', 'xuất bản': 'publishedAt',

  'đơn vị': 'publisher',
  'nội dung': 'kind', 'loại': 'kind', 'loại nội dung': 'kind',
  'cấu trúc bài': 'kind', 'phạm vi': 'kind',

  'chuyên gia': 'reviewer', 'tham vấn y khoa': 'reviewer',
  'tư vấn chuyên môn': 'reviewer', 'kiểm duyệt nội dung': 'reviewer',
  'tác giả': 'reviewer', 'tác giả hiển thị': 'reviewer', 'tác giả chuyên môn': 'reviewer',
  'nơi công tác': 'reviewerOrg',

  'đối tượng': 'audience', 'đối tượng bài viết': 'audience',
  'mục tiêu': 'goal',
  'mẫu khẩu phần': 'calorieTarget', 'mức năng lượng': 'calorieTarget',
  'g–p–l': 'macroRatio', 'g-p-l': 'macroRatio',
};

const isUrl = (v) => /^https?:\/\//i.test(norm(v));

/**
 * Tên các sheet do khâu chuẩn hoá sinh ra. So khớp CHÍNH XÁC, không dùng regex
 * chứa/kết-thúc-bằng: mẫu /THỰC ĐƠN$/ nuốt luôn sheet nguồn tên "20 thực đơn",
 * làm hai file đó mất sạch metadata xuất xứ.
 */
const GENERATED_SHEETS = new Set([
  'dữ liệu', 'thực đơn', 'chi tiết nguyên liệu', 'thông tin xử lý',
  'thông tin', 'báo cáo', 'chi tiết kiểm tra',
]);

export function readSourceHeader(sheets) {
  // Sheet nguồn = sheet đầu tiên KHÔNG phải sheet do khâu chuẩn hoá sinh ra.
  const sheet = sheets.find((s) => !GENERATED_SHEETS.has(low(s.name)));
  if (!sheet) return null;

  const out = {};
  // Tiêu đề bài: ô đầu tiên có chữ mà cả hàng chỉ có một ô.
  const head = sheet.grid.slice(0, 8);
  for (const row of head) {
    const cells = row.map(norm);
    if (!out.title && cells.filter(Boolean).length === 1 && cells[0] && cells[0].length > 8) {
      out.title = cells[0];
    }
    for (let c = 0; c < cells.length - 1; c++) {
      const label = low(cells[c]);
      const val = cells[c + 1];
      if (!val) continue;

      /* Vài file gộp cả nhãn lẫn tên đơn vị vào một ô:
           ["Nguồn: Phòng khám Đa khoa Kim Đức", "https://…"]
         Tách ra để vừa lấy được URL vừa lấy được tên đơn vị. */
      const inline = label.match(/^nguồn\s*[:：]\s*(.+)$/);
      if (inline) {
        if (!out.publisher) out.publisher = norm(cells[c].split(/[:：]/).slice(1).join(':'));
        if (!out.url && isUrl(val)) out.url = val;
        continue;
      }

      const key = SOURCE_LABELS[label];
      if (key && !out[key]) out[key] = val;
    }
    // URL đứng trơ không nhãn (vd sheet tổng hợp) — vẫn nhận nếu chưa có.
    if (!out.url) {
      const u = cells.find(isUrl);
      if (u) out.url = u;
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

export default { readProcessingInfo, readSourceHeader, readMealNotes };
