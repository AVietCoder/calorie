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

/**
 * Sheet "CHI TIẾT NGUYÊN LIỆU": mỗi hàng là MỘT nguyên liệu của một món.
 *
 * Trùng một phần với sheet DỮ LIỆU (tên, lượng dùng, đơn vị, chi phí phần
 * dùng), nhưng có thêm ba thứ không có ở đâu khác:
 *
 *   Lượng mua ước tính + Đơn vị mua — dùng 70 g nhưng ngoài chợ bán gói 250 g
 *   Số tiền cần trả khi mua         — tiền thực phải bỏ ra cho gói đó
 *
 * Đây là khoảng cách giữa "cần bao nhiêu" và "phải mua bao nhiêu" — thứ người
 * đi chợ thật sự cần biết.
 *
 * KHÔNG ghép theo nhãn bữa. Sheet này viết bữa đủ kiểu ("Bữa chiều 17h00",
 * "Bữa phụ 2 20h00") mà bộ nhận diện bữa không phủ hết — bắt buộc khớp bữa thì
 * mất 47/146 dòng chỉ vì một nhãn lạ. Tên MÓN + tên NGUYÊN LIỆU đã đủ định danh
 * trong phạm vi một ngày; còn lượng mua của cùng một nguyên liệu thì như nhau
 * dù nó nằm ở bữa nào.
 *
 * @returns {{ get: (dayIndex:number, dishName:string, ingName:string) => object|null, size:number }}
 */
export function readIngredientDetails(sheets) {
  const byDay = new Map();   // "ngày:món:nguyênliệu"
  const byDish = new Map();  // "món:nguyênliệu" — dự phòng khi lệch ngày
  const empty = { get: () => null, size: 0 };

  const sheet = findSheet(sheets, /CHI TIẾT NGUYÊN LIỆU/i);
  if (!sheet) return empty;

  const hr = headerRow(sheet.grid);
  if (hr < 0) return empty;

  const head = (sheet.grid[hr] || []).map(low);
  const col = (...names) => head.findIndex((h) => names.some((n) => h.startsWith(n)));
  const iDay = col('ngày');
  const iDish = col('món ăn');
  const iIng = col('nguyên liệu');
  const iBuyQty = col('lượng mua');
  const iBuyUnit = col('đơn vị mua');
  const iBuyPrice = col('số tiền cần trả');
  const iGroup = col('nhóm nguyên liệu');
  if (iDish < 0 || iIng < 0) return empty;

  for (const row of sheet.grid.slice(hr + 1)) {
    const dish = norm(row[iDish]);
    const ing = norm(row[iIng]);
    if (!dish || !ing) continue;

    const rec = {
      buyQty: iBuyQty < 0 ? null : toNumber(row[iBuyQty]),
      buyUnit: iBuyUnit < 0 ? '' : norm(row[iBuyUnit]),
      buyPrice: iBuyPrice < 0 ? null : toNumber(row[iBuyPrice]),
      group: iGroup < 0 ? '' : norm(row[iGroup]),
    };

    const dayIndex = iDay < 0 ? null : parseDayIndex(row[iDay]);
    const dk = `${low(dish)}:${low(ing)}`;
    if (dayIndex) byDay.set(`${dayIndex}:${dk}`, rec);
    if (!byDish.has(dk)) byDish.set(dk, rec);
  }

  return {
    size: byDay.size || byDish.size,
    get: (dayIndex, dishName, ingName) => {
      const dk = `${low(dishName)}:${low(ingName)}`;
      return byDay.get(`${dayIndex}:${dk}`) || byDish.get(dk) || null;
    },
  };
}

/** "22,500" / "250.0" → số. Dấu phẩy ở đây là phân cách nghìn kiểu Anh. */
function toNumber(v) {
  const s = norm(v).replace(/,/g, '');
  if (!s) return null;
  const n = Number(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export default { readProcessingInfo, readMealNotes, readIngredientDetails };
