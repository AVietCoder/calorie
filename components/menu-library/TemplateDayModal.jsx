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
import { analyseIngredients } from '../../lib/family-menu/ingredient-analysis';
import DishName from './DishName';

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const vn = (v) => Number(v).toLocaleString('vi-VN');

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const hasNum = (i) => i.grams != null || String(i.price || '').trim();

/**
 * Nguyên liệu ĐÁNG hiển thị.
 *
 * Bộ nhập tự do sinh một "nguyên liệu giả" trùng y hệt tên món cho những món
 * không khai định lượng ("Sữa đậu nành không đường" → nguyên liệu "Sữa đậu nành
 * không đường", không số nào). Hiện nó ra là lặp lại tên món kèm một hàng toàn
 * dấu "—" — nhiễu thuần tuý, không thêm thông tin gì.
 */
function usefulIngredients(dish) {
  const list = dish.menu_template_dish_ingredients || [];
  return list.filter((i) => hasNum(i) || !same(i.name, dish.name));
}

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

  /* Phân tích nguyên liệu cả ngày. Macro trả lời "bao nhiêu đạm/béo/bột", còn
     cái này trả lời "ăn những NHÓM thực phẩm nào" — hai câu hỏi khác nhau: một
     ngày đủ đạm vẫn có thể không có lấy một cọng rau. */
  const analysis = analyseIngredients(
    meals.flatMap((m) => (m.menu_template_dishes || []).flatMap(usefulIngredients)),
  );

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

          {/* Phân tích nguyên liệu — cần ít nhất 2 nhóm mới có gì để so sánh. */}
          {analysis.groups.length > 1 && (
            <section className="ml-an">
              <h4 className="ml-an-title">
                <i className="fa-solid fa-chart-pie" />{' '}
                {t('ml.an_title', 'Phân tích nguyên liệu')}
                <small>{vn(analysis.totalGrams)} g · {analysis.counted} {t('ml.an_items', 'nguyên liệu')}</small>
              </h4>

              <div className="ml-an-track" aria-hidden="true">
                {analysis.groups.map((g) => (
                  <span key={g.id} style={{ width: `${g.percent}%`, background: g.color }} />
                ))}
              </div>

              <ul className="ml-an-legend">
                {analysis.groups.map((g) => (
                  <li key={g.id}>
                    <i style={{ background: g.color }} />
                    <span className="ml-an-label">{t(`ml.an_g_${g.id}`, g.label)}</span>
                    <b>{Math.round(g.percent)}%</b>
                    <small>{vn(Math.round(g.grams))} g</small>
                  </li>
                ))}
              </ul>

              {/* Thuộc tính dinh dưỡng: ĐẾM nguyên liệu, không cộng gram — một
                  nguyên liệu mang nhiều thuộc tính cùng lúc. */}
              {analysis.highlights.length > 0 && (
                <div className="ml-an-tags">
                  {analysis.highlights.map((h) => (
                    <span className={`ml-an-tag ${h.tone}`} key={h.id}>
                      <i className={`fa-solid ${h.tone === 'good' ? 'fa-circle-check' : 'fa-circle-exclamation'}`} />
                      {t(`ml.an_h_${h.id}`, h.label)}
                      <b>{h.count}</b>
                    </span>
                  ))}
                </div>
              )}

              <p className="ml-an-note">
                {t('ml.an_note', 'Tỉ lệ tính theo khối lượng nguyên liệu, không phải theo năng lượng.')}
              </p>
            </section>
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

                {/* Nguồn tự đánh dấu bữa này là số liệu CHƯA ĐẦY ĐỦ. Đây là ứng
                    dụng sức khoẻ — không được hiện con số ước tính y như con số
                    đã kiểm chứng. */}
                {meal.needs_review && (
                  <p className="ml-review-flag">
                    <i className="fa-solid fa-triangle-exclamation" />
                    <span>{t('ml.needs_review', 'Nguồn ghi nhận số liệu dinh dưỡng của bữa này chưa đầy đủ — hãy xem như tham khảo.')}</span>
                  </p>
                )}

                {/* Ghi chú xử lý: nói rõ món nào đã được chuẩn hoá tên so với
                    tài liệu gốc, để người dùng đối chiếu được. */}
                {String(meal.note || '').trim() && !meal.needs_review && (
                  <p className="ml-meal-note">{meal.note}</p>
                )}

                {dishes.map((dish) => {
                  const micro = microLine(dish, t);
                  const grams = num(dish.base_grams);
                  const dishKcal = num(dish.calories);
                  const ings = usefulIngredients(dish);
                  // Chỉ dựng bảng 4 cột khi có ít nhất MỘT con số; không thì
                  // bảng chỉ toàn dấu "—", tệ hơn là liệt kê một dòng.
                  const ingsHaveNumbers = ings.some(hasNum);
                  return (
                    <div className="mp-dish-row" key={dish.id}>
                      <span className="mp-dish-name">
                        <DishName name={dish.name} />
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

                      {/* Có tên nguyên liệu nhưng chưa có số nào — liệt kê một
                          dòng, không dựng bảng rỗng. */}
                      {ings.length > 0 && !ingsHaveNumbers && (
                        <span className="ml-ing-plain">
                          <i className="fa-solid fa-basket-shopping" /> {ings.map((i) => i.name).join(' · ')}
                        </span>
                      )}

                      {ings.length > 0 && ingsHaveNumbers && (
                        <table className="ml-ing-table">
                          <thead>
                            <tr>
                              <th>{t('ml.ing', 'Nguyên liệu')}</th>
                              <th>{t('ml.ing_use', 'Định lượng')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ings.map((i) => (
                              <tr key={i.id}>
                                <td>
                                  {i.name}
                                  {(i.tags || []).length > 0 && (
                                    <small className="ml-ing-tag">{i.tags.join(', ')}</small>
                                  )}
                                </td>
                                <td>
                                  {i.grams != null ? `${vn(i.grams)} ${i.unit || 'g'}` : '—'}
                                  {String(i.price || '').trim() && <small>{i.price}</small>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
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
