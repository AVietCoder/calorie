/**
 * lib/family-menu/units.js — quy đổi đơn vị + làm tròn theo cách người nội trợ mua.
 *
 * Hai việc khác nhau, đừng gộp:
 *
 *   convertForDisplay()  1200 g  → { qty: 1.2,  unit: 'kg' }      (chỉ đổi cách VIẾT)
 *   roundForPurchase()   2.2 bó  → { qty: 3,    unit: 'bó' }      (đổi cả GIÁ TRỊ)
 *
 * Cột "Số lượng" trong Shopping List dùng giá trị đã làm tròn (vì đó là thứ
 * thực sự phải mua), nhưng vẫn giữ `exactQty` để tính lại khi đổi số suất và
 * để ghi chú "cần 2,2 – mua 3".
 */
import catalog from '../../knowledge/ingredient-catalog.json' with { type: 'json' };
import { resolveIngredient } from './ingredients.js';

const FAMILIES = catalog.unitFamilies || {};
const DISPLAY_RULES = catalog.displayRules || {};
const DEFAULT_ROUNDING = catalog.defaultRounding || {};

/** Đơn vị thuộc họ nào (mass / volume / count)? */
export function unitFamily(unit) {
  const u = String(unit || 'g').toLowerCase().trim();
  for (const [family, def] of Object.entries(FAMILIES)) {
    if (def.units && u in def.units) return family;
  }
  return 'count';
}

/** Đổi về đơn vị gốc của họ (g / ml / cái). Trả null nếu không đổi được. */
export function toBase(qty, unit) {
  const u = String(unit || 'g').toLowerCase().trim();
  const family = unitFamily(u);
  const factor = FAMILIES[family]?.units?.[u];
  if (factor == null) return null;
  return { qty: Number(qty) * factor, unit: FAMILIES[family].base, family };
}

/**
 * Đổi cách hiển thị cho gọn mắt: 1000 g → 1 kg, 1500 ml → 1,5 l.
 * KHÔNG thay đổi lượng thực tế.
 */
export function convertForDisplay(qty, unit) {
  const base = toBase(qty, unit);
  if (!base) return { qty: round(Number(qty), 2), unit: unit || '', family: 'count' };

  const rules = DISPLAY_RULES[base.family] || [];
  for (const rule of rules) {
    if (base.qty >= rule.from) {
      return { qty: round(base.qty / rule.divide, rule.decimals ?? 1), unit: rule.to, family: base.family };
    }
  }
  return { qty: round(base.qty, base.family === 'count' ? 0 : 1), unit: base.unit, family: base.family };
}

/**
 * Làm tròn lên theo cách người đi chợ thật sự mua.
 *
 * Ưu tiên chuyển sang ĐƠN VỊ MUA của nguyên liệu nếu từ điển có khai báo:
 *   750 g rau muống  → gramsPerUnit 300 → 2,5 bó → làm tròn → 3 bó
 *   340 g thịt ba chỉ → purchaseUnit kg → 0,34 kg → roundTo 0,1 → 0,4 kg
 *
 * @param {number} qty      lượng cần (theo `unit`)
 * @param {string} unit     đơn vị của qty
 * @param {string} rawName  tên nguyên liệu (để tra từ điển)
 */
export function roundForPurchase(qty, unit, rawName) {
  const info = resolveIngredient(rawName);
  const base = toBase(qty, unit);
  const exact = Number(qty) || 0;

  // 1) Nguyên liệu bán theo đơn vị đếm được (bó / quả / hộp / bìa)
  if (info.purchaseUnit && info.gramsPerUnit && base && base.family !== 'count') {
    const units = base.qty / info.gramsPerUnit;
    const step = info.roundTo || 1;
    const bought = ceilTo(units, step);
    return {
      qty: bought,
      unit: info.purchaseUnit,
      exactQty: round(units, 2),
      exactUnit: info.purchaseUnit,
      rounded: Math.abs(bought - units) > 0.001,
      baseQty: base.qty,
      baseUnit: base.unit,
    };
  }

  // 2) Nguyên liệu bán theo LỐC/HỘP có dung tích cố định (sữa 180 ml/hộp…)
  if (info.packSize && info.packUnit && base && base.family !== 'count') {
    const packs = Math.ceil((base.qty - 1e-9) / info.packSize);
    return {
      qty: packs,
      unit: info.packUnit,
      exactQty: round(base.qty / info.packSize, 2),
      exactUnit: info.packUnit,
      rounded: Math.abs(packs - base.qty / info.packSize) > 0.001,
      baseQty: base.qty,
      baseUnit: base.unit,
      packNote: `${packs} × ${info.packSize} ${base.unit}`,
    };
  }

  // 3) Nguyên liệu bán theo cân/thể tích
  if (base && base.family !== 'count') {
    const disp = convertForDisplay(base.qty, base.unit);
    const step = pickStep(info, disp.unit, base.family);
    const bought = ceilTo(disp.qty, step);
    return {
      qty: bought,
      unit: disp.unit,
      exactQty: disp.qty,
      exactUnit: disp.unit,
      rounded: Math.abs(bought - disp.qty) > 0.001,
      baseQty: base.qty,
      baseUnit: base.unit,
    };
  }

  // 4) Đơn vị đếm sẵn (quả, hộp…)
  const step = info.roundTo || DEFAULT_ROUNDING.count?.roundTo || 1;
  const bought = ceilTo(exact, step);
  return {
    qty: bought,
    unit: unit || info.purchaseUnit || 'cái',
    exactQty: round(exact, 2),
    exactUnit: unit || info.purchaseUnit || 'cái',
    rounded: Math.abs(bought - exact) > 0.001,
    baseQty: exact,
    baseUnit: unit || 'cái',
  };
}

function pickStep(info, displayUnit, family) {
  if (info.roundTo != null && info.purchaseUnit === displayUnit) return info.roundTo;
  if (displayUnit === 'kg') return DEFAULT_ROUNDING.massKg?.roundTo ?? 0.1;
  if (displayUnit === 'l') return 0.1;
  return DEFAULT_ROUNDING[family]?.roundTo ?? 50;
}

function ceilTo(v, step) {
  if (!step || step <= 0) return round(v, 2);
  return round(Math.ceil((v - 1e-9) / step) * step, 3);
}

function round(v, d = 2) {
  const m = 10 ** d;
  return Math.round((Number(v) || 0) * m) / m;
}

/** Định dạng số kiểu Việt Nam: 1234.5 → "1.234,5" */
export function formatQty(v, decimals = null) {
  const n = Number(v) || 0;
  const d = decimals != null ? decimals : Number.isInteger(n) ? 0 : n < 10 ? 1 : 0;
  return n.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default { unitFamily, toBase, convertForDisplay, roundForPurchase, formatQty };
