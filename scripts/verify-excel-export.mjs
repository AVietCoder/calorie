#!/usr/bin/env node
/**
 * scripts/verify-excel-export.mjs — kiểm thử khói cho phân hệ Excel.
 *
 *   node scripts/verify-excel-export.mjs [--out ./tmp] [--import <file.xlsx>]
 *
 * Không cần Supabase, không cần LLM: dựng một export model giả rồi render đủ
 * 4 sheet, sau đó (tuỳ chọn) chạy ngược bộ nhập trên một file thực đơn thật.
 *
 * Dùng để kiểm tra nhanh sau khi đổi theme/template mà không phải chạy cả app.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { exportPlanWorkbook, exportImportTemplate } from '../lib/excel/index.js';
import { buildShoppingModel } from '../lib/family-menu/shopping.js';
import { resolveIngredient } from '../lib/family-menu/ingredients.js';
import { roundForPurchase, convertForDisplay } from '../lib/family-menu/units.js';
import { dayLabel } from '../lib/excel/labels.js';

const args = parseArgs(process.argv.slice(2));
const OUT_DIR = args.out || './tmp-excel-verify';

/* ───────────────────────── model giả ───────────────────────── */

const MEALS = ['breakfast', 'lunch', 'snack', 'dinner'];
const SAMPLE = {
  breakfast: [['Phở gà', 400, 450], ['Bánh cuốn', 300, 380]],
  lunch: [['Cơm gạo lứt', 200, 260], ['Cá basa kho tộ', 120, 210], ['Canh bí đao nấu tôm', 200, 90], ['Rau muống luộc', 150, 40]],
  snack: [['Sữa chua ít đường', 100, 90]],
  dinner: [['Cơm gạo lứt', 180, 230], ['Ức gà xào bông cải', 150, 240], ['Canh cải ngọt', 200, 60]],
};

const INGREDIENTS = {
  'Phở gà': [['Bánh phở', 180, 'g'], ['Thịt gà', 100, 'g'], ['Hành lá', 10, 'g']],
  'Bánh cuốn': [['Bánh cuốn', 200, 'g'], ['Thịt nạc heo', 50, 'g']],
  'Cơm gạo lứt': [['Gạo lứt', 90, 'g']],
  'Cá basa kho tộ': [['Cá basa', 120, 'g'], ['Nước mắm', 15, 'ml'], ['Đường', 8, 'g']],
  'Canh bí đao nấu tôm': [['Bí đao', 150, 'g'], ['Tôm tươi', 40, 'g']],
  'Rau muống luộc': [['Rau muống', 150, 'g']],
  'Sữa chua ít đường': [['Sữa chua', 1, 'hộp']],
  'Ức gà xào bông cải': [['Ức gà', 120, 'g'], ['Bông cải xanh', 100, 'g'], ['Dầu ăn', 10, 'ml']],
  'Canh cải ngọt': [['Cải ngọt', 150, 'g']],
};

function buildFakeModel() {
  const dishes = [];
  const ingredientRows = [];
  const days = [];

  for (let dayIndex = 1; dayIndex <= 7; dayIndex++) {
    const meals = {};
    const totals = zero();
    for (const mt of MEALS) {
      const picked = SAMPLE[mt];
      const cell = [];
      for (const [name, grams, kcal] of picked) {
        const d = {
          id: `${dayIndex}-${mt}-${name}`,
          dayIndex,
          dayLabel: dayLabel(dayIndex, { withDate: false }),
          mealType: mt,
          mealLabel: { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ' }[mt],
          name,
          // Khoảng giá dạng chữ — cố tình để một số món trống để kiểm tra cột
          // "Giá tiền" chịu được ô rỗng mà không rơi ra "undefined".
          price: kcal >= 200 ? `${fmtVnd(kcal * 80)} -> ${fmtVnd(kcal * 110)}` : '',
          grams,
          calories: kcal,
          protein: Math.round(kcal * 0.05 * 10) / 10,
          fat: Math.round(kcal * 0.03 * 10) / 10,
          carbs: Math.round(kcal * 0.12 * 10) / 10,
          fiber: 2,
          sugar: 3,
          sodium: Math.round(kcal * 1.5),
          tags: [],
          adjusted: dayIndex === 3 && mt === 'lunch' && name.includes('Cá'),
          reason: dayIndex === 3 && mt === 'lunch' && name.includes('Cá') ? 'Dị ứng "hải sản" → loại món có nhãn "hải sản"' : null,
        };
        dishes.push(d);
        cell.push(d);
        for (const k of ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'sodium']) {
          totals[k] = Math.round((totals[k] + d[k]) * 10) / 10;
        }
        for (const [iname, qty, unit] of INGREDIENTS[name] || []) {
          ingredientRows.push({ name: iname, grams: qty, unit });
        }
      }
      meals[mt] = { dishes: cell, text: cell.map((d) => `${d.name} (${d.grams} g · ${d.calories} kcal)`).join('\n') };
    }
    totals.calories = Math.round(totals.calories);
    days.push({ dayIndex, label: dayLabel(dayIndex), labelPlain: dayLabel(dayIndex, { withDate: false }), meals, totals });
  }

  const shopping = buildShoppingModel(ingredientRows, { servingsFactor: 1, region: 'hcm' });
  const nutritionTotals = zero();
  for (const d of days) {
    for (const k of Object.keys(nutritionTotals)) nutritionTotals[k] = Math.round((nutritionTotals[k] + d.totals[k]) * 10) / 10;
  }
  nutritionTotals.calories = Math.round(nutritionTotals.calories);

  return {
    plan: { id: 'fake-plan' },
    household: { id: 'fake-household', mode: 'family', region: 'hcm' },
    members: [
      { display_name: 'Bố', disease: 'tiểu đường', allergies: [], dislikes: ['mướp đắng'] },
      { display_name: 'Mẹ', disease: '', allergies: ['hải sản'], dislikes: [] },
      { display_name: 'Con', disease: '', allergies: [], dislikes: [] },
    ],
    template: { title: 'Thực đơn 7 ngày cho người tiểu đường' },
    servings: 3,
    baseServings: 3,
    servingsFactor: 1,
    startDate: null,
    mealTypes: MEALS,
    days,
    dishes,
    shopping,
    nutritionTotals,
    warnings: [],
    generatedAt: new Date(),
  };
}

