/**
 * lib/family-menu/pricing.js — giải giá nguyên liệu.
 *
 * Thứ tự ưu tiên (dừng ở nguồn đầu tiên có giá):
 *
 *   1. Giá Admin cấu hình cho ĐÚNG household  (bảng ingredient_prices, household_id)
 *   2. Giá Admin cấu hình cho ĐÚNG khu vực    (bảng ingredient_prices, region)
 *   3. Giá Admin cấu hình toàn hệ thống       (bảng ingredient_prices, global)
 *   4. Giá tham khảo theo khu vực             (knowledge/ingredient-prices.json → regionPrices)
 *   5. Giá tham khảo mặc định × hệ số vùng    (knowledge/ingredient-prices.json → prices)
 *   6. null → Shopping List in dấu "-", KHÔNG chặn export
 *
 * Bảng DB là tuỳ chọn: nếu migration chưa chạy, module tự lùi về bảng giá tĩnh
 * và ghi log cảnh báo — export vẫn chạy bình thường.
 */
import priceBook from '../../knowledge/ingredient-prices.json' with { type: 'json' };
import { resolveIngredient } from './ingredients.js';
import { toBase, unitFamily } from './units.js';

const TABLE = 'ingredient_prices';
const CACHE_TTL_MS = 60_000;

let _cache = null;
let _cacheAt = 0;
let _tableMissing = false;

/**
 * Nạp toàn bộ giá Admin một lần cho mỗi lần build danh sách (tránh N+1 query).
 * @returns {Promise<Map<string, object[]>>} ingredient_id → các dòng giá
 */
export async function loadAdminPrices() {
  if (_tableMissing) return new Map();
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;

  try {
    // Nạp muộn: nhờ vậy resolvePrice()/buildShoppingModel() vẫn là hàm thuần,
    // chạy được trong unit test và script offline mà không cần biến môi trường
    // Supabase.
    const { supabaseAdmin } = await import('../supabase.js');
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('ingredient_id, unit, price, region, household_id, active')
      .eq('active', true);
    if (error) throw error;

    const map = new Map();
    for (const row of data || []) {
      if (!map.has(row.ingredient_id)) map.set(row.ingredient_id, []);
      map.get(row.ingredient_id).push(row);
    }
    _cache = map;
    _cacheAt = Date.now();
    return map;
  } catch (err) {
    // Bảng chưa tồn tại (migration chưa chạy) — không phải lỗi chí mạng.
    console.warn(`⚠️ [pricing] không đọc được ${TABLE}, dùng bảng giá tham khảo: ${err.message}`);
    _tableMissing = true;
    return new Map();
  }
}

export function resetPriceCache() {
  _cache = null;
  _tableMissing = false;
}

/**
 * Đơn giá của một nguyên liệu, quy về ĐÚNG đơn vị đang hiển thị.
 *
 * @param {object} args
 * @param {string} args.name          tên nguyên liệu thô
 * @param {string} args.displayUnit   đơn vị dòng đó đang hiển thị ('kg' | 'bó' | 'quả'…)
 * @param {string} [args.region]      khu vực của household
 * @param {string} [args.householdId]
 * @param {Map} [args.adminPrices]    kết quả loadAdminPrices()
 * @returns {{ unitPrice: number|null, source: string, priceUnit: string|null }}
 */
export function resolvePrice({ name, displayUnit, region, householdId, adminPrices }) {
  const info = resolveIngredient(name);
  const id = info.id;
  if (!id) return { unitPrice: null, source: 'unknown-ingredient', priceUnit: null };

  const rows = adminPrices?.get(id) || [];
  const pick =
    rows.find((r) => householdId && r.household_id === householdId) ||
    rows.find((r) => region && r.region && normRegion(r.region) === normRegion(region)) ||
    rows.find((r) => !r.household_id && !r.region);

  if (pick) {
    const converted = convertPrice(pick.price, pick.unit, displayUnit, info);
    if (converted != null) return { unitPrice: converted, source: 'admin', priceUnit: displayUnit };
  }

  const regionEntry = region ? priceBook.regionPrices?.[normRegion(region)]?.[id] : null;
  if (regionEntry) {
    const converted = convertPrice(regionEntry.price, regionEntry.unit, displayUnit, info);
    if (converted != null) return { unitPrice: converted, source: 'reference-region', priceUnit: displayUnit };
  }

  const base = priceBook.prices?.[id];
  if (base) {
    const mult = priceBook._regionMultipliers?.[normRegion(region)] ?? priceBook._regionMultipliers?.default ?? 1;
    const converted = convertPrice(base.price * mult, base.unit, displayUnit, info);
    if (converted != null) return { unitPrice: converted, source: 'reference', priceUnit: displayUnit };
  }

  return { unitPrice: null, source: 'no-price', priceUnit: null };
}

/**
 * Đổi đơn giá từ đơn vị niêm yết sang đơn vị đang hiển thị.
 * 140.000 đ/kg + displayUnit 'g' → 140 đ/g.
 * Nếu hai đơn vị khác họ (đ/kg → đ/bó) thì dùng gramsPerUnit của từ điển.
 */
function convertPrice(price, priceUnit, displayUnit, info) {
  const p = Number(price);
  if (!Number.isFinite(p)) return null;
  if (!displayUnit || normUnit(priceUnit) === normUnit(displayUnit)) return round(p);

  const famPrice = unitFamily(priceUnit);
  const famDisplay = unitFamily(displayUnit);

  // cùng họ: quy về đơn vị gốc rồi nhân ngược
  if (famPrice === famDisplay && famPrice !== 'count') {
    const onePrice = toBase(1, priceUnit);
    const oneDisplay = toBase(1, displayUnit);
    if (onePrice && oneDisplay) return round((p / onePrice.qty) * oneDisplay.qty);
  }

  // khác họ: cần cầu nối gramsPerUnit ('bó' ↔ 'g')
  if (info?.gramsPerUnit) {
    if (famPrice !== 'count' && famDisplay === 'count') {
      const onePrice = toBase(1, priceUnit);
      if (onePrice) return round((p / onePrice.qty) * info.gramsPerUnit);
    }
    if (famPrice === 'count' && famDisplay !== 'count') {
      const oneDisplay = toBase(1, displayUnit);
      if (oneDisplay) return round((p / info.gramsPerUnit) * oneDisplay.qty);
    }
  }

  return null;
}

function normUnit(u) {
  return String(u || '').toLowerCase().trim();
}

function normRegion(r) {
  return String(r || 'default')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'default';
}

function round(v) {
  return Math.round(Number(v) * 100) / 100;
}

/** Định dạng tiền VND; null → '-' (yêu cầu: không báo lỗi, không dừng export). */
export function formatMoney(v) {
  if (v == null || !Number.isFinite(Number(v))) return '-';
  return Math.round(Number(v)).toLocaleString('vi-VN');
}

export const PRICE_BOOK_VERSION = priceBook._updatedAt || 'n/a';

export default { loadAdminPrices, resolvePrice, formatMoney, resetPriceCache };
