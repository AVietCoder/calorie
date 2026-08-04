/**
 * lib/family-menu/source-logos.js — logo của ĐƠN VỊ phát hành thực đơn.
 *
 * Thực đơn hệ thống được trích từ tài liệu công bố của bệnh viện / nhà thuốc /
 * trung tâm dinh dưỡng. Trước đây thẻ nào cũng chỉ hiện một icon danh mục nên
 * nhìn giống hệt nhau; gắn logo nguồn giúp phân biệt và ghi nhận đúng đơn vị.
 *
 * Ảnh nằm ở public/menu-logos/ (đồng bộ từ thư mục logo/ ở gốc dự án).
 *
 * Khớp theo TÊN NGUỒN, tức phần còn lại của tên file sau khi bỏ tiền tố [BỆNH]:
 *   "[TIỂU ĐƯỜNG] Medlatec_formatted.xlsx" → nguồn "Medlatec" → medlatec.png
 * Cùng quy tắc mà scripts/seed-reference-menus.mjs dùng để đặt tiêu đề, nên chỉ
 * cần lưu `source_name` là tra được logo.
 */

const DIR = '/menu-logos';

/**
 * Khoá đã chuẩn hoá (bỏ dấu, thường hoá) → tên file.
 *
 * Chỉ liệt kê các trường hợp KHÔNG suy ra được từ tên: hoặc tên file logo khác
 * hẳn tên nguồn, hoặc nhiều nguồn dùng chung một logo.
 */
const ALIASES = {
  // Mọi trạm/trung tâm y tế phường–quận đều thuộc Sở Y tế TP.HCM, dùng chung
  // một logo (xác nhận từ phía biên tập nội dung).
  'so y te tphcm': 'soytetphcm.jpg',

  'bao lao dong': 'lao-dong.png',
  'lao dong': 'lao-dong.png',
  'gia dinh': 'benh-vien-da-khoa-gia-dinh.png',
  'duc giang': 'benh-vien-da-khoa-duc-giang.jpg',
  'thu cuc': 'benh-vien-da-khoa-quoc-te-thu-cuc.jpg',
  'benh vien 22 12': '22-12.png',
  'h h nutritrion': 'h-h-nutritrion.jpg',
  'hh nutritrion': 'h-h-nutritrion.jpg',
  'he thong duong lao binh my': 'he-thong-duong-lao-binh-my.png',
  'van phuoc cuu long': 'van-phuoc-cuu-long.png',
  'msc clinic': 'msc-clinic.webp',
  'tiem chung long chau': 'long-chau.png',
  'long chau': 'long-chau.png',
  'tam anh': 'tam-anh.jpg',
  'kim duc': 'kim-duc.png',
};

/** Tên file logo đứng một mình (khớp trực tiếp theo tên nguồn đã chuẩn hoá). */
const DIRECT = [
  'bookingcare.png', 'mamacare.jpg', 'mediplus.png', 'medlatec.png', 'nerci.png',
  'nutricare.jpg', 'nutrihome.jpg', 'tradimec.jpg', 'vinmec.jpg', 'vnexpress.jpg',
  'vov.webp', 'soytetphcm.jpg',
];

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const DIRECT_MAP = Object.fromEntries(
  DIRECT.map((f) => [norm(f.replace(/\.[a-z]+$/i, '')), f])
);

/**
 * Logo của một nguồn, hoặc null nếu chưa có ảnh.
 *
 * Trả null (thay vì một ảnh mặc định) để nơi gọi tự lùi về icon danh mục —
 * một logo sai còn tệ hơn không có logo, vì nó gán nhầm tài liệu cho đơn vị.
 *
 * @param {string} source  tên đơn vị, vd "Medlatec", "Trạm y tế phường Sơn Kỳ"
 * @returns {string|null}  đường dẫn public, vd "/menu-logos/medlatec.png"
 */
export function sourceLogo(source) {
  const key = norm(source);
  if (!key) return null;

  // Trạm/trung tâm y tế phường–quận: bắt theo mẫu chứ không liệt kê từng phường.
  if (/\b(tram|trung tam) y te\b/.test(key)) return `${DIR}/${ALIASES['so y te tphcm']}`;

  if (ALIASES[key]) return `${DIR}/${ALIASES[key]}`;
  if (DIRECT_MAP[key]) return `${DIR}/${DIRECT_MAP[key]}`;

  // Khớp lỏng: tên nguồn chứa trọn khoá (vd "Nutrihome Hà Nội" → nutrihome).
  // Yêu cầu khoá dài ≥ 5 ký tự để "tam anh" không nuốt "Tâm Đức".
  for (const [k, file] of Object.entries({ ...ALIASES, ...DIRECT_MAP })) {
    if (k.length >= 5 && (key === k || key.startsWith(`${k} `) || key.endsWith(` ${k}`))) {
      return `${DIR}/${file}`;
    }
  }
  return null;
}

export default { sourceLogo };
