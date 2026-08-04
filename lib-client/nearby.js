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
/**
 * Trả về Promise resolve khi đã mở xong tab.
 *
 * Việc lấy toạ độ (getCurrentPosition) mất từ vài trăm ms tới vài giây — trình
 * duyệt còn phải hỏi quyền lần đầu. Trước đây hàm này chạy rồi quên nên nút bấm
 * xong không phản hồi gì, người dùng tưởng hỏng và bấm lại. Promise cho phép
 * ActionButton hiện spinner đúng khoảng chờ đó.
 *
 * `timeout`/`maximumAge` để không treo vô hạn khi thiết bị không định vị được:
 * hết giờ thì lùi về tìm kiếm không toạ độ, vẫn ra kết quả.
 */
export function openNearbySearch(query, { zoom = 15 } = {}) {
  const q = encodeURIComponent(String(query || '').trim());
  if (!q) return Promise.resolve();

  const openPlain = () => window.open(`https://www.google.com/search?q=${q}`, '_blank');

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    openPlain();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        window.open(`https://www.google.com/maps/search/${q}/@${lat},${lng},${zoom}z`, '_blank');
        resolve();
      },
      // Từ chối quyền vị trí / hết giờ → vẫn tìm được, chỉ là không có toạ độ.
      () => { openPlain(); resolve(); },
      { timeout: 8000, maximumAge: 60_000 }
    );
  });
}

/** Các loại điểm bán để gợi ý sau khi dựng xong danh sách đi chợ. */
export const SHOP_KINDS = [
  { key: 'sieu_thi', icon: 'fa-store', query: 'siêu thị', tkey: 'mp.shop_supermarket', label: 'Siêu thị' },
  { key: 'cho', icon: 'fa-shop', query: 'chợ', tkey: 'mp.shop_market', label: 'Chợ truyền thống' },
  { key: 'ttm', icon: 'fa-building-columns', query: 'trung tâm thương mại', tkey: 'mp.shop_mall', label: 'Trung tâm thương mại' },
];

export default { openNearbySearch, SHOP_KINDS };
