/**
 * lib/family-menu/menu-categories.js — danh mục thư viện thực đơn.
 *
 * Ảnh bìa KHÔNG phải file ảnh: mỗi danh mục là một gradient + icon dựng bằng
 * CSS, nên không tốn dung lượng, không phụ thuộc CDN, và 38 thực đơn seed đều
 * có bìa ngay. Admin vẫn upload `image_url` để đè lên khi cần.
 *
 * Dùng chung cho cả server (seed, API) lẫn client (thẻ thư viện) — không import
 * gì ngoài chính nó.
 */

export const MENU_CATEGORIES = [
  { id: 'tieu_duong', label: 'Tiểu đường', icon: 'fa-droplet', from: '#5b9cf6', to: '#3b6fd4' },
  { id: 'gout', label: 'Gout', icon: 'fa-bone', from: '#a78bfa', to: '#7c5cd6' },
  { id: 'gan_nhiem_mo', label: 'Gan nhiễm mỡ', icon: 'fa-shield-heart', from: '#f5a623', to: '#d97706' },
  { id: 'huyet_ap', label: 'Huyết áp cao', icon: 'fa-heart-pulse', from: '#f2617a', to: '#d63f5c' },
  { id: 'mo_mau', label: 'Mỡ máu cao', icon: 'fa-wave-square', from: '#f97362', to: '#dc4a37' },
  { id: 'giam_can', label: 'Giảm cân', icon: 'fa-arrow-trend-down', from: '#4bc0a8', to: '#2a9d8f' },
  { id: 'tang_co', label: 'Tăng cơ', icon: 'fa-dumbbell', from: '#6b8cff', to: '#4257c4' },
  { id: 'eat_clean', label: 'Eat clean', icon: 'fa-leaf', from: '#7dc976', to: '#4a9d5f' },
  { id: 'gia_dinh', label: 'Gia đình Việt', icon: 'fa-people-roof', from: '#58a677', to: '#3d7353' },
  { id: 'van_phong', label: 'Văn phòng', icon: 'fa-briefcase', from: '#8d99ae', to: '#5c6779' },
  { id: 'hoc_sinh', label: 'Học sinh, sinh viên', icon: 'fa-graduation-cap', from: '#ffb703', to: '#e08700' },
  { id: 'it_tinh_bot', label: 'Ít tinh bột', icon: 'fa-wheat-awn-circle-exclamation', from: '#c084fc', to: '#9333ea' },
  { id: 'khac', label: 'Khác', icon: 'fa-utensils', from: '#9aa39e', to: '#6b7280' },
];

const BY_ID = new Map(MENU_CATEGORIES.map((c) => [c.id, c]));

/** Tiền tố [BỆNH] trong tên file reference-menus → id danh mục. */
const PREFIX_TO_ID = {
  'TIỂU ĐƯỜNG': 'tieu_duong',
  GOUT: 'gout',
  'GAN NHIỄM MỠ': 'gan_nhiem_mo',
  'CAO HUYẾT ÁP': 'huyet_ap',
  'MỠ MÁU CAO': 'mo_mau',
};

/** Từ khoá dự phòng khi tên file không có tiền tố [BỆNH]. */
const KEYWORDS = [
  ['gan nhiem mo', 'gan_nhiem_mo'],
  ['tieu duong', 'tieu_duong'],
  ['huyet ap', 'huyet_ap'],
  ['mo mau', 'mo_mau'],
  ['giam can', 'giam_can'],
  ['tang co', 'tang_co'],
  ['eat clean', 'eat_clean'],
  ['van phong', 'van_phong'],
  ['hoc sinh', 'hoc_sinh'],
  ['sinh vien', 'hoc_sinh'],
  ['low carb', 'it_tinh_bot'],
  ['it tinh bot', 'it_tinh_bot'],
  ['gia dinh', 'gia_dinh'],
  ['gout', 'gout'],
];

export function getCategory(id) {
  return BY_ID.get(id) || BY_ID.get('khac');
}

/**
 * Bỏ dấu + đưa mọi dấu phân cách về khoảng trắng.
 *
 * Phải chuẩn hoá `_` và `-`: tên file kiểu "20_thuc_don_bua_chinh_gan_nhiem_mo"
 * sẽ không khớp từ khoá "gan nhiem mo" nếu giữ nguyên gạch dưới.
 */
const deaccent = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Suy danh mục từ tên file / tiêu đề. Không đoán được thì trả 'khac'. */
export function categoryFromName(name) {
  const raw = String(name || '');
  const prefix = raw.match(/^\[([^\]]+)\]/);
  if (prefix) {
    const id = PREFIX_TO_ID[prefix[1].trim().toUpperCase()];
    if (id) return id;
  }
  const flat = deaccent(raw);
  for (const [kw, id] of KEYWORDS) if (flat.includes(kw)) return id;
  return 'khac';
}

export default { MENU_CATEGORIES, getCategory, categoryFromName };
