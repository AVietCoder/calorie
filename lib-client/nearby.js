'use client';
/**
 * lib-client/nearby.js — mở Google Maps quanh vị trí hiện tại.
 *
 * Port nguyên văn từ searchFoodNearby() vốn nằm trong app/schedule/page.jsx, để
 * cả trang Kế hoạch lẫn Danh sách đi chợ dùng chung một hành vi.
 *
 * Chỉ là DEEP LINK: không API key (dự án không có key Maps/Places nào), không
 * gọi server, không dùng AI đoán địa điểm — kết quả là dữ liệu thật của Google.
 */

/**
 * @param {string} query    ví dụ "siêu thị gần đây"
 * @param {object} [opts]
 * @param {number} [opts.zoom=15]
 */
export function openNearbySearch(query, { zoom = 15 } = {}) {
  const q = encodeURIComponent(String(query || '').trim());
  if (!q) return;

  const openPlain = () => window.open(`https://www.google.com/search?q=${q}`, '_blank');

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    openPlain();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      window.open(`https://www.google.com/maps/search/${q}/@${lat},${lng},${zoom}z`, '_blank');
    },
    // Từ chối quyền vị trí → vẫn tìm được, chỉ là không có toạ độ.
    openPlain
  );
}

/** Các loại điểm bán để gợi ý sau khi dựng xong danh sách đi chợ. */
export const SHOP_KINDS = [
  { key: 'sieu_thi', icon: 'fa-store', query: 'siêu thị', tkey: 'mp.shop_supermarket', label: 'Siêu thị' },
  { key: 'cho', icon: 'fa-shop', query: 'chợ', tkey: 'mp.shop_market', label: 'Chợ truyền thống' },
  { key: 'ttm', icon: 'fa-building-columns', query: 'trung tâm thương mại', tkey: 'mp.shop_mall', label: 'Trung tâm thương mại' },
];

export default { openNearbySearch, SHOP_KINDS };
