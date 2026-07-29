/**
 * scripts/verify-shopping-parse.mjs — kiểm chứng offline chuỗi
 * tên món → nguyên liệu → danh sách đi chợ.
 *
 *   npm run verify:shopping
 *
 * Không DB, không mạng, không LLM. Exit != 0 khi có ca sai.
 * Các chuỗi đầu vào là DỮ LIỆU THẬT lấy từ menu_template_dishes.
 */
import fs from 'node:fs';
import { parseDishSpec, parseQuantity } from '../lib/family-menu/dish-parse.js';
import { buildShoppingModel, formatShoppingText } from '../lib/family-menu/shopping.js';
import { resolveIngredient } from '../lib/family-menu/ingredients.js';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  PASS  ${label}`); return; }
  fail++;
  console.log(`  FAIL  ${label}\n          nhận : ${a}\n          mong : ${e}`);
}

function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${label}`); return; }
  fail++;
  console.log(`  FAIL  ${label}${detail ? '\n          ' + detail : ''}`);
}

const brief = (spec) => ({
  name: spec.name,
  ing: spec.ingredients.map((i) => [i.name, i.grams, i.unit]),
});

/* ─────────── 1. parseQuantity ─────────── */
console.log('\n=== parseQuantity ===');
check('"1,5"   → 1.5', parseQuantity('1,5'), 1.5);
check('"½"     → 0.5', parseQuantity('½'), 0.5);
check('"1 ½"   → 1.5', parseQuantity('1 ½'), 1.5);
check('"3/4"   → 0.75', parseQuantity('3/4'), 0.75);
check('"1.500" → 1500 (nghìn kiểu VN, KHÔNG phải 1.5)', parseQuantity('1.500'), 1500);
check('"1.5"   → 1.5', parseQuantity('1.5'), 1.5);
check('"180"   → 180', parseQuantity('180'), 180);
check('"abc"   → null', parseQuantity('abc'), null);

/* ─────────── 2. parseDishSpec trên dữ liệu THẬT ─────────── */
console.log('\n=== parseDishSpec (chuỗi thật từ DB) ===');

check('Phở bò — 5 nguyên liệu',
  brief(parseDishSpec('Phở bò: 180 g bánh phở, 50 g thịt bò, 30 g bò viên, 50 g giá, 20 g rau thơm')),
  { name: 'Phở bò', ing: [['Bánh phở', 180, 'g'], ['Thịt bò', 50, 'g'], ['Bò viên', 30, 'g'], ['Giá', 50, 'g'], ['Rau thơm', 20, 'g']] });

check('½ quả táo — phân số Unicode, nhãn chung giữ nguyên liệu',
  brief(parseDishSpec('Tráng miệng: ½ quả táo')),
  { name: 'Tráng miệng: Táo', ing: [['Táo', 0.5, 'quả']] });

check('1,5 chén — tên rỗng ⇒ lấy tên món',
  brief(parseDishSpec('Cơm gạo lứt: 1,5 chén')),
  { name: 'Cơm gạo lứt', ing: [['Cơm gạo lứt', 1.5, 'chén']] });

check('Không định lượng ⇒ 1 nguyên liệu cần ước lượng',
  brief(parseDishSpec('Cá lóc kho:')),
  { name: 'Cá lóc kho', ing: [['Cá lóc kho', null, null]] });

check('Bánh mì — lát + quả',
  brief(parseDishSpec('Bánh mì đen trứng ốp la: 2 lát bánh mì, 1 quả trứng gà')),
  { name: 'Bánh mì đen trứng ốp la', ing: [['Bánh mì', 2, 'lát'], ['Trứng gà', 1, 'quả']] });

check('Canh bí đao — 1 nguyên liệu',
  brief(parseDishSpec('Canh bí đao nấu thịt bằm: 100 g bí')),
  { name: 'Canh bí đao nấu thịt bằm', ing: [['Bí', 100, 'g']] });

// Điều cần bảo vệ ở đây là TÊN không bị tách đôi thành hai nguyên liệu bịa.
// Món vẫn phải xuất hiện trong danh sách đi chợ, chỉ là chưa biết định lượng.
check('KHÔNG có ":" ⇒ tên nguyên vẹn, 1 dòng cần ước lượng',
  brief(parseDishSpec('Cơm gạo lứt, canh cải')),
  { name: 'Cơm gạo lứt, canh cải', ing: [['Cơm gạo lứt, canh cải', null, null]] });

