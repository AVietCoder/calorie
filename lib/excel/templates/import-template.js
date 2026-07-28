/**
 * lib/excel/templates/import-template.js — file mẫu để người dùng TẢI VỀ điền.
 *
 * Khác với 4 sheet xuất kế hoạch, đây là file NHẬP LIỆU. Nó vẫn mang cùng bộ
 * nhận diện (title xanh, meta, note vàng) nhưng ưu tiên tính rõ ràng:
 *   • Sheet "HƯỚNG DẪN" giải thích từng cột + giá trị hợp lệ
 *   • Sheet "DỮ LIỆU" có dòng ví dụ sẵn để người dùng làm theo
 *
 * Lưu ý: từ bản này người dùng KHÔNG bắt buộc dùng file mẫu nữa — bộ nhập
 * thông minh (lib/excel/import) đọc được cả file thực đơn dạng lưới bất kỳ.
 * File mẫu vẫn giữ cho ai muốn nhập đầy đủ dinh dưỡng + nguyên liệu.
 */

const COLUMNS = [
  { key: 'day_index', header: 'day_index', width: 12, desc: 'Ngày thứ mấy trong tuần', valid: '1 – 7', required: true, example: 1 },
  { key: 'meal_type', header: 'meal_type', width: 14, desc: 'Loại bữa', valid: 'breakfast / lunch / dinner / snack', required: true, example: 'breakfast' },
  { key: 'dish_name', header: 'dish_name', width: 30, desc: 'Tên món ăn', valid: 'Chuỗi bất kỳ', required: true, example: 'Phở gà' },
  { key: 'base_grams', header: 'base_grams', width: 13, desc: 'Khối lượng 1 suất chuẩn', valid: 'Số, đơn vị gam', required: false, example: 400 },
  { key: 'calories', header: 'calories', width: 12, desc: 'Năng lượng', valid: 'Số, kcal — bỏ trống để AI ước tính', required: false, example: 450 },
  { key: 'protein', header: 'protein', width: 11, desc: 'Đạm', valid: 'Số, gam', required: false, example: 28 },
  { key: 'fat', header: 'fat', width: 11, desc: 'Chất béo', valid: 'Số, gam', required: false, example: 12 },
  { key: 'carbs', header: 'carbs', width: 11, desc: 'Tinh bột', valid: 'Số, gam', required: false, example: 58 },
  { key: 'fiber', header: 'fiber', width: 11, desc: 'Chất xơ', valid: 'Số, gam', required: false, example: 2 },
  { key: 'sugar', header: 'sugar', width: 11, desc: 'Đường', valid: 'Số, gam', required: false, example: 4 },
  { key: 'sodium', header: 'sodium', width: 11, desc: 'Natri', valid: 'Số, mg', required: false, example: 920 },
  { key: 'dish_tags', header: 'dish_tags', width: 22, desc: 'Nhãn dùng cho Rule Engine', valid: 'Ngăn cách bằng dấu phẩy, vd: gà, high-sodium', required: false, example: 'gà' },
  { key: 'ingredient_name', header: 'ingredient_name', width: 24, desc: 'Nguyên liệu của món', valid: 'Mỗi nguyên liệu một dòng, lặp lại thông tin món', required: false, example: 'Bánh phở' },
  { key: 'ingredient_grams', header: 'ingredient_grams', width: 16, desc: 'Lượng nguyên liệu', valid: 'Số', required: false, example: 180 },
  { key: 'ingredient_unit', header: 'ingredient_unit', width: 15, desc: 'Đơn vị nguyên liệu', valid: 'g / ml / quả / bó / hộp…', required: false, example: 'g' },
  { key: 'ingredient_tags', header: 'ingredient_tags', width: 20, desc: 'Nhãn nguyên liệu', valid: 'Ngăn cách bằng dấu phẩy', required: false, example: 'tinh bột' },
];

const EXAMPLE_ROWS = [
  [1, 'breakfast', 'Phở gà', 400, 450, 28, 12, 58, 2, 4, 920, 'gà', 'Bánh phở', 180, 'g', 'tinh bột'],
  [1, 'breakfast', 'Phở gà', 400, 450, 28, 12, 58, 2, 4, 920, 'gà', 'Thịt gà', 100, 'g', 'đạm'],
  [1, 'breakfast', 'Phở gà', 400, 450, 28, 12, 58, 2, 4, 920, 'gà', 'Hành lá', 10, 'g', 'gia vị'],
  [1, 'lunch', 'Cơm gạo lứt cá kho', 500, 620, 34, 18, 72, 4, 5, 800, '', 'Gạo lứt', 120, 'g', 'tinh bột'],
  [1, 'lunch', 'Cơm gạo lứt cá kho', 500, 620, 34, 18, 72, 4, 5, 800, '', 'Cá basa', 120, 'g', 'đạm'],
  [1, 'lunch', 'Canh bí đao nấu tôm', 200, 90, 8, 2, 8, 2, 2, 400, '', 'Bí đao', 150, 'g', 'rau'],
  [1, 'dinner', 'Cơm + rau muống luộc + thịt kho', 480, 560, 30, 16, 66, 5, 4, 850, '', 'Rau muống', 200, 'g', 'rau'],
  [1, 'snack', 'Sữa chua ít đường', 100, 90, 5, 2, 12, 0, 10, 60, 'snack', 'Sữa chua', 1, 'hộp', 'sữa'],
];