function zero() {
  return { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0, sodium: 0 };
}

/* ───────────────────────── chạy ───────────────────────── */

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  let failures = 0;

  console.log('▶ 1. Ingredient Dictionary');
  for (const raw of ['ba rọi', 'thịt ba chỉ heo', '30 g tôm tươi', 'Rau muống', '100 ml sữa tách béo', 'xyz lạ hoắc']) {
    const r = resolveIngredient(raw);
    console.log(`   "${raw}" → ${r.canonical} [${r.categoryLabel}] (${r.matched})`);
  }
  const a = resolveIngredient('ba rọi');
  const b = resolveIngredient('thịt ba chỉ heo');
  assert(a.id === b.id && a.id === 'thit_ba_chi', 'gộp alias thịt ba chỉ', () => failures++);

  console.log('\n▶ 2. Quy đổi & làm tròn');
  for (const [q, u, name] of [[1200, 'g', 'Thịt ba chỉ'], [750, 'g', 'Rau muống'], [2400, 'ml', 'Sữa tươi'], [3, 'quả', 'Trứng gà']]) {
    const disp = convertForDisplay(q, u);
    const buy = roundForPurchase(q, u, name);
    console.log(`   ${q} ${u} ${name} → hiển thị ${disp.qty} ${disp.unit} | mua ${buy.qty} ${buy.unit}${buy.rounded ? ' (đã làm tròn lên)' : ''}`);
  }
  const rm = roundForPurchase(750, 'g', 'Rau muống');
  assert(rm.unit === 'bó' && rm.qty === 3, '750 g rau muống → 3 bó', () => failures++);

  console.log('\n▶ 3. Render workbook 4 sheet');
  const model = buildFakeModel();
  const { buffer, filename, sheets } = await exportPlanWorkbook(model);
  const outPath = path.join(OUT_DIR, filename);
  await fs.writeFile(outPath, buffer);
  console.log(`   ✔ ${outPath} (${(buffer.length / 1024).toFixed(1)} KB) — sheets: ${sheets.join(', ')}`);
  assert(sheets.length === 4, 'đủ 4 sheet', () => failures++);
  assert(buffer.length > 8000, 'file có nội dung', () => failures++);

  console.log('\n▶ 4. Tổng chi phí');
  const t = model.shopping.totals;
  console.log(`   ${t.itemCount} nguyên liệu · ${t.pricedCount} có giá · thiếu ${t.missingPriceCount}`);
  console.log(`   Tổng ước tính: ${t.estimatedCost.toLocaleString('vi-VN')} đ`);
  assert(t.estimatedCost > 0, 'tính được chi phí', () => failures++);

  console.log('\n▶ 5. File mẫu nhập liệu');
  const tpl = await exportImportTemplate();
  await fs.writeFile(path.join(OUT_DIR, tpl.filename), tpl.buffer);
  console.log(`   ✔ ${path.join(OUT_DIR, tpl.filename)} — sheets: ${tpl.sheets.join(', ')}`);

  if (args.import) {
    console.log('\n▶ 6. Nhập ngược file thật (không dùng AI)');
    const { importMenuWorkbook } = await import('../lib/excel/import/index.js');
    const buf = await fs.readFile(args.import);
    try {
      const { days, report } = await importMenuWorkbook(buf, { useAI: false });
      console.log(`   ✔ ${path.basename(args.import)} → ${report.dayCount} ngày, ${report.dishCount} món (${report.strategy}, tin cậy ${report.confidence})`);
      console.log(`     Bữa: ${(report.mealColumns || []).join(' | ')}`);
      console.log(`     Ngày 1: ${days[0]?.meals?.map((m) => `${m.meal_type}=${m.dishes.length}`).join(', ')}`);
    } catch (e) {
      console.log(`   ✘ ${e.message}`);
      failures++;
    }
  }

  console.log(failures === 0 ? '\n✅ Tất cả kiểm tra đều đạt.' : `\n❌ ${failures} kiểm tra thất bại.`);
  process.exit(failures === 0 ? 0 : 1);
}

function assert(cond, label, onFail) {
  if (cond) console.log(`   ✔ ${label}`);
  else {
    console.log(`   ✘ ${label}`);
    onFail?.();
  }
}

/** 36000 → "36.000đ" — chỉ để dựng dữ liệu giả cho kiểm thử. */
function fmtVnd(n) {
  return `${Math.round(n / 1000) * 1000}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  }
  return out;
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