check('… và món một từ cũng vào được giỏ',
  brief(parseDishSpec('Dưa hấu')),
  { name: 'Dưa hấu', ing: [['Dưa hấu', null, null]] });

check('Hỗn số + kg → baseGrams 1500',
  parseDishSpec('Gạo: 1 ½ kg gạo lứt').baseGrams, 1500);

ok('needsEstimate=true khi thiếu số', parseDishSpec('Rau muống luộc:').needsEstimate === true);
ok('needsEstimate=false khi đủ số', parseDishSpec('Phở bò: 180 g bánh phở').needsEstimate === false);

/* ─────────── 2b. chặn khớp nhầm từ điển ─────────── */
console.log('\n=== chặn khớp nhầm (blockPhrases) ===');
{
  const r = (n) => resolveIngredient(n).canonical;
  // Đưa ĐƯỜNG vào giỏ của người TIỂU ĐƯỜNG là sai nguy hiểm, không chỉ xấu.
  ok('"Sữa cho người tiểu đường" KHÔNG ra Đường', r('Sữa dành riêng cho người tiểu đường') !== 'Đường',
    r('Sữa dành riêng cho người tiểu đường'));
  ok('… và cũng KHÔNG ra Tiêu (bỏ dấu thì tiểu == tiêu)',
    r('Sữa dành riêng cho người tiểu đường') !== 'Tiêu', r('Sữa dành riêng cho người tiểu đường'));
  // Không được chặn quá tay:
  check('"Đường" vẫn ra Đường', r('Đường'), 'Đường');
  check('"Hạt tiêu" vẫn ra Tiêu', r('Hạt tiêu'), 'Tiêu');
  check('"Thịt kho tiêu" vẫn ra Tiêu', r('Thịt kho tiêu'), 'Tiêu');
  check('"Bò viên" là món thịt', resolveIngredient('Bò viên').category, 'thit');
}

/* ─────────── 2c. tính toàn vẹn của từ điển nguyên liệu ─────────── */
console.log('\n=== toàn vẹn ingredient-catalog.json ===');
{
  const catalog = JSON.parse(fs.readFileSync(new URL('../knowledge/ingredient-catalog.json', import.meta.url)));
  const prices = JSON.parse(fs.readFileSync(new URL('../knowledge/ingredient-prices.json', import.meta.url)));
  const families = new Set(Object.keys(catalog.unitFamilies));
  const massUnits = new Set(Object.keys(catalog.unitFamilies.mass.units));

  const badFamily = catalog.items.filter((i) => i.family && !families.has(i.family));
  ok(`mọi item khai family hợp lệ (${[...families].join('/')})`, badFamily.length === 0,
    badFamily.map((i) => `${i.id}="${i.family}"`).join(', '));

  // gramsPerUnit = "gram trên MỘT ĐƠN VỊ MUA". Đơn vị mua đã là kg/g thì nó vô
  // nghĩa và làm roundForPurchase nhân sai (1000 g gạo từng ra "7 kg").
  const badGPU = catalog.items.filter((i) => i.gramsPerUnit != null && massUnits.has(i.purchaseUnit));
  ok('gramsPerUnit không đặt trên item bán theo cân', badGPU.length === 0,
    badGPU.map((i) => `${i.id}(${i.purchaseUnit}=${i.gramsPerUnit})`).join(', '));

  const noPrice = catalog.items.filter((i) => !prices.prices[i.id]);
  ok('mọi item đều có giá', noPrice.length === 0, noPrice.map((i) => i.id).join(', '));

  const orphan = Object.keys(prices.prices).filter((id) => !catalog.items.some((i) => i.id === id));
  ok('không có giá mồ côi (id không tồn tại)', orphan.length === 0, orphan.join(', '));
}

/* ─────────── 3. buildShoppingModel ─────────── */
console.log('\n=== buildShoppingModel ===');

const rows = [
  { name: 'thịt bò', grams: 180, unit: 'g' },
  { name: 'cà chua', grams: 450, unit: 'g' },
  { name: 'rau muống', grams: 750, unit: 'g' },
  { name: 'trứng gà', grams: 12, unit: 'quả' },
  { name: 'gạo lứt', grams: 1000, unit: 'g' },
  { name: 'ba rọi', grams: 200, unit: 'g' },
  { name: 'thịt ba chỉ', grams: 140, unit: 'g' },
  { name: 'cá lóc kho', grams: null, unit: null },
];
const model = buildShoppingModel(rows, { servingsFactor: 1 });
const byName = (frag) => model.items.find((i) => i.name.toLowerCase().includes(frag));

