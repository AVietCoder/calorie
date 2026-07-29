/**
 * scripts/build-sample-menus.mjs — sinh knowledge/sample-menus.json từ reference-menus/.
 *
 *   npm run build:sample-menus
 *
 * Vì sao phải sinh ra JSON rồi commit: reference-menus/*.xlsx bị .gitignore nên
 * KHÔNG tồn tại trên Vercel. App đọc JSON đã commit, không đọc xlsx lúc chạy.
 *
 * Dùng lại đúng importer deterministic của tính năng upload (useAI:false), nên
 * thực đơn mẫu được sinh bằng cùng code chạy khi người dùng tải file lên.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
loadEnv(path.join(ROOT, '.env.local'));

const { importMenuWorkbook } = await import('../lib/excel/import/index.js');

const args = process.argv.slice(2);
const SRC = valueOf('--src') || path.join(ROOT, 'reference-menus');
const OUT = valueOf('--out') || path.join(ROOT, 'knowledge', 'sample-menus.json');
const LIMIT = Number(valueOf('--limit') || 8);
const MAX_BYTES = Number(valueOf('--max-bytes') || 180_000);
const MAX_DISHES_PER_MEAL = 6;

/**
 * Ngưỡng hợp lý cho MỘT món. Heuristic dò cột dinh dưỡng của importer hay gán
 * số của cả HÀNG (thậm chí tổng cả ngày) cho từng món — đo trên corpus thật thì
 * 88/122 món có calo phi lý. Thà để TRỐNG còn hơn hiển thị số sai.
 */
const PLAUSIBLE = { calories: 1500, protein: 150, fat: 150, carbs: 300, fiber: 100, sugar: 200, sodium: 10000 };

const DISEASE_TAGS = {
  'TIỂU ĐƯỜNG': 'tiểu đường',
  GOUT: 'gout',
  'CAO HUYẾT ÁP': 'huyết áp cao',
  'GAN NHIỄM MỠ': 'gan nhiễm mỡ',
  'MỠ MÁU CAO': 'mỡ máu cao',
};

if (!fs.existsSync(SRC)) fail(`Không thấy thư mục nguồn: ${SRC}`);

const files = fs.readdirSync(SRC).filter((f) => /\.xlsx?m?$/i.test(f)).sort();
console.log(`\nĐọc ${files.length} file từ ${path.relative(ROOT, SRC)}\n`);

const candidates = [];
for (const file of files) {
  try {
    const { days, report } = await importMenuWorkbook(fs.readFileSync(path.join(SRC, file)), { useAI: false });
    const trimmed = trimDays(days);
    const dishes = countDishes(trimmed);
    const withIng = countDishesWithIngredients(trimmed);

    console.log(`  ${pad(file, 46)} ngày=${pad(trimmed.length, 3)} món=${pad(dishes, 4)} có-NL=${pad(withIng, 4)} conf=${report.confidence ?? '-'}`);

    // Mẫu phải ĐỦ DÙNG: ít nhất 5 ngày và có nguyên liệu, nếu không thì danh
    // sách đi chợ rỗng và mẫu trở nên vô nghĩa.
    if (trimmed.length < 5 || dishes < 10) continue;
    candidates.push({ file, days: trimmed, dishes, withIng, confidence: report.confidence ?? null });
  } catch (e) {
    console.log(`  ${pad(file, 46)} BỎ QUA: ${e.message.slice(0, 50)}`);
  }
}

// Ưu tiên file nhiều nguyên liệu nhất — mẫu có nguyên liệu mới chứng minh được
// đủ chuỗi Meal Plan → Shopping List → Export.
candidates.sort((a, b) => b.withIng - a.withIng || b.dishes - a.dishes);
const picked = candidates.slice(0, LIMIT);

const menus = picked.map(({ file, days, confidence }) => {
  const { title, tags } = describe(file);
  return {
    id: slug(file),
    title,
    tags,
    disease_target: tags,
    source: sourceName(file),
    dayCount: days.length,
    confidence,
    days,
  };
});

const payload = {
  _generatedBy: 'scripts/build-sample-menus.mjs',
  _generatedAt: new Date().toISOString(),
  _sourceCount: files.length,
  _note: 'Sinh tự động từ reference-menus/. KHÔNG sửa tay — chạy lại npm run build:sample-menus.',
  menus,
};

const json = `${JSON.stringify(payload, null, 2)}\n`;
const bytes = Buffer.byteLength(json, 'utf8');

console.log(`\nChọn ${menus.length}/${candidates.length} thực đơn · ${bytes.toLocaleString('vi-VN')} bytes`);
for (const m of menus) console.log(`  · ${pad(m.title, 44)} ${m.dayCount} ngày  [${m.tags.join(', ') || 'chung'}]`);

if (bytes > MAX_BYTES) {
  fail(`Vượt ngưỡng ${MAX_BYTES.toLocaleString('vi-VN')} bytes — JSON này bị nhét vào serverless bundle. Giảm --limit.`);
}
if (!menus.length) fail('Không có thực đơn nào đạt yêu cầu.');

fs.writeFileSync(OUT, json, 'utf8');
console.log(`\nĐã ghi ${path.relative(ROOT, OUT)}\n`);

/* ───────────────────────── helpers ───────────────────────── */

function trimDays(days) {
  return (days || [])
    .filter((d) => d.day_index >= 1 && d.day_index <= 7)
    .sort((a, b) => a.day_index - b.day_index)
    .map((d) => ({
      day_index: d.day_index,
      meals: (d.meals || []).map((m) => ({
        meal_type: m.meal_type,
        dishes: (m.dishes || []).slice(0, MAX_DISHES_PER_MEAL).map(slimDish),
      })).filter((m) => m.dishes.length),
    }))
    .filter((d) => d.meals.length);
}

/** Chỉ giữ trường UI/shopping cần — bỏ hết metadata import cho nhẹ file. */
function slimDish(d) {
  const out = { name: d.name };
  if (d.base_grams != null) out.base_grams = d.base_grams;
  for (const [k, max] of Object.entries(PLAUSIBLE)) {
    const v = d[k];
    if (v != null && Number.isFinite(v) && v >= 0 && v <= max) out[k] = v;
  }
  if (d.ingredients?.length) {
    out.ingredients = d.ingredients.map((i) => ({ name: i.name, grams: i.grams ?? null, unit: i.unit ?? null }));
  }
  return out;
}

function countDishes(days) {
  return days.reduce((s, d) => s + d.meals.reduce((t, m) => t + m.dishes.length, 0), 0);
}

function countDishesWithIngredients(days) {
  return days.reduce((s, d) => s + d.meals.reduce((t, m) => t + m.dishes.filter((x) => x.ingredients?.length).length, 0), 0);
}

function describe(file) {
  const base = file.replace(/\.xlsx?m?$/i, '');
  const m = base.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (m) {
    const tag = DISEASE_TAGS[m[1].trim().toUpperCase()] || m[1].trim().toLowerCase();
    return { title: `Thực đơn ${tag} — ${m[2].trim()}`, tags: [tag] };
  }
  return { title: base.replace(/_/g, ' ').trim(), tags: [] };
}

function sourceName(file) {
  return file.replace(/\.xlsx?m?$/i, '').replace(/^\[[^\]]+\]\s*/, '').trim();
}

function slug(file) {
  return file
    .replace(/\.xlsx?m?$/i, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 60);
}

function pad(v, n) {
  return String(v).padEnd(n).slice(0, n);
}

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}
