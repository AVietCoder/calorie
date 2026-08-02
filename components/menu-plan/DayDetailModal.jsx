'use client';
/**
 * DayDetailModal — toàn bộ chi tiết một ngày.
 *
 * Đây là nơi chứa những gì trước kia bị đổ hết ra lưới: từng bữa, từng món kèm
 * calo/macro và vi chất. Vi chất CHỈ hiện khi có số thật — không zero-fill.
 */
import { dayLabel, mealLabel, MEAL_ORDER } from '../../lib/excel/labels';
import { dayTotals, macroSplit } from './DayCard';

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** "Xơ 4g · Đường 6g · Natri 520mg" — bỏ qua trường không có số. */
function microLine(dish, t) {
  const bits = [];
  const fiber = num(dish.fiber);
  const sugar = num(dish.sugar);
  const sodium = num(dish.sodium);
  if (fiber != null) bits.push(`${t('mp.fiber', 'Xơ')} ${Math.round(fiber)}g`);
  if (sugar != null) bits.push(`${t('mp.sugar', 'Đường')} ${Math.round(sugar)}g`);
  if (sodium != null) bits.push(`${t('mp.sodium', 'Natri')} ${Math.round(sodium)}mg`);
  return bits.join(' · ');
}

const money = (v) => `≈ ${Math.round(v).toLocaleString('vi-VN')} đ`;

export default function DayDetailModal({ day, auditByDish, cost, readOnly, onClose, onSwapDish, t }) {
  const open = !!day;
  const { calories, protein, fat, carbs } = day ? dayTotals(day) : { calories: 0, protein: 0, fat: 0, carbs: 0 };
  const split = macroSplit({ protein, fat, carbs });

  const meals = [...(day?.plan_meals || [])].sort(
    (a, b) => (MEAL_ORDER[a.meal_type] || 99) - (MEAL_ORDER[b.meal_type] || 99)
  );

  return (
    <div className={`mp-modal-overlay${open ? ' open' : ''}`} onClick={onClose}>
      <div className="mp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mp-modal-header">
          <h3>{day ? dayLabel(day.day_index, { withDate: false }) : ''}</h3>
          <span className="mp-modal-kcal">
            {Math.round(calories).toLocaleString('vi-VN')} kcal
            {cost?.byDay?.[day?.day_index] > 0 && (
              <span className="mp-meal-cost"> · {money(cost.byDay[day.day_index])}</span>
            )}
          </span>
          <button className="mp-modal-close" onClick={onClose} aria-label={t('common.close', 'Đóng')}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="mp-modal-body">
          <div>
            <div className="mp-macro-track" aria-hidden="true">
              <span className="mp-macro-seg p" style={{ width: `${split.p}%` }} />
              <span className="mp-macro-seg f" style={{ width: `${split.f}%` }} />
              <span className="mp-macro-seg c" style={{ width: `${split.c}%` }} />
            </div>
            <div className="mp-macro-legend" style={{ marginTop: 8 }}>
              <span><i className="dot-p" />{t('mp.protein', 'Đạm')} <b>{Math.round(protein)}g</b></span>
              <span><i className="dot-f" />{t('mp.fat', 'Béo')} <b>{Math.round(fat)}g</b></span>
              <span><i className="dot-c" />{t('mp.carbs', 'Bột')} <b>{Math.round(carbs)}g</b></span>
            </div>
          </div>

          {meals.map((meal) => {
            const dishes = meal.plan_dishes || [];
            const kcal = dishes.reduce((s, d) => s + (Number(d.calories) || 0), 0);
            return (
              <div className="mp-meal-block" key={meal.id || meal.meal_type}>
                <div className="mp-meal-head">
                  <span>{mealLabel(meal.meal_type)}</span>
                  <b>
                    {Math.round(kcal).toLocaleString('vi-VN')} kcal
                    {cost?.byMeal?.[`${day.day_index}:${meal.meal_type}`] > 0 && (
                      <span className="mp-meal-cost"> · {money(cost.byMeal[`${day.day_index}:${meal.meal_type}`])}</span>
                    )}
                  </b>
                </div>

                {dishes.map((dish) => {
                  const audits = auditByDish?.get(dish.id) || [];
                  const micro = microLine(dish, t);
                  const grams = num(dish.grams);
                  const dishKcal = num(dish.calories);
                  return (
                    <div className={`mp-dish-row${audits.length ? ' has-audit' : ''}`} key={dish.id}>
                      <span className="mp-dish-name">
                        {dish.name}
                        {/* Giá tiền theo món (nhập từ Excel) — in nguyên văn.
                            Khác với chi phí đi chợ ở ShoppingPanel: cái đó tính
                            từ bảng giá nguyên liệu, cái này là giá người nhập. */}
                        {String(dish.price || '').trim() && (
                          <small className="mp-dish-price">{dish.price}</small>
                        )}
                      </span>
                      <span className="mp-dish-meta">
                        {[
                          dishKcal != null ? `${Math.round(dishKcal)} kcal` : null,
                          grams != null ? `${Math.round(grams)} g` : null,
                          num(dish.protein) != null ? `${t('mp.protein', 'Đạm')} ${Math.round(dish.protein)}g` : null,
                        ].filter(Boolean).join(' · ') || t('mp.no_nutrition', 'Chưa có số liệu dinh dưỡng')}
                      </span>
                      {micro && <span className="mp-dish-micro">{micro}</span>}

                      {audits.map((a, i) => (
                        <span className="mp-audit-note" key={i}>
                          <i className="fa-solid fa-triangle-exclamation" /> {a.reason}
                        </span>
                      ))}

                      {!readOnly && (
                        <div className="mp-dish-actions">
                          <button type="button" onClick={() => onSwapDish(dish)}>
                            <i className="fa-solid fa-shuffle" /> {t('mp.swap', 'Đổi món')}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {!dishes.length && <span className="mp-empty">{t('mp.day_empty', 'Chưa có món')}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