ok('gộp alias "ba rọi" + "thịt ba chỉ" → 1 dòng 340 g',
  model.items.filter((i) => i.ingredient_id === 'thit_ba_chi').length === 1
  && byName('ba chỉ')?.base_qty === 340,
  `dòng=${model.items.filter((i) => i.ingredient_id === 'thit_ba_chi').length} base_qty=${byName('ba chỉ')?.base_qty}`);

ok('750 g rau muống → 3 bó',
  byName('rau muống')?.qty === 3 && byName('rau muống')?.unit === 'bó',
  JSON.stringify([byName('rau muống')?.qty, byName('rau muống')?.unit]));

ok('12 quả trứng gà giữ nguyên 12 quả',
  byName('trứng')?.qty === 12 && byName('trứng')?.unit === 'quả',
  JSON.stringify([byName('trứng')?.qty, byName('trứng')?.unit]));

ok('1000 g gạo lứt → 1 kg',
  byName('gạo lứt')?.qty === 1 && byName('gạo lứt')?.unit === 'kg',
  JSON.stringify([byName('gạo lứt')?.qty, byName('gạo lứt')?.unit]));

const est = byName('cá lóc');
ok('nguyên liệu thiếu số ⇒ qty null, KHÔNG bịa 0',
  est != null && est.qty === null && est.unit === null && est.needs_estimate === true,
  JSON.stringify(est && { qty: est.qty, unit: est.unit, needs: est.needs_estimate }));

ok('… và không có thành tiền',
  est != null && est.line_total === null && est.unit_price === null,
  JSON.stringify(est && { unit_price: est.unit_price, line_total: est.line_total }));

ok('totals.estimateCount đếm đúng',
  model.totals.estimateCount === 1, `estimateCount=${model.totals.estimateCount}`);

ok('estimatedCost bỏ qua dòng null (là số hữu hạn)',
  Number.isFinite(model.totals.estimatedCost), `estimatedCost=${model.totals.estimatedCost}`);

/* ─────────── 4. Tính tất định ─────────── */
console.log('\n=== tính tất định (cùng input → cùng output) ===');
const again = buildShoppingModel(rows, { servingsFactor: 1 });
ok('chạy 2 lần cho kết quả giống hệt',
  JSON.stringify(model.items) === JSON.stringify(again.items));

/* ─────────── 5. formatShoppingText ─────────── */
console.log('\n=== formatShoppingText ===');
const demo = buildShoppingModel([
  { name: 'thịt bò', grams: 180, unit: 'g' },
  { name: 'cà chua', grams: 450, unit: 'g' },
  { name: 'cải xanh', grams: 600, unit: 'g' },
  { name: 'trứng gà', grams: 12, unit: 'quả' },
  { name: 'gạo lứt', grams: 1000, unit: 'g' },
], { servingsFactor: 1 });
const text = formatShoppingText(demo);
console.log('  →', text);
// Tên hiển thị dùng dạng chuẩn của từ điển ("Cà chua"), nên so không phân biệt hoa/thường.
const has = (frag) => text.toLowerCase().includes(frag.toLowerCase());
ok('có "2 bó cải xanh"', has('2 bó cải xanh'), text);
ok('có "12 quả trứng gà"', has('12 quả trứng gà'), text);
ok('có "1 kg gạo lứt"', has('1 kg gạo lứt'), text);
// 180 g → làm tròn LÊN 200 g vì đi chợ mua theo bội số 50 g. Đây là chủ đích.
ok('180 g thịt bò → mua 200 g (làm tròn theo cách mua)', has('200 g thịt bò'), text);
ok('450 g cà chua → mua 450 g', has('450 g cà chua'), text);

const estText = formatShoppingText(buildShoppingModel([{ name: 'cá lóc kho', grams: null, unit: null }], {}));
ok('món thiếu số hiện "(cần ước lượng)"', estText.includes('cần ước lượng'), estText);

/* ─────────── kết ─────────── */
console.log(`\n${pass}/${pass + fail} ca đạt${fail ? ` — ${fail} CA SAI` : ''}\n`);
process.exit(fail ? 1 : 0);