/** Sheet DỮ LIỆU — nơi người dùng thực sự gõ vào. */
export function importTemplateSheet() {
  const columns = COLUMNS.map((c) => ({
    header: c.header,
    role: c.key.includes('grams') || ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'sodium', 'day_index'].includes(c.key)
      ? 'numeric'
      : 'text',
    width: c.width,
  }));

  return {
    name: 'DỮ LIỆU',
    width: columns.length,
    blocks: [
      { type: 'title', text: 'MẪU NHẬP THỰC ĐƠN — CALORIE AI' },
      {
        type: 'meta',
        pairs: [
          ['Cách dùng', 'Xoá các dòng ví dụ bên dưới rồi điền dữ liệu của bạn'],
          ['Bắt buộc', 'day_index, meal_type, dish_name'],
          ['Bỏ trống được', 'Mọi cột dinh dưỡng — hệ thống sẽ tự ước tính'],
          ['Xem thêm', 'Sheet HƯỚNG DẪN'],
        ],
        perRow: 2,
      },
      { type: 'spacer' },
      {
        type: 'table',
        columns,
        rows: EXAMPLE_ROWS,
        options: { uniformHeight: true, zebra: true, heightRange: { min: 20, max: 32 } },
      },
      { type: 'spacer' },
      {
        type: 'note',
        text:
          'Lưu ý: Một món có nhiều nguyên liệu thì lặp lại toàn bộ thông tin món trên mỗi dòng và ' +
          'chỉ đổi phần ingredient_*. Món không khai nguyên liệu vẫn nhập được, nhưng sẽ không xuất ' +
          'hiện trong danh sách đi chợ. Nếu bạn đã có sẵn file thực đơn dạng bảng (ngày × bữa) thì ' +
          'không cần dùng mẫu này — cứ tải thẳng file đó lên, hệ thống sẽ tự nhận diện cấu trúc.',
      },
    ],
    print: { orientation: 'landscape', footerLeft: 'Mẫu nhập thực đơn' },
  };
}

/** Sheet HƯỚNG DẪN — tự sinh từ đúng metadata của cột, không viết tay 2 lần. */
export function importGuideSheet() {
  const columns = [
    { header: 'Cột', role: 'label', width: 20 },
    { header: 'Ý nghĩa', role: 'text', width: 34 },
    { header: 'Giá trị hợp lệ', role: 'text', width: 44 },
    { header: 'Bắt buộc', role: 'label', width: 12 },
  ];

  return {
    name: 'HƯỚNG DẪN',
    width: columns.length,
    blocks: [
      { type: 'title', text: 'HƯỚNG DẪN ĐIỀN MẪU NHẬP THỰC ĐƠN' },
      {
        type: 'meta',
        pairs: [
          ['Phiên bản mẫu', '2.0'],
          ['Hỗ trợ', 'Có thể tải lên file thực đơn bất kỳ, không bắt buộc theo mẫu'],
        ],
        perRow: 2,
      },
      { type: 'spacer' },
      {
        type: 'table',
        columns,
        rows: COLUMNS.map((c) => [c.header, c.desc, c.valid, c.required ? 'Có' : 'Không']),
        options: { uniformHeight: true, heightRange: { min: 22, max: 50 } },
      },
      { type: 'spacer' },
      {
        type: 'section',
        title: 'HAI CÁCH ĐƯA THỰC ĐƠN VÀO THƯ VIỆN',
        span: 4,
        columns: [
          { header: 'Cách', role: 'label', width: 20 },
          { header: 'Khi nào dùng', role: 'text', width: 34 },
          { header: 'Ưu điểm', role: 'text', width: 44 },
          { header: 'Hạn chế', role: 'text', width: 40 },
        ],
        rows: [
          [
            'Dùng mẫu này',
            'Khi bạn có sẵn số liệu dinh dưỡng và nguyên liệu chi tiết',
            'Chính xác tuyệt đối, có nguyên liệu nên dùng được danh sách đi chợ',
            'Phải nhập tay nhiều',
          ],
          [
            'Tải file bất kỳ',
            'Khi bạn có file thực đơn dạng bảng ngày × bữa',
            'Chỉ cần kéo thả, hệ thống tự nhận diện ngày/bữa/món',
            'Thiếu nguyên liệu và dinh dưỡng, hệ thống sẽ tự ước tính',
          ],
        ],
        options: { uniformHeight: true, heightRange: { min: 30, max: 80 } },
      },
      { type: 'spacer' },
      {
        type: 'note',
        text:
          'Lưu ý: meal_type phải viết bằng tiếng Anh không dấu (breakfast, lunch, dinner, snack) vì đây ' +
          'là giá trị lưu trong cơ sở dữ liệu. Nếu bạn tải lên file thực đơn tự do, hệ thống sẽ tự dịch ' +
          '"Bữa sáng" → breakfast giúp bạn.',
      },
    ],
    print: { orientation: 'landscape', footerLeft: 'Hướng dẫn nhập liệu' },
  };
}

export { COLUMNS as IMPORT_COLUMNS };
export default { importTemplateSheet, importGuideSheet };
