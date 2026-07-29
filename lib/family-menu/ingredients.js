/**
 * lib/family-menu/ingredients.js — Ingredient Dictionary.
 *
 * Giải bài toán "ba rọi" / "thịt ba chỉ" / "ba chỉ heo" là CÙNG một nguyên
 * liệu. Không có lớp này, danh sách đi chợ sẽ có 3 dòng thịt ba chỉ riêng biệt
 * và không dòng nào tra được giá.
 *
 * Từ điển nằm ở knowledge/ingredient-catalog.json — thêm nguyên liệu mới KHÔNG
 * cần sửa code. Module chỉ dựng index (alias → item) một lần rồi cache.
 *
 * Thuật toán khớp, theo thứ tự ưu tiên:
 *   1. khớp chính xác tên đã chuẩn hoá (bỏ dấu, bỏ lượng, bỏ cách chế biến)
 *   2. khớp alias
 *   3. khớp cụm dài nhất (alias là chuỗi con của tên) — "30 g tôm tươi" → tom
 *   4. khớp từ khoá phân nhóm → chỉ ra được category, không ra item
 *   5. không khớp → category 'khac', giữ nguyên tên gốc
 */
import catalog from '../../knowledge/ingredient-catalog.json' with { type: 'json' };

/** id nguyên liệu → các cụm khiến KHÔNG được khớp sang id đó (xem isBlocked). */
const BLOCK_PHRASES = Object.fromEntries(
  Object.entries(catalog.blockPhrases || {})
    .filter(([k]) => !k.startsWith('_'))
    .map(([id, list]) => [id, (list || []).map((s) => normalizeName(s))])
);

/* ───────────────────────── chuẩn hoá chuỗi ───────────────────────── */

