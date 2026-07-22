/**
 * scripts/test-nutrition.mjs — Offline regression test cho pipeline dinh dưỡng
 * (lib/nutrition.js). Chạy KHÔNG cần mạng / API key / Supabase thật:
 *   - fetch bị stub (reject) → USDA/OpenFoodFacts/AI anchor đều bỏ qua
 *   - Supabase trỏ tới URL giả → cache anchor rơi về memory (đã try/catch sẵn)
 *   → chỉ còn REFERENCE_PER100 / REFERENCE_UNITS (mốc tham chiếu deterministic),
 *     đủ để kiểm tra: parse định lượng, scale tuyến tính, tính lặp lại.
 *
 * Chạy:  node scripts/test-nutrition.mjs
 * Thoát code 0 = pass toàn bộ; 1 = có test fail.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost:54321";
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "test-key";
delete process.env.FDC_API_KEY; // bảo đảm không gọi USDA

// Chặn mọi network call → các nguồn online tự bỏ qua (đã có try/catch trong lib)
globalThis.fetch = () => Promise.reject(new Error("offline test: network disabled"));

const { parseQuantity, estimateFoodSmart, scaleLinear, validateNumericNutrition } =
  await import("../lib/nutrition.js");

let passed = 0;
let failed = 0;
const fail = (name, msg) => { failed++; console.error(`  ✗ ${name} — ${msg}`); };
const pass = (name) => { passed++; console.log(`  ✓ ${name}`); };

const assertEq = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return pass(name);
  fail(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const assertClose = (name, actual, expected, tol = 0.02) => {
  if (actual != null && Math.abs(actual - expected) <= Math.max(1, expected * tol)) return pass(name);
  fail(name, `expected ~${expected}, got ${actual}`);
};

/* ── 1. parseQuantity: định lượng Việt + Anh + phân số (Bug #2) ─────────── */
console.log("\n[1] parseQuantity");
const pq = (s) => parseQuantity(s);

assertEq("300ml sữa socola", (({ qty, unit, kind, ml }) => ({ qty, unit, kind, ml }))(pq("300ml sữa socola")),
  { qty: 300, unit: "ml", kind: "volume", ml: 300 });
assertEq("sữa socola 300ml (đơn vị đứng cuối)", pq("sữa socola 300ml")?.ml, 300);
assertEq("nửa lít sữa", pq("nửa lít sữa")?.ml, 500);
assertEq("2 quả chuối", (({ qty, kind, serving }) => ({ qty, kind, serving }))(pq("2 quả chuối")),
  { qty: 2, kind: "count", serving: false });
assertEq("1 tô phở", (({ qty, kind, serving }) => ({ qty, kind, serving }))(pq("1 tô phở")),
  { qty: 1, kind: "count", serving: true });
assertEq("nửa tô phở", pq("nửa tô phở")?.qty, 0.5);
assertEq("half bowl pho (EN)", pq("half bowl pho")?.qty, 0.5);
assertEq("half banana (EN, không đơn vị)", (({ qty, kind }) => ({ qty, kind }))(pq("half banana")),
  { qty: 0.5, kind: "count" });
assertClose("one third cup milk → ml", pq("one third cup milk")?.ml, 250 / 3);
assertClose("1/3 cup milk → ml", pq("1/3 cup milk")?.ml, 250 / 3);
assertEq("three slices bread (EN)", (({ qty, unit, kind }) => ({ qty, unit, kind }))(pq("three slices bread")),
  { qty: 3, unit: "slices", kind: "count" });
assertEq("one slice cake (EN)", pq("one slice cake")?.qty, 1);
assertEq("1 sushi (số trần qty=1)", (({ qty, kind, serving, baseFood }) => ({ qty, kind, serving, baseFood }))(pq("1 sushi")),
  { qty: 1, kind: "count", serving: false, baseFood: "sushi" });
assertEq("2 sushi", pq("2 sushi")?.qty, 2);
assertEq("10 chocolate chip cookies", pq("10 chocolate chip cookies")?.qty, 10);
assertEq("ba tô phở (số bằng chữ + đơn vị)", pq("ba tô phở")?.qty, 3);
assertEq("một phần ba tô phở → 1/3", pq("một phần ba tô phở")?.qty, 1 / 3);

// Guard: KHÔNG được nhầm tên món chứa số/từ-số
assertEq("chè 3 màu → null (số giữa tên)", pq("chè 3 màu"), null);
assertEq("ba rọi kho tiêu → null (ba = tên món)", pq("ba rọi kho tiêu"), null);
assertEq("một phần ba chỉ → 1 phần 'ba chỉ' (không phải 1/3)",
  (({ qty, unit, baseFood }) => ({ qty, unit, baseFood }))(pq("một phần ba chỉ")),
  { qty: 1, unit: "phần", baseFood: "ba chỉ" });
assertEq("cơm tấm (không định lượng) → null", pq("cơm tấm"), null);

