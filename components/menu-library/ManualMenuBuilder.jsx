'use client';
/**
 * ManualMenuBuilder — tự gõ thực đơn, không cần Excel.
 *
 * Mỗi bữa là MỘT ô nhiều dòng, mỗi dòng một món. Cách này nhập nhanh hơn hẳn
 * form từng-món-một-hàng (7 ngày × 4 bữa × 3 món = 84 ô), và khớp đúng cách
 * người ta chép thực đơn từ giấy hoặc từ web.
 *
 * Dinh dưỡng để trống — máy chủ tự ước tính bằng đúng engine của đường Excel.
 * Định lượng có thể viết ngay trong tên món ("Phở bò: 180 g bánh phở, 50 g thịt
 * bò") và bộ tách nguyên liệu sẽ hiểu.
 */
import { useState } from 'react';
import { MENU_CATEGORIES } from '../../lib/family-menu/menu-categories';
import { mealLabel, dayLabel } from '../../lib/excel/labels';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MAX_DAYS = 7;

const emptyDays = (n) =>
  Array.from({ length: n }, (_, i) => ({
    day_index: i + 1,
    meals: Object.fromEntries(MEALS.map((m) => [m, ''])),
  }));

/** Ô nhiều dòng → mảng món, bỏ dòng trống và gạch đầu dòng thừa. */
function linesToDishes(text) {
  return String(text || '')
    .split('\n')
    .map((s) => s.replace(/^[\s•·\-–*]+/u, '').trim())
    .filter(Boolean)
    .map((name) => ({ name: name.slice(0, 300) }));
}

export default function ManualMenuBuilder({ household, onCancel, onSubmit, t }) {
  const [meta, setMeta] = useState({
    title: '', description: '', category: 'khac', disease_target: '', visibility: 'public',
  });
  const [days, setDays] = useState(() => emptyDays(MAX_DAYS));
  const [openDay, setOpenDay] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const setMetaField = (k) => (e) => setMeta((m) => ({ ...m, [k]: e.target.value }));

  function setMeal(dayIndex, meal, value) {
    setDays((prev) => prev.map((d) => (
      d.day_index === dayIndex ? { ...d, meals: { ...d.meals, [meal]: value } } : d
    )));
  }

  const dishCount = days.reduce(
    (s, d) => s + MEALS.reduce((n, m) => n + linesToDishes(d.meals[m]).length, 0), 0
  );

  async function submit(e) {
    e.preventDefault();
    if (!meta.title.trim()) { setErr(t('ml.e_title', 'Tiêu đề không được để trống.')); return; }
    if (!dishCount) { setErr(t('ml.e_no_dish', 'Hãy nhập ít nhất một món.')); return; }

    // Chỉ gửi ngày/bữa CÓ món — thực đơn 3 ngày không nên đẻ ra 7 ngày rỗng.
    const payload = days
      .map((d) => ({
        day_index: d.day_index,
        meals: MEALS
          .map((m) => ({ meal_type: m, dishes: linesToDishes(d.meals[m]) }))
          .filter((m) => m.dishes.length),
      }))
      .filter((d) => d.meals.length);

    setBusy(true);
    setErr(null);
    try {
      await onSubmit({
        ...meta,
        ...(household ? { household_id: household.id } : {}),
        days: payload,
      });
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mp-modal-overlay open" onClick={onCancel}>
      <form className="mp-modal ml-builder" onClick={(ev) => ev.stopPropagation()} onSubmit={submit}>
        <div className="mp-modal-header">
          <h3>{t('ml.manual_title', 'Tự nhập thực đơn')}</h3>
          <button type="button" className="mp-modal-close" onClick={onCancel} aria-label={t('common.close', 'Đóng')}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="mp-modal-body">
          {err && <p className="ml-editor-err"><i className="fa-solid fa-circle-exclamation" /> {err}</p>}

          <p className="ml-builder-hint">
            <i className="fa-solid fa-lightbulb" />{' '}
            {t('ml.manual_hint', 'Mỗi dòng là một món. Muốn khai định lượng thì viết kèm sau dấu hai chấm — ví dụ "Phở bò: 180 g bánh phở, 50 g thịt bò" — hệ thống sẽ tự tách ra danh sách đi chợ.')}
          </p>

          <label className="ml-editor-field">
            {t('ml.f_name', 'Tên menu')}
            <input type="text" value={meta.title} onChange={setMetaField('title')} maxLength={200} required
              placeholder={t('ml.f_name_ph', 'Menu giảm cân 7 ngày')} />
          </label>

          <label className="ml-editor-field">
            {t('ml.f_desc', 'Mô tả ngắn')}
            <input type="text" value={meta.description} onChange={setMetaField('description')} maxLength={300} />
          </label>

          <div className="ml-builder-row">
            <label className="ml-editor-field">
              {t('ml.f_category', 'Danh mục')}
              <select value={meta.category} onChange={setMetaField('category')}>
                {MENU_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="ml-editor-field">
              {t('ml.f_scope', 'Phạm vi')}
              <select value={meta.visibility} onChange={setMetaField('visibility')}>
                <option value="public">{t('ml.scope_public', 'Công khai (mặc định)')}</option>
                <option value="private">{t('ml.scope_private', 'Chỉ gia đình tôi')}</option>
              </select>
            </label>
          </div>

          {/* Tab theo ngày — 7 ngày × 4 bữa trải phẳng sẽ dài không đọc nổi. */}
          <div className="ml-builder-tabs">
            {days.map((d) => {
              const n = MEALS.reduce((s, m) => s + linesToDishes(d.meals[m]).length, 0);
              return (
                <button
                  type="button"
                  key={d.day_index}
                  className={`ml-builder-tab${openDay === d.day_index ? ' active' : ''}${n ? ' filled' : ''}`}
                  onClick={() => setOpenDay(d.day_index)}
                >
                  {dayLabel(d.day_index, { withDate: false })}
                  {n > 0 && <em>{n}</em>}
                </button>
              );
            })}
          </div>

          {days.filter((d) => d.day_index === openDay).map((d) => (
            <div className="ml-builder-day" key={d.day_index}>
              {MEALS.map((m) => (
                <label className="ml-editor-field" key={m}>
                  {mealLabel(m)}
                  <textarea
                    rows={3}
                    value={d.meals[m]}
                    onChange={(e) => setMeal(d.day_index, m, e.target.value)}
                    placeholder={t('ml.manual_ph', 'Mỗi dòng một món...')}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>

        <div className="ml-editor-foot">
          <span className="ml-builder-count">
            {dishCount > 0
              ? `${dishCount} ${t('ml.ir_dishes', 'món')}`
              : t('ml.manual_empty', 'Chưa nhập món nào')}
          </span>
          <div className="ml-editor-foot-right">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
              {t('common.cancel', 'Hủy')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? t('common.creating', 'Đang tạo...') : t('ml.manual_save', 'Tạo thực đơn')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