export function deaccent(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bỏ phần định lượng và cách chế biến để lộ ra tên nguyên liệu thật. */
const COOKING_WORDS = [
  'luoc', 'hap', 'kho', 'xao', 'chien', 'ran', 'nuong', 'ham', 'nau', 'canh',
  'tuoi', 'song', 'bam', 'thai', 'xay', 'cat', 'phi le', 'phile', 'ap chao',
  'sot', 'muoi chua', 'don lo', 'dut lo', 'cuon', 'tron', 'goi',
];

export function normalizeName(raw) {
  let s = deaccent(raw);
  // bỏ số lượng đứng đầu/cuối: "30 g tom tuoi", "tom 200g", "1 2 bia dau hu"
  s = s.replace(/\b\d+([.,]\d+)?\s*(g|gam|gram|kg|ml|l|lit|qua|trai|cu|bo|mo|hop|chai|goi|lon|vi|bia|con|mieng|lat|nhanh|tep|to|bat|chen|muong|thia)?\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Bản rút gọn hơn nữa: bỏ cả động từ chế biến. Dùng cho vòng khớp thứ 3. */
export function coreName(raw) {
  let s = normalizeName(raw);
  for (const w of COOKING_WORDS) s = s.replace(new RegExp(`\\b${w}\\b`, 'g'), ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/* ───────────────────────── index (dựng 1 lần) ───────────────────────── */

let _index = null;

function buildIndex() {
  const byId = new Map();
  const byAlias = new Map();
  const aliasList = []; // [{ key, item }] sắp xếp giảm dần theo độ dài để khớp cụm dài nhất

  for (const item of catalog.items || []) {
    byId.set(item.id, item);
    const keys = [item.canonical, ...(item.aliases || [])];
    for (const k of keys) {
      const norm = normalizeName(k);
      if (!norm) continue;
      if (!byAlias.has(norm)) byAlias.set(norm, item);
      aliasList.push({ key: norm, item });
    }
  }
  aliasList.sort((a, b) => b.key.length - a.key.length);

  const categoryKeywords = Object.entries(catalog.categoryKeywords || {})
    .filter(([k]) => !k.startsWith('_'))
    .map(([cat, words]) => ({ cat, words: words.map(deaccent).sort((a, b) => b.length - a.length) }));

  const categories = new Map((catalog.categories || []).map((c) => [c.key, c]));

  _index = { byId, byAlias, aliasList, categoryKeywords, categories };
  return _index;
}

function index() {
  return _index || buildIndex();
}

/* ───────────────────────── API ───────────────────────── */

/**
 * Tra một tên nguyên liệu thô về dạng chuẩn.
 * @returns {{
 *   id: string|null, canonical: string, category: string, categoryLabel: string,
 *   family: string, purchaseUnit: string|null, gramsPerUnit: number|null,
 *   roundTo: number|null, packSize: number|null, packUnit: string|null,
 *   matched: 'exact'|'alias'|'substring'|'keyword'|'none'
 * }}
 */
export function resolveIngredient(rawName) {
  const idx = index();
  const norm = normalizeName(rawName);
  const core = coreName(rawName);

  let item = idx.byAlias.get(norm) || null;
  let matched = item ? 'exact' : null;

  if (!item && core && core !== norm) {
    item = idx.byAlias.get(core) || null;
    if (item) matched = 'alias';
  }

  if (!item) {
    // khớp cụm dài nhất — alias phải là một TỪ trọn vẹn trong tên
    for (const { key, item: cand } of idx.aliasList) {
      if (key.length < 3) continue;
      if (isBlocked(cand.id, norm)) continue;
      if (containsWord(norm, key) || containsWord(core, key)) {
        item = cand;
        matched = 'substring';
        break;
      }
    }
  }

  if (item) {
    const cat = idx.categories.get(item.category);
    return {
      id: item.id,
      canonical: item.canonical,
      category: item.category,
      categoryLabel: cat?.label || 'Khác',
      categoryOrder: cat?.order ?? 99,
      family: item.family || 'mass',
      purchaseUnit: item.purchaseUnit || null,
      gramsPerUnit: item.gramsPerUnit || null,
      roundTo: item.roundTo ?? null,
      packSize: item.packSize || null,
      packUnit: item.packUnit || null,
      matched,
    };
  }

  // fallback: chỉ đoán được nhóm
  const catKey = guessCategory(norm) || 'khac';
  const cat = idx.categories.get(catKey);
  return {
    id: null,
    canonical: titleCase(String(rawName || '').trim()) || 'Nguyên liệu',
    category: catKey,
    categoryLabel: cat?.label || 'Khác',
    categoryOrder: cat?.order ?? 99,
    family: 'mass',
    purchaseUnit: null,
    gramsPerUnit: null,
    roundTo: null,
    packSize: null,
    packUnit: null,
    matched: catKey === 'khac' ? 'none' : 'keyword',
  };
}

/** Viết hoa chữ cái đầu, giữ nguyên phần còn lại (tên riêng/viết tắt không bị phá). */
function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Chặn khớp nhầm theo ngữ cảnh, khai trong catalog `blockPhrases`.
 *
 * "Sữa dành riêng cho người tiểu đường" chứa từ "đường" nên khớp cụm sẽ trả về
 * nguyên liệu Đường — tức là đưa đường vào danh sách đi chợ của người tiểu đường.
 * Đây là dữ liệu, không phải code: thêm cụm chặn = sửa JSON.
 */
function isBlocked(itemId, normName) {
  const phrases = BLOCK_PHRASES[itemId];
  if (!phrases || !normName) return false;
  return phrases.some((p) => normName.includes(p));
}

function containsWord(haystack, needle) {
  if (!haystack || !needle) return false;
  const i = haystack.indexOf(needle);
  if (i === -1) return false;
  const before = i === 0 ? ' ' : haystack[i - 1];
  const after = i + needle.length >= haystack.length ? ' ' : haystack[i + needle.length];
  return before === ' ' && after === ' ';
}

export function guessCategory(normName) {
  for (const { cat, words } of index().categoryKeywords) {
    for (const w of words) {
      if (w.length >= 2 && normName.includes(w)) return cat;
    }
  }
  return null;
}

/** Danh sách nhóm theo thứ tự hiển thị. */
export function listCategories() {
  return [...index().categories.values()].sort((a, b) => a.order - b.order);
}

/** Gợi ý nguyên liệu thay thế tương đương (trả về tên hiển thị). */
export function substitutesFor(itemId) {
  if (!itemId) return [];
  const ids = catalog.substitutes?.[itemId] || [];
  return ids.map((id) => index().byId.get(id)?.canonical).filter(Boolean);
}

export function getItem(id) {
  return index().byId.get(id) || null;
}

export const CATALOG_VERSION = catalog._version || 0;

export default { resolveIngredient, normalizeName, coreName, deaccent, listCategories, substitutesFor, getItem };
