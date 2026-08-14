'use client';
/**
 * DishName — tên món với phần ĐỊNH LƯỢNG in đậm.
 *
 *   "200 g cháo yến mạch nấu tôm"  →  **200 g** cháo yến mạch nấu tôm
 *   "1 quả táo và 10 g bơ đậu phộng" → **1 quả** táo và **10 g** bơ đậu phộng
 *
 * Người dùng quét mắt tìm khẩu phần trước rồi mới đọc tên món; in đậm giúp thấy
 * ngay thay vì phải đọc hết cả dòng.
 *
 * File RIÊNG (không nằm trong TemplateDetail) vì cả TemplateDetail lẫn
 * TemplateDayModal đều dùng — để ở TemplateDetail sẽ tạo vòng phụ thuộc
 * TemplateDetail → Modal → TemplateDetail.
 *
 * Việc tách chuỗi nằm ở splitAmounts() (thuần, test được bằng node); ở đây chỉ
 * bọc thẻ.
 */
import { splitAmounts } from './template-day-utils';

export default function DishName({ name }) {
  return splitAmounts(name).map((part, i) => (
    part.amount
      ? <b className="ml-amount" key={i}>{part.text}</b>
      : <span key={i}>{part.text}</span>
  ));
}
