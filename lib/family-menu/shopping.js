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
import { roundForPurchase, convertForDisplay, toBase, formatQty } from './units.js';
import { resolvePrice } from './pricing.js';

/**
 * @typedef {object} RawIngredientRow
 * @property {string} name
 * @property {number|null} grams   lượng theo `unit` (tên cột lịch sử là grams)
 * @property {string} unit
 * @property {string} [price]      giá nguyên văn khai trong Excel (tuỳ chọn)
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

    // Thực đơn nguồn không khai định lượng ("Cá lóc kho:"). PHẢI phân nhánh theo
    // grams == null, KHÔNG để `Number(null) || 0` biến thành 0 — đó chính là bịa số.
    const unknown = r.grams == null || r.grams === '';
    const qty = unknown ? 0 : (Number(r.grams) || 0) * servingsFactor;
    const base = unknown ? null : toBase(qty, r.unit || 'g');
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
      unknownCount: 0,
      /** Giá người nhập khai trong Excel cho nguyên liệu này (nguyên văn). */
      manualPrice: '',
    };

    // Nhiều món cùng dùng một nguyên liệu và mỗi món khai một giá — lấy giá đầu
    // tiên khai được. Gộp/trung bình các chuỗi giá là vô nghĩa.
    if (!prev.manualPrice && String(r.price || '').trim()) {
      prev.manualPrice = String(r.price).trim();
    }

    if (unknown) {
      prev.unknownCount += 1;
    } else if (base && baseUnit === prev.baseUnit) {
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
    const aliases = [...m.sourceNames].filter((n) => n.toLowerCase() !== displayName.toLowerCase());

    const common = {
      ingredient_id: m.info.id,
      name: displayName,
      category: m.info.category,
      category_label: m.info.categoryLabel,
      category_order: m.info.categoryOrder,
      substitutes: substitutesFor(m.info.id),
      aliases,
      unmergeable: m.unmergeable,
      purchased: purchasedIds.has(m.info.id || m.key),
      resolved: m.info.matched !== 'none',
      needs_estimate: m.unknownCount > 0,
      /** Chuỗi giá nguyên văn từ Excel — hiển thị y nguyên, không định dạng lại. */
      manual_price: m.manualPrice || null,
    };

    // Không có dòng nào khai định lượng ⇒ vẫn phải mua, nhưng KHÔNG được đoán số.
    // Bỏ qua luôn làm tròn và tra giá: nhân giá với 0 sẽ ra "0 đ" sai sự thật.
    if (m.baseQty === 0 && m.unknownCount > 0) {
      items.push({
        ...common,
        qty: null, unit: null,
        exact_qty: null, exact_unit: null,
        base_qty: null, base_unit: null,
        rounded: false,
        unit_price: null, line_total: null, price_source: null,
      });
      continue;
    }

    const purchase = roundForPurchase(m.baseQty, m.baseUnit, displayName);
    const exact = convertForDisplay(m.baseQty, m.baseUnit);

    const auto = resolvePrice({
      name: displayName,
      displayUnit: purchase.unit,
      region,
      householdId,
      adminPrices,
    });

    /*
     * Giá khai trong Excel CHỈ để hiển thị, KHÔNG dùng để nhân ra Thành tiền.
     *
     * Lý do: `line_total = unit_price × purchase.qty`, mà purchase.qty ở đơn vị
     * mua thực tế ("1.2 kg", "1260 g", "3 bó"). File Excel không có chỗ khai
     * giá đó tính trên đơn vị nào — người dùng gõ "12.000đ" cho dòng "Bánh phở
     * 180 g" có thể là giá cho 180 g ấy, hoặc giá mỗi kg. Đoán sai một nhịp là
     * ra hoá đơn hàng chục triệu (đã gặp đúng như vậy khi thử nhân).
     *
     * Nên Thành tiền vẫn do bảng giá tự động quyết định — nó biết đơn vị. Giá
     * người nhập hiện nguyên văn ở cột Đơn giá để đối chiếu.
     */
    const { unitPrice, source: priceSource } = auto;

    items.push({
      ...common,

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
      line_total: unitPrice != null ? Math.round(unitPrice * purchase.qty) : null,
      price_source: priceSource,

      // Có số, nhưng vẫn còn dòng thiếu định lượng — số hiển thị là CHƯA ĐỦ.
      partial_estimate: m.unknownCount > 0,
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
    /** Số mục thực đơn nguồn không khai định lượng — người dùng phải tự ước. */
    estimateCount: items.filter((i) => i.needs_estimate).length,
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
  // grams: null cho mục "cần ước lượng" — nếu truyền base_qty (đang là null) mà
  // không giữ chủ đích thì nhân hệ số sẽ biến nó thành 0 và mất cờ.
  const rows = model.items.map((i) => ({
    name: i.name,
    grams: i.needs_estimate && i.base_qty == null ? null : i.base_qty,
    unit: i.base_unit,
  }));
  return buildShoppingModel(rows, { ...opts, servingsFactor: factor });
}

/**
 * Dựng model kèm việc nạp bảng giá — ĐIỂM VÀO DUY NHẤT cho cả API lẫn export.
 *
 * Trước đây plan-builder và plan-export mỗi bên tự gọi loadAdminPrices +
 * buildShoppingModel, nên màn hình và file Excel có thể ra số khác nhau.
 */
export async function computeShoppingModel(rows, opts = {}) {
  const { household, servings, baseServings = 1, purchasedIds } = opts;
  const { loadAdminPrices } = await import('./pricing.js');
  const base = Math.max(1, Number(baseServings) || 1);
  const want = Math.max(1, Number(servings) || base);
  return buildShoppingModel(rows, {
    servingsFactor: want / base,
    region: household?.region,
    householdId: household?.id,
    adminPrices: await loadAdminPrices(),
    purchasedIds,
  });
}

/**
 * Model riêng cho TỪNG NGÀY — phục vụ tờ note "hôm nay cần mua gì".
 *
 * Dùng lại nguyên buildShoppingModel nên tên, nhóm và cách gộp giống hệt danh
 * sách cả tuần; chỉ nạp bảng giá MỘT lần cho cả 7 ngày thay vì 7 lần.
 *
 * Lưu ý ngữ nghĩa: tờ note nên đọc `exact_qty` (lượng CẦN dùng hôm đó) chứ
 * không phải `qty` (lượng làm tròn theo cách mua). Làm tròn từng ngày rồi cộng
 * lại sẽ vượt xa danh sách tuần — 200 g thịt cho thứ 2 và 200 g cho thứ 3
 * không có nghĩa là phải mua 400 g.
 *
 * @param {Array<{name,grams,unit,dayIndex}>} rows
 * @returns {Promise<Map<number, object>>} day_index → model
 */
export async function computeDailyModels(rows, opts = {}) {
  const { household, servings, baseServings = 1, purchasedIds } = opts;
  const { loadAdminPrices } = await import('./pricing.js');
  const base = Math.max(1, Number(baseServings) || 1);
  const want = Math.max(1, Number(servings) || base);
  const shared = {
    servingsFactor: want / base,
    region: household?.region,
    householdId: household?.id,
    adminPrices: await loadAdminPrices(),
    purchasedIds,
  };

  const byDay = new Map();
  for (const r of rows || []) {
    if (r?.dayIndex == null) continue;
    if (!byDay.has(r.dayIndex)) byDay.set(r.dayIndex, []);
    byDay.get(r.dayIndex).push(r);
  }

  const out = new Map();
  for (const [day, dayRows] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    out.set(day, buildShoppingModel(dayRows, shared));
  }
  return out;
}

/** "2 bó cải xanh" | "cá lóc kho (cần ước lượng)" */
export function formatItemLine(item) {
  if (!item) return '';
  const name = item.name || '';
  if (item.qty == null) return `${name} (cần ước lượng)`;
  return `${formatQty(item.qty)} ${item.unit || ''} ${name}`.replace(/\s+/g, ' ').trim();
}

/** Một dòng text gọn cho clipboard / chia sẻ / mobile. */
export function formatShoppingText(model, sep = ' / ') {
  return (model?.items || []).map(formatItemLine).filter(Boolean).join(sep);
}

/**
 * Bảng tra "đơn giá trên MỘT đơn vị gốc" suy từ model đã dựng.
 *
 * Nhờ nó, chi phí từng bữa/ngày được bổ ra từ CHÍNH con số của danh sách đi chợ
 * (đã gộp trùng, đã làm tròn theo cách mua), nên tổng các bữa luôn khớp tổng
 * danh sách — thay vì tính giá lại lần nữa theo đường khác.
 */
export function buildCostIndex(model) {
  const idx = new Map();
  for (const it of model?.items || []) {
    if (it.line_total == null || !it.base_qty) continue;
    idx.set(it.ingredient_id || `raw:${it.name.toLowerCase()}`, {
      rate: it.line_total / it.base_qty,
      baseUnit: it.base_unit,
    });
  }
  return idx;
}

/**
 * Chi phí của một nhóm dòng nguyên liệu thô, theo bảng tra ở trên.
 * @returns {{cost:number, priced:number, unknown:number}}
 */
export function costOfRows(rows, idx, servingsFactor = 1) {
  let cost = 0;
  let priced = 0;
  let unknown = 0;
  for (const r of rows || []) {
    if (!r?.name) continue;
    const info = resolveIngredient(r.name);
    const hit = idx.get(info.id || `raw:${info.canonical.toLowerCase()}`);
    const base = r.grams == null ? null : toBase((Number(r.grams) || 0) * servingsFactor, r.unit || 'g');
    if (!hit || !base) { unknown += 1; continue; }
    cost += base.qty * hit.rate;
    priced += 1;
  }
  return { cost: Math.round(cost), priced, unknown };
}

/** Danh sách nhóm (kể cả nhóm rỗng) — dùng cho bộ lọc trên UI. */
export function allCategories() {
  return listCategories();
}

export default {
  buildShoppingModel, computeShoppingModel, rescaleShoppingModel,
  formatItemLine, formatShoppingText, allCategories,
  buildCostIndex, costOfRows,
};
