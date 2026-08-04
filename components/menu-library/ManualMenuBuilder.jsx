'use client';
/**
 * ManualMenuBuilder — tự gõ thực đơn, không cần Excel.
 *
 * Hai chế độ nhập, dùng CHUNG một nguồn dữ liệu là chuỗi nhiều dòng của mỗi bữa:
 *
 *   • Nhập nhanh — mỗi dòng một món, định lượng viết sau dấu ":".
 *                  Nhập nhanh nhất, khớp cách người ta chép thực đơn từ giấy/web.
 *   • Chi tiết   — mỗi món một khối, nguyên liệu nhập từng dòng (tên/lượng/đơn vị).
 *
 * Vì sao KHÔNG giữ hai state song song: chế độ chi tiết chỉ là một trình soạn
 * thảo có cấu trúc bên trên đúng chuỗi đó — mọi thay đổi được serialize ngược
 * lại ngay. Giữ hai bản sao thì sớm muộn cũng lệch nhau và mất dữ liệu lúc
 * chuyển qua lại.
 *
 * Dinh dưỡng để trống — máy chủ tự ước tính bằng đúng engine của đường Excel.
 */
import { useState } from 'react';
import { scopeOptions } from '../../lib/family-menu/scope-labels';
import { MENU_CATEGORIES } from '../../lib/family-menu/menu-categories';
import { parseDishSpec } from '../../lib/family-menu/dish-parse';
import { mealLabel, dayLabel } from '../../lib/excel/labels';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MAX_DAYS = 7;

const emptyDays = (n) =>
  Array.from({ length: n }, (_, i) => ({
    day_index: i + 1,
    meals: Object.fromEntries(MEALS.map((m) => [m, ''])),
  }));

/** Ô nhiều dòng → mảng dòng món, bỏ dòng trống và gạch đầu dòng thừa. */
function toLines(text) {
  return String(text || '')
    .split('\n')
    .map((s) => s.replace(/^[\s•·\-–*]+/u, '').trim())
    .filter(Boolean);
}

function linesToDishes(text) {
  return toLines(text).map((name) => ({ name: name.slice(0, 300) }));
}

/**
 * Một dòng món → cấu trúc để soạn thảo.
 *
 * `needsEstimate` của parseDishSpec nghĩa là "không khai định lượng" — với
 * trình soạn thảo thì coi như chưa có nguyên liệu nào, để trống chờ nhập.
 */
function lineToDish(line) {
  const spec = parseDishSpec(line);
  const declared = (spec.ingredients || []).filter((i) => !i.needsEstimate);
  return {
    name: spec.name || line,
    ingredients: declared.map((i) => ({
      name: i.name || '',
      grams: i.grams == null ? '' : String(i.grams),
      unit: i.unit || 'g',
    })),
  };
}

/** Cấu trúc → đúng cú pháp mà bộ nhập hiểu: "Phở gà: 180 g bánh phở, 100 g gà". */
function dishToLine(dish) {
  const name = String(dish.name || '').trim();
  const parts = (dish.ingredients || [])
    .filter((i) => String(i.name || '').trim())
    .map((i) => {
      const qty = String(i.grams ?? '').trim();
      const unit = String(i.unit || '').trim();
      return qty ? `${qty} ${unit || 'g'} ${i.name.trim()}` : i.name.trim();
    });
  return parts.length ? `${name}: ${parts.join(', ')}` : name;
}

