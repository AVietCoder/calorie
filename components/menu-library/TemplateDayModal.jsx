'use client';
/**
 * TemplateDayModal — chi tiết đầy đủ MỘT ngày của thực đơn trong thư viện.
 *
 * Thẻ ngày ngoài trang chi tiết cố tình chỉ liệt kê tên món cho gọn; mọi số
 * liệu dinh dưỡng, giá và nguyên liệu dồn hết vào đây — mở khi bấm vào thẻ.
 *
 * Khác với components/menu-plan/DayDetailModal (kế hoạch đã sinh):
 *   • đọc cây `menu_template_*` chứ không phải `plan_*`
 *   • CHỈ ĐỌC — thư viện là bản mẫu, không có nút đổi món
 * Nên tách riêng thay vì nhồi thêm cờ vào modal của kế hoạch.
 *
 * Dùng lại vỏ .mp-modal (styles/modal.css) và thanh macro (styles/macro-bar.css)
 * để hai nơi trông như một.
 */
import { dayLabel, mealLabel } from '../../lib/excel/labels';
import { macroSplit } from '../menu-plan/DayCard';
import { MEAL_ICON, mealsOf, kcalOf, templateDayTotals } from './template-day-utils';

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const vn = (v) => Number(v).toLocaleString('vi-VN');

/** "Xơ 4g · Đường 6g · Natri 520mg" — bỏ qua trường không có số, KHÔNG điền 0. */
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

export default function TemplateDayModal({ day, onClose, t }) {
  const open = !!day;
  const { calories, protein, fat, carbs, fiber, sugar, sodium } = day
    ? templateDayTotals(day)
    : { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0, sodium: 0 };
  const split = macroSplit({ protein, fat, carbs });
  const meals = day ? mealsOf(day) : [];

  /* Nhiều thực đơn nguồn chỉ liệt kê tên món, không kèm số liệu. Khi đó hiện
     "0 kcal" và một thanh macro xám trơn trông như hỏng — thà nói thẳng là
     chưa có số liệu. */
  const hasNutrition = calories > 0 || protein > 0 || fat > 0 || carbs > 0;

  return (
    <div className={`mp-modal-overlay${open ? ' open' : ''}`} onClick={onClose}>
      <div className="mp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mp-modal-header">
          <h3>{day ? dayLabel(day.day_index, { withDate: false }) : ''}</h3>
          {hasNutrition && <span className="mp-modal-kcal">{vn(Math.round(calories))} kcal</span>}
          <button className="mp-modal-close" onClick={onClose} aria-label={t('common.close', 'Đóng')}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="mp-modal-body">
          {/* Tỉ lệ macro cả ngày */}
          {hasNutrition ? (
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
          ) : (
            <p className="ml-modal-note">
              <i className="fa-solid fa-circle-info" />{' '}
              {t('ml.day_no_nutrition', 'Thực đơn nguồn này chỉ liệt kê món, chưa kèm số liệu dinh dưỡng. Bạn vẫn xem được nguyên liệu của từng món bên dưới.')}
            </p>
          )}

          {/* Vi chất cả ngày — chỉ hiện khi thực sự có số. */}
          {(fiber > 0 || sugar > 0 || sodium > 0) && (
            <div className="ml-day-micros">
              {fiber > 0 && <span><b>{Math.round(fiber)}</b>g {t('mp.fiber', 'Xơ')}</span>}
              {sugar > 0 && <span><b>{Math.round(sugar)}</b>g {t('mp.sugar', 'Đường')}</span>}
              {sodium > 0 && <span><b>{vn(Math.round(sodium))}</b>mg {t('mp.sodium', 'Natri')}</span>}
            </div>
          )}

          {meals.map((meal) => {
            const dishes = meal.menu_template_dishes || [];
            if (!dishes.length) return null;
            const mealKcal = kcalOf(dishes);
            return (
              <div className="mp-meal-block" key={meal.id}>
                <div className="mp-meal-head">
                  <span>
                    <i className={`fa-solid ${MEAL_ICON[meal.meal_type] || 'fa-utensils'}`} />{' '}
                    {mealLabel(meal.meal_type)}
                  </span>
                  {mealKcal > 0 && <b>{vn(Math.round(mealKcal))} kcal</b>}
                </div>

                {dishes.map((dish) => {
                  const micro = microLine(dish, t);
                  const grams = num(dish.base_grams);
                  const dishKcal = num(dish.calories);
                  const ings = dish.menu_template_dish_ingredients || [];
                  return (
                    <div className="mp-dish-row" key={dish.id}>
                      <span className="mp-dish-name">
                        {dish.name}
                        {String(dish.price || '').trim() && (
                          <small className="mp-dish-price">{dish.price}</small>
                        )}
                      </span>

                      {/* Cả thực đơn không có số liệu thì banner phía trên đã nói
                          một lần rồi — lặp lại ở từng món chỉ làm rối. */}
                      {(() => {
                        const meta = [
                          dishKcal != null ? `${Math.round(dishKcal)} kcal` : null,
                          grams != null ? `${Math.round(grams)} g` : null,
                          num(dish.protein) != null ? `${t('mp.protein', 'Đạm')} ${Math.round(dish.protein)}g` : null,
                          num(dish.fat) != null ? `${t('mp.fat', 'Béo')} ${Math.round(dish.fat)}g` : null,
                          num(dish.carbs) != null ? `${t('mp.carbs', 'Bột')} ${Math.round(dish.carbs)}g` : null,
                        ].filter(Boolean).join(' · ');
                        if (meta) return <span className="mp-dish-meta">{meta}</span>;
                        if (!hasNutrition) return null;
                        return <span className="mp-dish-meta">{t('mp.no_nutrition', 'Chưa có số liệu dinh dưỡng')}</span>;
                      })()}

                      {micro && <span className="mp-dish-micro">{micro}</span>}

                      {/* Khoảng giá đi kèm giá trung bình — nguyên văn từ nguồn. */}
                      {String(dish.price_range || '').trim() && (
                        <span className="ml-dish-range">
                          <i className="fa-solid fa-tag" /> {dish.price_range}
                        </span>
                      )}

                      {ings.length > 0 && (
                        <ul className="ml-dish-ings">
                          {ings.map((i) => (
                            <li key={i.id}>
                              {i.name}
                              {i.grams != null && <em> · {vn(i.grams)} {i.unit || 'g'}</em>}
                              {String(i.price || '').trim() && <em> · {i.price}</em>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {!meals.length && <p className="mp-empty">{t('ml.day_empty', 'Chưa có món')}</p>}

          <p className="ml-modal-note">
            <i className="fa-solid fa-circle-info" />{' '}
            {t('ml.day_modal_note', 'Số liệu dinh dưỡng là ước tính cho một suất, lấy từ tài liệu của đơn vị phát hành. Không thay thế chỉ định của bác sĩ.')}
          </p>
        </div>
      </div>
    </div>
  );
}
