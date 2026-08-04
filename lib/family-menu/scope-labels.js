/**
 * lib/family-menu/scope-labels.js — nhãn "phạm vi" của thực đơn theo CHẾ ĐỘ hộ.
 *
 * Giá trị lưu trong DB không đổi ('public' | 'private') — chỉ chữ hiển thị đổi.
 * Ở chế độ đầu bếp, người dùng quản lý hồ sơ cho một TỔ CHỨC (nhà hàng, bếp ăn,
 * trung tâm dưỡng lão) chứ không phải gia đình, nên "Chỉ gia đình tôi" vừa sai
 * nghĩa vừa gây bối rối.
 *
 * Gom vào một chỗ vì cùng cặp nhãn này xuất hiện ở ba nơi (form tải Excel, hộp
 * nhập tay, hộp sửa thực đơn) — để rời rạc thì sửa một chỗ quên hai chỗ.
 */

/**
 * @param {string} mode  household.mode — 'family' | 'chef'
 * @param {(key: string, fallback: string) => string} t
 * @returns {{ value: string, label: string }[]}
 */
export function scopeOptions(mode, t) {
  const isChef = mode === 'chef';
  return [
    { value: 'public', label: t('ml.scope_public', 'Công khai (mặc định)') },
    {
      value: 'private',
      label: isChef
        ? t('ml.scope_private_org', 'Chỉ tổ chức của tôi')
        : t('ml.scope_private', 'Chỉ gia đình tôi'),
    },
  ];
}

export default { scopeOptions };