export default function ManualMenuBuilder({ household, onCancel, onSubmit, t }) {
  const [meta, setMeta] = useState({
    title: '', description: '', category: 'khac', disease_target: '', visibility: 'public',
  });
  const [days, setDays] = useState(() => emptyDays(MAX_DAYS));
  const [openDay, setOpenDay] = useState(1);
  const [mode, setMode] = useState('quick');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const setMetaField = (k) => (e) => setMeta((m) => ({ ...m, [k]: e.target.value }));

  function setMeal(dayIndex, meal, value) {
    setDays((prev) => prev.map((d) => (
      d.day_index === dayIndex ? { ...d, meals: { ...d.meals, [meal]: value } } : d
    )));
  }

  /** Sửa một món ở chế độ chi tiết → ghi thẳng ngược về chuỗi của bữa. */
  function updateDish(dayIndex, meal, dishIndex, mutate) {
    const lines = toLines(days.find((d) => d.day_index === dayIndex).meals[meal]);
    const dish = lineToDish(lines[dishIndex] || '');
    mutate(dish);
    lines[dishIndex] = dishToLine(dish);
    setMeal(dayIndex, meal, lines.join('\n'));
  }

  function addDish(dayIndex, meal) {
    const cur = days.find((d) => d.day_index === dayIndex).meals[meal];
    setMeal(dayIndex, meal, `${cur ? `${cur}\n` : ''}${t('ml.new_dish', 'Món mới')}`);
  }

  function removeDish(dayIndex, meal, dishIndex) {
    const lines = toLines(days.find((d) => d.day_index === dayIndex).meals[meal]);
    lines.splice(dishIndex, 1);
    setMeal(dayIndex, meal, lines.join('\n'));
  }

  const dishCount = days.reduce(
    (s, d) => s + MEALS.reduce((n, m) => n + toLines(d.meals[m]).length, 0), 0
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
                {scopeOptions(household?.mode, t).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Chọn cách nhập. Cả hai ghi vào cùng một chuỗi nên đổi qua lại
              không mất dữ liệu đã gõ. */}
          <div className="ml-mode-switch" role="tablist">
            <button
              type="button" role="tab" aria-selected={mode === 'quick'}
              className={`ml-mode-btn${mode === 'quick' ? ' active' : ''}`}
              onClick={() => setMode('quick')}
            >
              <i className="fa-solid fa-bolt" /> {t('ml.mode_quick', 'Nhập nhanh')}
            </button>
            <button
              type="button" role="tab" aria-selected={mode === 'detail'}
              className={`ml-mode-btn${mode === 'detail' ? ' active' : ''}`}
              onClick={() => setMode('detail')}
            >
              <i className="fa-solid fa-list-check" /> {t('ml.mode_detail', 'Nhập từng nguyên liệu')}
            </button>
          </div>

          {mode === 'quick' && (
            <p className="ml-builder-hint">
              <i className="fa-solid fa-lightbulb" />{' '}
              {t('ml.manual_hint', 'Mỗi dòng là một món. Muốn khai định lượng thì viết kèm sau dấu hai chấm — ví dụ "Phở bò: 180 g bánh phở, 50 g thịt bò" — hệ thống sẽ tự tách ra danh sách đi chợ.')}
            </p>
          )}

          {/* Tab theo ngày — 7 ngày × 4 bữa trải phẳng sẽ dài không đọc nổi. */}
          <div className="ml-builder-tabs">
            {days.map((d) => {
              const n = MEALS.reduce((s, m) => s + toLines(d.meals[m]).length, 0);
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
                <div className="ml-builder-meal" key={m}>
                  <span className="ml-builder-meal-name">{mealLabel(m)}</span>

                  {mode === 'quick' ? (
                    <>
                      <textarea
                        rows={3}
                        value={d.meals[m]}
                        onChange={(e) => setMeal(d.day_index, m, e.target.value)}
                        placeholder={t('ml.manual_ph', 'Mỗi dòng một món...')}
                      />
                      {/* Xem trước: cho thấy hệ thống ĐÃ tách được gì, để người
                          dùng biết cú pháp ":" có ăn hay không thay vì đoán. */}
                      <QuickPreview text={d.meals[m]} t={t} />
                    </>
                  ) : (
                    <DetailEditor
                      text={d.meals[m]}
                      onChangeDish={(i, mutate) => updateDish(d.day_index, m, i, mutate)}
                      onRemoveDish={(i) => removeDish(d.day_index, m, i)}
                      onAddDish={() => addDish(d.day_index, m)}
                      t={t}
                    />
                  )}
                </div>
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

/* ───────────────────────── xem trước (chế độ nhanh) ───────────────────────── */

function QuickPreview({ text, t }) {
  const lines = toLines(text);
  if (!lines.length) return null;

  return (
    <ul className="ml-parse-preview">
      {lines.map((line, i) => {
        const dish = lineToDish(line);
        const n = dish.ingredients.length;
        return (
          <li key={i} className={n ? 'ok' : 'plain'}>
            <i className={`fa-solid ${n ? 'fa-circle-check' : 'fa-circle-minus'}`} />
            <b>{dish.name}</b>
            <span>
              {n
                ? `${n} ${t('ml.pv_ingredients', 'nguyên liệu')}: ${dish.ingredients.map((x) => x.name).join(', ')}`
                : t('ml.pv_none', 'chưa khai định lượng — hệ thống sẽ tự ước tính')}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ───────────────────────── soạn thảo chi tiết ───────────────────────── */

function DetailEditor({ text, onChangeDish, onRemoveDish, onAddDish, t }) {
  const dishes = toLines(text).map(lineToDish);

  return (
    <div className="ml-detail-editor">
      {dishes.map((dish, di) => (
        <div className="ml-detail-dish" key={di}>
          <div className="ml-detail-dish-head">
            <input
              type="text"
              value={dish.name}
              onChange={(e) => onChangeDish(di, (d) => { d.name = e.target.value; })}
              placeholder={t('ml.pv_dish_name', 'Tên món')}
            />
            <button type="button" onClick={() => onRemoveDish(di)} aria-label={t('common.delete', 'Xóa')}>
              <i className="fa-solid fa-trash" />
            </button>
          </div>

          {dish.ingredients.map((ing, ii) => (
            <div className="ml-detail-ing" key={ii}>
              <input
                type="text"
                value={ing.name}
                onChange={(e) => onChangeDish(di, (d) => { d.ingredients[ii].name = e.target.value; })}
                placeholder={t('ml.pv_ing_name', 'Nguyên liệu')}
              />
              <input
                type="text"
                inputMode="decimal"
                value={ing.grams}
                onChange={(e) => onChangeDish(di, (d) => { d.ingredients[ii].grams = e.target.value; })}
                placeholder={t('ml.pv_qty', 'Lượng')}
              />
              <input
                type="text"
                value={ing.unit}
                onChange={(e) => onChangeDish(di, (d) => { d.ingredients[ii].unit = e.target.value; })}
                placeholder="g"
              />
              <button
                type="button"
                onClick={() => onChangeDish(di, (d) => { d.ingredients.splice(ii, 1); })}
                aria-label={t('common.delete', 'Xóa')}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          ))}

          <button
            type="button"
            className="ml-detail-add-ing"
            onClick={() => onChangeDish(di, (d) => { d.ingredients.push({ name: '', grams: '', unit: 'g' }); })}
          >
            <i className="fa-solid fa-plus" /> {t('ml.pv_add_ing', 'Thêm nguyên liệu')}
          </button>
        </div>
      ))}

      <button type="button" className="ml-detail-add-dish" onClick={onAddDish}>
        <i className="fa-solid fa-plus" /> {t('ml.pv_add_dish', 'Thêm món')}
      </button>
    </div>
  );
}
