/**
 * menu-permissions.js — ai được sửa/xoá một thực đơn trong thư viện (Ảnh 3).
 *
 * Tồn tại vì công thức này cần dùng ở HAI nơi: cờ `can_edit` mà API trả cho
 * thư viện (để ẩn/hiện nút Sửa) và cổng chặn requireTemplateEditAccess ở phía
 * ghi. Để hai bản rời nhau thì sớm muộn UI cho bấm mà server từ chối — hoặc tệ
 * hơn, ngược lại. Thuần, không I/O, test được.
 */

/** Vì sao KHÔNG sửa được — dùng làm thông báo lỗi, null nghĩa là được phép. */
export const DENY_SYSTEM = 'system';
export const DENY_NOT_OWNER = 'not_owner';

/**
 * @param {{ is_system?: boolean, created_by?: string|null }} template
 * @param {{ userId: string, isAdmin?: boolean }} actor
 * @returns {null | 'system' | 'not_owner'}  null = được phép
 */
export function templateEditDenial(template, { userId, isAdmin = false } = {}) {
  if (isAdmin) return null;                              // admin sửa được mọi thực đơn
  if (template?.is_system) return DENY_SYSTEM;           // thực đơn hệ thống: chỉ admin
  if (!template?.created_by || template.created_by !== userId) return DENY_NOT_OWNER;
  return null;
}

/** Dạng boolean cho UI. */
export function canEditTemplate(template, actor) {
  return templateEditDenial(template, actor) === null;
}

export const DENY_MESSAGES = {
  [DENY_SYSTEM]: 'Thực đơn hệ thống chỉ quản trị viên mới được sửa hoặc xoá.',
  [DENY_NOT_OWNER]: 'Bạn chỉ có thể sửa hoặc xoá thực đơn do chính mình tạo.',
};
