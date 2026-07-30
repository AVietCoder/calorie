'use client';
/**
 * TemplateDetail — xem trước toàn bộ thực đơn TRƯỚC khi áp dụng.
 *
 * Hiện thực đơn hôm nay + đủ 7 ngày × các bữa, kèm calo. Có nút quay lại danh
 * sách. Nút áp dụng nằm ở trang cha vì nó cần hộp xác nhận khi đang dùng thực
 * đơn khác.
 */
import { dayLabel, mealLabel, MEAL_ORDER } from '../../lib/excel/labels';
import { getCategory } from '../../lib/family-menu/menu-categories';
import ShoppingPanel from '../menu-plan/ShoppingPanel';
import DayNotes from '../menu-plan/DayNotes';

/** day_index của HÔM NAY theo tuần Việt Nam (T2 = 1 … CN = 7). */
export function todayDayIndex() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

function mealsOf(day) {
  return [...(day?.menu_template_meals || [])].sort(
    (a, b) => (MEAL_ORDER[a.meal_type] || 99) - (MEAL_ORDER[b.meal_type] || 99)
  );
}

const kcalOf = (dishes) => dishes.reduce((s, d) => s + (Number(d.calories) || 0), 0);

function DayBlock({ day, t }) {
  const meals = mealsOf(day);
  const all = meals.flatMap((m) => m.menu_template_dishes || []);
  const kcal = kcalOf(all);

  return (
    <>
      <div className="ml-day-head">
        <b>{dayLabel(day.day_index, { withDate: false })}</b>
        {kcal > 0 && <span>{Math.round(kcal).toLocaleString('vi-VN')} kcal</span>}
      </div>
      {meals.map((m) => {
        const dishes = m.menu_template_dishes || [];
        if (!dishes.length) return null;
        return (
          <div className="ml-meal" key={m.id}>
            <span className="ml-meal-label">{mealLabel(m.meal_type)}</span>
            <ul>
              {dishes.map((d) => (
                <li key={d.id}>
                  {d.name}
                  {Number(d.calories) > 0 && <small> · {Math.round(d.calories)} kcal</small>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {!all.length && <p className="mp-empty">{t('ml.day_empty', 'Chưa có món')}</p>}
    </>
  );
}

/** Tổng calo trung bình mỗi ngày — chỉ tính ngày thực sự có số. */
function avgKcal(days) {
  const perDay = days
    .map((d) => kcalOf(mealsOf(d).flatMap((m) => m.menu_template_dishes || [])))
    .filter((v) => v > 0);
  if (!perDay.length) return null;
  return Math.round(perDay.reduce((s, v) => s + v, 0) / perDay.length);
}

export default function TemplateDetail({ template, inUse, onBack, actions, shopping, t }) {
  const cat = getCategory(template.category);
  const days = [...(template.days || [])].sort((a, b) => a.day_index - b.day_index);
  const today = days.find((d) => d.day_index === todayDayIndex());
  const dishCount = days.reduce((s, d) => s + mealsOf(d).reduce((n, m) => n + (m.menu_template_dishes?.length || 0), 0), 0);
  const kcal = avgKcal(days);

  return (
    <div className="ml-detail">
      <button type="button" className="ml-back" onClick={onBack}>
        <i className="fa-solid fa-arrow-left" /> {t('ml.back', 'Tất cả thực đơn')}
      </button>

      {/* Đầu trang dạng banner theo màu danh mục — thay cho một dòng tiêu đề trơ. */}
      <header
        className="ml-hero"
        style={{ '--ml-grad': `linear-gradient(135deg, ${cat.from}, ${cat.to})` }}
      >
        {template.image_url && <img className="ml-hero-img" src={template.image_url} alt="" />}
        <div className="ml-hero-body">
          <div className="ml-hero-top">
            <span className="ml-hero-cat"><i className={`fa-solid ${cat.icon}`} /> {cat.label}</span>
            {inUse && (
              <span className="ml-hero-badge">
                <i className="fa-solid fa-circle-check" /> {t('ml.in_use', 'Đang sử dụng')}
              </span>
            )}
            {template.is_system && (
              <span className="ml-hero-badge sys">
                <i className="fa-solid fa-shield-halved" /> {t('ml.system', 'Hệ thống')}
              </span>
            )}
          </div>

          <h2>{template.title}</h2>
          {template.description && <p className="ml-hero-desc" style={{ color: 'white' }}>{template.description}</p>}

          <div className="ml-hero-stats">
            <span><b>{days.length}</b> {t('ml.days', 'ngày')}</span>
            <span><b>{dishCount}</b> {t('ml.dishes', 'món')}</span>
            {kcal != null && <span><b>{kcal.toLocaleString('vi-VN')}</b> {t('ml.kcal_day', 'kcal/ngày')}</span>}
            {shopping?.totals?.estimatedCost > 0 && (
              <span><b>≈ {Math.round(shopping.totals.estimatedCost).toLocaleString('vi-VN')} đ</b> {t('ml.week_cost', '/ tuần')}</span>
            )}
          </div>
        </div>

        <div className="ml-hero-actions">{actions}</div>
      </header>

      {today && (
        <div className="ml-today">
          <h3><i className="fa-solid fa-star" /> {t('ml.today', 'Thực đơn hôm nay')}</h3>
          <DayBlock day={today} t={t} />
        </div>
      )}

      <div className="ml-days">
        {days.map((d) => (
          <div className="ml-day" key={d.id}>
            <DayBlock day={d} t={t} />
          </div>
        ))}
      </div>

      {!days.length && <p className="mp-empty">{t('ml.detail_empty', 'Thực đơn này chưa có dữ liệu ngày nào.')}</p>}

      {/* Checklist đi chợ — hiện KỂ CẢ khi chưa áp dụng thực đơn, để cân nhắc
          "mua những gì, hết bao nhiêu" trước khi thay kế hoạch đang chạy. */}
      {days.length > 0 && (
        <section className="ml-shop">
          <div className="section-title">
            <h2><i className="fa-solid fa-cart-shopping" /> {t('ml.shop_title', 'Nguyên liệu cần mua')}</h2>
            <p>
              {inUse
                ? t('ml.shop_sub_inuse', 'Danh sách cho thực đơn bạn đang dùng.')
                : t('ml.shop_sub', 'Xem trước cho thực đơn này — chưa cần áp dụng.')}
            </p>
          </div>

          <div className="card">
            <ShoppingPanel
              items={shopping?.items}
              groups={shopping?.groups}
              totals={shopping?.totals}
              text={shopping?.text}
              error={shopping?.error}
              loading={!shopping}
              checkable
              scope={`tpl:${template.id}`}
              t={t}
            />
          </div>

          <DayNotes days={shopping?.days} scope={`tpl:${template.id}`} t={t} />
        </section>
      )}
    </div>
  );
}