/* ── 2. scaleLinear + Atwater validation ─────────────────────────────────── */
console.log("\n[2] scaleLinear / validateNumericNutrition");
const per100 = { calories: 60, protein: 3.2, fat: 3.3, carbs: 4.8, fiber: 0, sugar: 4.8, sodium: 44 };
assertEq("scale 3× kcal", scaleLinear(per100, 3).calories, 180);
assertEq("scale 3× protein", scaleLinear(per100, 3).protein, 9.6);
const atw = validateNumericNutrition({ calories: 1000, protein: 10, fat: 5, carbs: 20 });
assertEq("Atwater hiệu chỉnh kcal lệch >15%", atw.calories, Math.round(4 * 10 + 4 * 20 + 9 * 5));
assertEq("Atwater đánh dấu corrected", atw.corrected, true);
const neg = validateNumericNutrition({ calories: -50, protein: -1, fat: 0, carbs: 0 });
assertEq("chặn số âm", neg.protein, 0);

/* ── 3. estimateFoodSmart offline: deterministic + tuyến tính (Bug #1) ────── */
console.log("\n[3] estimateFoodSmart (offline, mốc tham chiếu)");
const est = (food) => estimateFoodSmart({ food, foodsDB: [] });

// 3a. Sữa 100/200/300/500ml — tuyến tính tuyệt đối
const milk = {};
for (const ml of [100, 200, 300, 500]) milk[ml] = await est(`${ml}ml sữa`);
if (!milk[100]) fail("milk anchor", "không lấy được mốc sữa offline");
else {
  assertEq("100ml sữa = 60 kcal", milk[100].calories, 60);
  assertEq("200ml = 2×100ml", milk[200].calories, 2 * milk[100].calories);
  assertEq("300ml = 3×100ml", milk[300].calories, 3 * milk[100].calories);
  assertEq("500ml = 5×100ml", milk[500].calories, 5 * milk[100].calories);
  const inc = [100, 200, 300, 500].map((k) => milk[k].calories);
  assertEq("monotonic tăng dần", [...inc].sort((a, b) => a - b), inc);
}

// 3b. Sushi 1/2/3 miếng — mốc/miếng × N
const s1 = await est("1 sushi");
const s2 = await est("2 sushi");
const s3 = await est("3 miếng sushi");
if (!s1) fail("sushi anchor", "không lấy được mốc sushi offline");
else {
  assertEq("1 sushi = 50 kcal (mốc/miếng, KHÔNG phải cả phần)", s1.calories, 50);
  assertEq("2 sushi = 2×1 sushi", s2.calories, 2 * s1.calories);
  assertEq("3 miếng sushi = 3×1 sushi", s3.calories, 3 * s1.calories);
}

// 3c. Chuối 1/2 quả + half banana
const b1 = await est("1 quả chuối");
const b2 = await est("2 quả chuối");
const bh = await est("half banana");
if (!b1) fail("banana anchor", "không lấy được mốc chuối offline");
else {
  assertEq("2 quả = 2×1 quả", b2.calories, 2 * b1.calories);
  assertClose("half banana ≈ 0.5×1 quả", bh?.calories, b1.calories / 2);
}

// 3d. Phở nửa tô / 1 tô (VI + EN)
const p1 = await est("1 tô phở");
const ph = await est("nửa tô phở");
const phEn = await est("half bowl pho");
if (!p1) fail("pho anchor", "không lấy được mốc phở offline");
else {
  assertEq("1 tô phở = 480 kcal (mốc tham chiếu)", p1.calories, 480);
  assertEq("nửa tô = 0.5×1 tô", ph.calories, Math.round(p1.calories * 0.5));
  assertEq("half bowl pho (EN) = nửa tô (VI)", phEn?.calories, ph.calories);
}

// 3e. Cơm tấm 1 phần + cơm trắng theo gram
const ct = await est("1 phần cơm tấm");
assertEq("1 phần cơm tấm = 650 kcal (mốc tham chiếu)", ct?.calories, 650);
const rice = await est("150g cơm trắng");
assertClose("150g cơm trắng ≈ 195 kcal", rice?.calories, 195);

// 3f. Sữa 1/3 cup (EN)
const m3 = await est("one third cup milk");
assertClose("one third cup milk ≈ 50 kcal", m3?.calories, 50);

// 3g. DETERMINISM: gọi lại nhiều lần → kết quả BẰNG NHAU TUYỆT ĐỐI
const detFoods = ["300ml sữa", "2 sushi", "nửa tô phở", "1 quả chuối", "1 phần cơm tấm"];
for (const f of detFoods) {
  const a = await est(f);
  const b = await est(f);
  const c = await est(f);
  assertEq(`deterministic: "${f}" (3 lần giống hệt)`,
    [JSON.stringify(b), JSON.stringify(c)], [JSON.stringify(a), JSON.stringify(a)]);
}

// 3h. Món không có mốc offline (coffee/pizza cần AI/USDA) → null, caller fallback
const cof = await est("cà phê sữa đá");
assertEq("món không mốc offline → null (fallback caller)", cof, null);

/* ── Kết quả ─────────────────────────────────────────────────────────────── */
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
