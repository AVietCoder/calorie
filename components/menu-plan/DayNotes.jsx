'use client';
/**
 * DayNotes — mỗi ngày một tờ giấy note "hôm nay đi chợ mua gì".
 *
 * Đặt cạnh danh sách cả tuần: tuần để mua gộp một lần, note để cầm đi chợ theo
 * ngày. Số trên note là lượng CẦN DÙNG hôm đó (exact_qty), không phải lượng làm
 * tròn theo cách mua — cộng 7 tờ note sẽ nhiều hơn danh sách tuần vì tuần đã
 * gộp trùng, đó là đúng chứ không phải lệch.
 *
 * Trạng thái tick nằm ở localStorage theo (scope, ngày): danh sách này có thể
 * là thực đơn CHƯA áp dụng nên không có gì trong DB để ghi vào.
 */
import { useChecklist } from '../../lib-client/useChecklist';
import { dayLabel } from '../../lib/excel/labels';

const money = (v) => `${Math.round(v).toLocaleString('vi-VN')} đ`;

/** "200 g Bắp cải" | "Cà chua" (chưa rõ định lượng) */
function itemLabel(item) {
  if (item.qty == null) return item.name;
  const qty = Number(item.qty).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  return `${qty} ${item.unit || ''} ${item.name}`.replace(/\s+/g, ' ').trim();
}

export default function DayNotes({ days, scope, t }) {
  const { has, toggle } = useChecklist(scope);

  if (!days?.length) return null;

  return (
    <div className="dn-wrap">
      <div className="dn-head">
        <h3>
          <i className="fa-solid fa-note-sticky" /> {t('mp.notes_title', 'Đi chợ theo ngày')}
        </h3>
        <p>{t('mp.notes_sub', 'Mỗi tờ là nguyên liệu cần dùng cho riêng ngày đó — tiện cầm đi chợ hằng ngày.')}</p>
      </div>

      <div className="dn-grid">
        {days.map((d) => {
          const done = d.items.filter((i, idx) => has(`${d.day_index}:${i.ingredient_id || idx}`)).length;
          return (
            <div className="dn-note" key={d.day_index}>
              <span className="dn-tape" aria-hidden="true" />
              <div className="dn-note-head">
                <b>{dayLabel(d.day_index, { withDate: false })}</b>
                <span className="dn-progress">{done}/{d.items.length}</span>
              </div>

              <ul className="dn-list">
                {d.items.map((i, idx) => {
                  const key = `${d.day_index}:${i.ingredient_id || idx}`;
                  const on = has(key);
                  return (
                    <li key={key} className={on ? 'done' : undefined}>
                      <label>
                        <input type="checkbox" checked={on} onChange={() => toggle(key)} />
                        <span>{itemLabel(i)}</span>
                      </label>
                      {i.needs_estimate && (
                        <em title={t('mp.need_estimate_hint', 'Thực đơn nguồn chưa khai định lượng cho món này')}>
                          {t('mp.need_estimate', 'cần ước lượng')}
                        </em>
                      )}
                    </li>
                  );
                })}
                {!d.items.length && <li className="dn-empty">{t('mp.day_empty', 'Chưa có món')}</li>}
              </ul>

              {d.est_cost > 0 && (
                <div className="dn-foot">
                  <i className="fa-solid fa-coins" /> ≈ {money(d.est_cost)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
