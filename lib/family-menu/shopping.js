/**
 * lib/family-menu/shopping.js — dựng danh sách đi chợ "dùng được thật".
 *
 * Đầu vào là các dòng nguyên liệu thô của kế hoạch (tên tự do, đơn vị lẫn lộn).
 * Đầu ra là danh sách đã:
 *   • gộp trùng qua Ingredient Dictionary  ("ba rọi" + "thịt ba chỉ" = 1 dòng)
 *   • quy đổi đơn vị hiển thị             (1200 g → 1,2 kg)
 *   • làm tròn theo cách mua thật          (2,2 bó → 3 bó)
 *   • phân nhóm                            (Rau / Thịt / Hải sản / …)
 *   • gắn đơn giá + thành tiền             (thiếu giá → null, KHÔNG chặn)
 *   • gợi ý nguyên liệu thay thế
 *
 * Hàm thuần, không đụng DB — nhờ vậy test được và tái dùng cho cả API lẫn export.
 * Việc đọc/ghi Supabase nằm ở plan-builder.js.
 */
import { resolveIngredient, substitutesFor, listCategories } from './ingredients.js';
import { roundForPurchase, convertForDisplay, toBase } from './units.js';
import { resolvePrice } from './pricing.js';

/**
 * @typedef {object} RawIngredientRow
 * @property {string} name
 * @property {number|null} grams   lượng theo `unit` (tên cột lịch sử là grams)
 * @property {string} unit
 */

/**
 * Gộp các dòng nguyên liệu thô về danh sách chuẩn hoá.
 *
 * @param {RawIngredientRow[]} rows
 * @param {object} [opts]
 * @param {number} [opts.servingsFactor=1]  hệ số nhân khi đổi số suất
 * @param {string} [opts.region]
 * @param {string} [opts.householdId]
 * @param {Map}    [opts.adminPrices]
 * @param {Set<string>} [opts.purchasedIds]  id nguyên liệu đã tick "đã mua"
 * @returns {{ items: object[], groups: object[], totals: object }}
 */
export function buildShoppingModel(rows, opts = {}) {
  const {
    servingsFactor = 1,
    region,
    householdId,
    adminPrices,
    purchasedIds = new Set(),
  } = opts;

  /* 1 ─ gộp theo nguyên liệu chuẩn, cộng dồn ở ĐƠN VỊ GỐC để không sai số */
  const merged = new Map();

  for (const r of rows || []) {
    if (!r?.name) continue;
    const info = resolveIngredient(r.name);
    // Chưa tra được id thì gộp theo tên đã chuẩn hoá — vẫn tốt hơn gộp theo tên thô.
    const key = info.id || `raw:${info.canonical.toLowerCase()}`;
    const qty = (Number(r.grams) || 0) * servingsFactor;
    const base = toBase(qty, r.unit || 'g');
    // Với đơn vị đếm được, GIỮ NGUYÊN đơn vị gốc ('hộp', 'quả', 'bó') thay vì
    // quy về 'cái' — nếu không, tra giá theo đơn vị sẽ trượt.
    const baseUnit = base ? (base.family === 'count' ? String(r.unit || 'cái').toLowerCase().trim() : base.unit) : r.unit || 'g';

    const prev = merged.get(key) || {
      key,
      info,
      baseQty: 0,
      baseUnit,
      family: base?.family || 'count',
      sourceNames: new Set(),
      unmergeable: [],
    };

    if (base && baseUnit === prev.baseUnit) {
      prev.baseQty += base.qty;
    } else if (base) {
      // Đơn vị khác họ (vd cùng nguyên liệu ghi lúc 'g' lúc 'quả') — không ép
      // quy đổi bừa, tách thành dòng phụ và ghi chú để người dùng tự xử lý.
      prev.unmergeable.push({ qty: base.qty, unit: base.unit });
    } else {
      prev.baseQty += qty;
    }

    prev.sourceNames.add(String(r.name).trim());
    merged.set(key, prev);
  }

  /* 2 ─ làm tròn, quy đổi hiển thị, tính giá */
  const items = [];
  for (const m of merged.values()) {
    const displayName = m.info.canonical;
    const purchase = roundForPurchase(m.baseQty, m.baseUnit, displayName);
    const exact = convertForDisplay(m.baseQty, m.baseUnit);

    const { unitPrice, source: priceSource } = resolvePrice({
      name: displayName,
      displayUnit: purchase.unit,
      region,
      householdId,
      adminPrices,
    });

    const lineTotal = unitPrice != null ? Math.round(unitPrice * purchase.qty) : null;
    const aliases = [...m.sourceNames].filter((n) => n.toLowerCase() !== displayName.toLowerCase());

    items.push({
      ingredient_id: m.info.id,
      name: displayName,
      category: m.info.category,
      category_label: m.info.categoryLabel,
      category_order: m.info.categoryOrder,

      // Lượng để MUA (đã làm tròn) — đây là con số in ra cột "Số lượng".
      qty: purchase.qty,
      unit: purchase.unit,

      // Lượng CẦN chính xác — giữ để tính lại khi đổi số suất & để ghi chú.
      exact_qty: exact.qty,
      exact_unit: exact.unit,
      base_qty: Math.round(m.baseQty * 100) / 100,
      base_unit: m.baseUnit,
      rounded: purchase.rounded,

      unit_price: unitPrice,
      line_total: lineTotal,
      price_source: priceSource,

      substitutes: substitutesFor(m.info.id),
      aliases,
      unmergeable: m.unmergeable,
      purchased: purchasedIds.has(m.info.id || m.key),
      resolved: m.info.matched !== 'none',
    });
  }

  /* 3 ─ sắp xếp: nhóm trước, trong nhóm theo tên */
  items.sort((a, b) => a.category_order - b.category_order || a.name.localeCompare(b.name, 'vi'));

  /* 4 ─ gom nhóm để renderer chỉ việc đổ ra */
  const byCat = new Map();
  for (const it of items) {
    if (!byCat.has(it.category)) {
      byCat.set(it.category, { key: it.category, label: it.category_label, order: it.category_order, items: [], subtotal: 0, priced: 0 });
    }
    const g = byCat.get(it.category);
    g.items.push(it);
    if (it.line_total != null) {
      g.subtotal += it.line_total;
      g.priced += 1;
    }
  }
  const groups = [...byCat.values()].sort((a, b) => a.order - b.order);

  /* 5 ─ tổng hợp */
  const priced = items.filter((i) => i.line_total != null);
  const totals = {
    itemCount: items.length,
    groupCount: groups.length,
    pricedCount: priced.length,
    missingPriceCount: items.length - priced.length,
    estimatedCost: priced.reduce((s, i) => s + i.line_total, 0),
    /** Ước tính có đầy đủ hay không — hiển thị "≈" khi thiếu giá. */
    complete: priced.length === items.length,
  };

  return { items, groups, totals };
}

/**
 * Tính lại danh sách khi số suất thay đổi mà KHÔNG cần đọc lại kế hoạch.
 * @param {object} model  kết quả buildShoppingModel
 * @param {number} factor hệ số mới so với lúc dựng (vd 6 suất/4 suất = 1.5)
 */
export function rescaleShoppingModel(model, factor, opts = {}) {
  const rows = model.items.map((i) => ({ name: i.name, grams: i.base_qty, unit: i.base_unit }));
  return buildShoppingModel(rows, { ...opts, servingsFactor: factor });
}

/** Danh sách nhóm (kể cả nhóm rỗng) — dùng cho bộ lọc trên UI. */
export function allCategories() {
  return listCategories();
}

export default { buildShoppingModel, rescaleShoppingModel, allCategories };
