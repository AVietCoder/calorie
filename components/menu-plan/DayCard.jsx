'use client';
/**
 * DayCard — một ngày ở dạng THU GỌN.
 *
 * Chỉ hiện tổng calo, macro và vài món tiêu biểu. Toàn bộ chi tiết nằm trong
 * DayDetailModal, để lưới không bị nhồi chữ như bản lưới 7 cột cũ.
 */
import { dayLabel } from '../../lib/excel/labels';

const MAX_CHIPS = 4;

/** Tổng dinh dưỡng + tên món của một ngày. */
export function dayTotals(day) {
  const dishes = (day?.plan_meals || []).flatMap((m) => m.plan_dishes || []);
  const t = { calories: 0, protein: 0, fat: 0, carbs: 0 };
  for (const d of dishes) {
    t.calories += Number(d.calories) || 0;
    t.protein += Number(d.protein) || 0;
    t.fat += Number(d.fat) || 0;
    t.carbs += Number(d.carbs) || 0;
  }
  return { ...t, dishes };
}

/** Tỉ lệ % NĂNG LƯỢNG (P×4, F×9, C×4) — không phải % khối lượng. */
export function macroSplit({ protein, fat, carbs }) {
  const kcal = { p: protein * 4, f: fat * 9, c: carbs * 4 };
  const sum = kcal.p + kcal.f + kcal.c;
  if (!sum) return { p: 0, f: 0, c: 0 };
  return { p: (kcal.p / sum) * 100, f: (kcal.f / sum) * 100, c: (kcal.c / sum) * 100 };
}

export default function DayCard({ day, cost, onOpen, t }) {
  const { calories, protein, fat, carbs, dishes } = dayTotals(day);
  const split = macroSplit({ protein, fat, carbs });
  const named = dishes.map((d) => d.name).filter(Boolean);
  const rest = named.length - MAX_CHIPS;

  /*
   * Mỗi ngày một sắc độ riêng (`data-day` → biến màu trong menu-plan.css).
   * Bảy thẻ giống hệt nhau xếp cạnh nhau rất khó phân biệt và nhìn đơn điệu;
   * đổi tông theo ngày giúp định vị nhanh mà vẫn nằm trong dải màu thương hiệu.
   */
  return (
    <button
      type="button"
      className="mp-day-card"
      data-day={((day.day_index - 1) % 7) + 1}
      onClick={() => onOpen(day)}
    >
      <div className="mp-day-head">
        <span className="mp-day-name">{dayLabel(day.day_index, { withDate: false })}</span>
        <span className="mp-day-kcal">
          {Math.round(calories).toLocaleString('vi-VN')}<small>kcal</small>
        </span>
      </div>

      {cost > 0 && (
        <div className="mp-day-cost">
          <i className="fa-solid fa-coins" /> ≈ {Math.round(cost).toLocaleString('vi-VN')} đ
          <small>{t('mp.per_day', '/ ngày')}</small>
        </div>
      )}

      <div className="mp-macro-track" aria-hidden="true">
        <span className="mp-macro-seg p" style={{ width: `${split.p}%` }} />
        <span className="mp-macro-seg f" style={{ width: `${split.f}%` }} />
        <span className="mp-macro-seg c" style={{ width: `${split.c}%` }} />
      </div>

      <div className="mp-macro-legend">
        <span><i className="dot-p" />{t('mp.protein', 'Đạm')} <b>{Math.round(protein)}g</b></span>
        <span><i className="dot-f" />{t('mp.fat', 'Béo')} <b>{Math.round(fat)}g</b></span>
        <span><i className="dot-c" />{t('mp.carbs', 'Bột')} <b>{Math.round(carbs)}g</b></span>
      </div>

      <div className="mp-day-dishes">
        {named.slice(0, MAX_CHIPS).map((name, i) => (
          <span className="mp-dish-chip" key={i}>{name}</span>
        ))}
        {rest > 0 && <span className="mp-more">+{rest} {t('mp.more_dishes', 'món khác')}</span>}
        {!named.length && <span className="mp-empty">{t('mp.day_empty', 'Chưa có món')}</span>}
      </div>
    </button>
  );
}
