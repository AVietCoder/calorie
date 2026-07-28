/**
 * lib/excel/templates/index.js — REGISTRY.
 *
 * Thêm một loại báo cáo mới = viết một hàm `(model) => SheetSpec` rồi đăng ký ở
 * đây. Không phải sửa renderer, không phải sửa API, không phải sửa UI.
 *
 * Mỗi entry khai báo:
 *   build(model)  → SheetSpec
 *   enabled?(model) → bỏ sheet khi không có dữ liệu (vd chưa khai nguyên liệu)
 */
import { weeklyMenuSheet } from './weekly-menu.js';
import { nutritionSheet } from './nutrition.js';
import { shoppingListSheet } from './shopping-list.js';
import { summarySheet } from './summary.js';
import { importTemplateSheet, importGuideSheet } from './import-template.js';

export const SHEET_TEMPLATES = {
  menu: {
    id: 'menu',
    label: 'Thực đơn',
    order: 1,
    build: weeklyMenuSheet,
    enabled: (m) => (m.days?.length || 0) > 0,
  },
  nutrition: {
    id: 'nutrition',
    label: 'Thông tin dinh dưỡng',
    order: 2,
    build: nutritionSheet,
    enabled: (m) => (m.dishes?.length || 0) > 0,
  },
  shopping: {
    id: 'shopping',
    label: 'Danh sách đi chợ',
    order: 3,
    build: shoppingListSheet,
    enabled: (m) => (m.shopping?.items?.length || 0) > 0,
  },
  summary: {
    id: 'summary',
    label: 'Tổng hợp',
    order: 4,
    build: summarySheet,
    enabled: () => true,
  },
};

/** Template độc lập, không cần export model (dùng cho file mẫu tải về). */
export const STANDALONE_TEMPLATES = {
  importTemplate: { id: 'importTemplate', label: 'Mẫu nhập liệu', build: importTemplateSheet },
  importGuide: { id: 'importGuide', label: 'Hướng dẫn', build: importGuideSheet },
};

/**
 * Chọn các sheet sẽ dựng.
 * @param {object} model
 * @param {string[]} [only]  danh sách id muốn xuất; bỏ trống = tất cả
 */
export function selectSheets(model, only) {
  const wanted = only?.length ? only : Object.keys(SHEET_TEMPLATES);
  return wanted
    .map((id) => SHEET_TEMPLATES[id])
    .filter(Boolean)
    .filter((t) => (t.enabled ? t.enabled(model) : true))
    .sort((a, b) => a.order - b.order);
}

export default { SHEET_TEMPLATES, STANDALONE_TEMPLATES, selectSheets };
