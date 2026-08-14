'use client';
/**
 * TemplateDetail — xem trước toàn bộ thực đơn TRƯỚC khi áp dụng.
 *
 * Hiện thực đơn hôm nay + đủ 7 ngày × các bữa, kèm calo. Có nút quay lại danh
 * sách. Nút áp dụng nằm ở trang cha vì nó cần hộp xác nhận khi đang dùng thực
 * đơn khác.
 */
import { useState } from 'react';
import { dayLabel, mealLabel } from '../../lib/excel/labels';
import { getCategory } from '../../lib/family-menu/menu-categories';
import { sourceLogo } from '../../lib/family-menu/source-logos';
import ShoppingPanel from '../menu-plan/ShoppingPanel';
import DayNotes from '../menu-plan/DayNotes';
import TemplateDayModal from './TemplateDayModal';
import { MEAL_ICON, mealsOf, kcalOf, todayDayIndex } from './template-day-utils';
import DishName from './DishName';

// Giữ lại lối export cũ cho nơi nào đang import từ file này.
export { todayDayIndex };

/** Nội dung tóm tắt một ngày, dùng cho cả thẻ "hôm nay" lẫn lưới 7 thẻ. */
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
            <span className="ml-meal-label">
              <i className={`fa-solid ${MEAL_ICON[m.meal_type] || 'fa-utensils'}`} /> {mealLabel(m.meal_type)}
            </span>
            <ul>
              {dishes.map((d) => (
                <li key={d.id}>
                  <DishName name={d.name} />
                  {Number(d.calories) > 0 && <small> · {Math.round(d.calories)} kcal</small>}
                  {/* Giá tiền nhập từ Excel — in nguyên văn, không định dạng lại. */}
                  {String(d.price || '').trim() && <small className="ml-dish-price">{d.price}</small>}
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
  const logo = sourceLogo(template.source_name);
  const days = [...(template.days || [])].sort((a, b) => a.day_index - b.day_index);
  const today = days.find((d) => d.day_index === todayDayIndex());
  const dishCount = days.reduce((s, d) => s + mealsOf(d).reduce((n, m) => n + (m.menu_template_dishes?.length || 0), 0), 0);
  const kcal = avgKcal(days);

  /* Ngày đang mở chi tiết — null là đóng. Thẻ "hôm nay" và thẻ trong lưới 7
     ngày mở CÙNG một modal, không tách hai luồng. */
  const [openDay, setOpenDay] = useState(null);

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
            {/* Logo đơn vị phát hành — ghi nhận nguồn ngay ở đầu trang. */}
            {!template.image_url && logo && (
              <span className="ml-hero-logo" title={template.source_name || ''}>
                <img src={logo} alt={template.source_name || ''} loading="lazy" />
              </span>
            )}
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
              <span title={t('mp.price_note', 'Giá là ước tính cho một người và thay đổi theo nơi bạn mua nguyên liệu.')}>
                <b>≈ {Math.round(shopping.totals.estimatedCost).toLocaleString('vi-VN')} đ</b> {t('ml.week_cost', '/ tuần')}
              </span>
            )}
          </div>

          {shopping?.totals?.estimatedCost > 0 && (
            <p className="ml-hero-price-note">
              <i className="fa-solid fa-circle-info" />{' '}
              {t('ml.price_note_short', 'Ước tính cho một người — thay đổi theo nơi mua nguyên liệu.')}
            </p>
          )}
        </div>

        <div className="ml-hero-actions">{actions}</div>
      </header>

      {/* Cả thẻ "hôm nay" lẫn 7 thẻ trong lưới đều là <button>: bấm vào mở modal
          chi tiết dinh dưỡng. Dùng <button> chứ không phải <div onClick> để bàn
          phím và trình đọc màn hình dùng được. */}
      {today && (
        <button
          type="button"
          className="ml-today"
          onClick={() => setOpenDay(today)}
          aria-label={`${t('ml.today', 'Thực đơn hôm nay')} — ${t('ml.see_detail', 'Xem chi tiết dinh dưỡng')}`}
        >
          <h3>
            <i className="fa-solid fa-star" /> {t('ml.today', 'Thực đơn hôm nay')}
            <span className="ml-day-more"><i className="fa-solid fa-chevron-right" /></span>
          </h3>
          <DayBlock day={today} t={t} />
        </button>
      )}

      <div className="ml-days">
        {days.map((d) => (
          <button type="button" className="ml-day" key={d.id} onClick={() => setOpenDay(d)}>
            <DayBlock day={d} t={t} />
            <span className="ml-day-cta">
              {t('ml.see_detail', 'Xem chi tiết dinh dưỡng')} <i className="fa-solid fa-chevron-right" />
            </span>
          </button>
        ))}
      </div>

      {!days.length && <p className="mp-empty">{t('ml.detail_empty', 'Thực đơn này chưa có dữ liệu ngày nào.')}</p>}

      <TemplateDayModal day={openDay} onClose={() => setOpenDay(null)} t={t} />

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
