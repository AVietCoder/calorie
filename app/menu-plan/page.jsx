'use client';
import { Fragment, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import PageShell from '../../components/PageShell';
import ActionButton from '../../components/ActionButton';
import { useApi } from '../../lib-client/useApi';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/menu-plan.css';

const MEAL_TYPES = [
  { key: 'breakfast', tkey: 'mp.meal_breakfast', label: 'Sáng' },
  { key: 'lunch', tkey: 'mp.meal_lunch', label: 'Trưa' },
  { key: 'dinner', tkey: 'mp.meal_dinner', label: 'Tối' },
  { key: 'snack', tkey: 'mp.meal_snack', label: 'Phụ' },
];

export default function MenuPlanPage() {
  return (
    <Suspense fallback={null}>
      <MenuPlanInner />
    </Suspense>
  );
}

function MenuPlanInner() {
  const [householdId, setHouseholdId] = useState(null);
  const [noHouseholdMsg, setNoHouseholdMsg] = useState(null);
  const [plan, setPlan] = useState(null);
  const [auditByDish, setAuditByDish] = useState(new Map());
  const [activeDish, setActiveDish] = useState(null);
  const [tab, setTab] = useState('grid');
  const [shoppingItems, setShoppingItems] = useState(null); // null = not loaded
  const [shoppingGroups, setShoppingGroups] = useState(null);
  const [shoppingTotals, setShoppingTotals] = useState(null);
  const [shoppingError, setShoppingError] = useState(null);
  const [servings, setServings] = useState(null); // null = theo số thành viên

  const { get, post, download } = useApi();
  const showToast = useToast();
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const router = useRouter();

  function findDay(dayIndex) { return (plan?.plan_days || []).find((d) => d.day_index === dayIndex); }
  function findMeal(day, mealType) { return (day?.plan_meals || []).find((m) => m.meal_type === mealType); }
  function findDishById(dishId) {
    for (const day of plan?.plan_days || []) {
      for (const meal of day.plan_meals || []) {
        const dish = (meal.plan_dishes || []).find((x) => x.id === dishId);
        if (dish) return dish;
      }
    }
    return null;
  }

  async function loadPlan(hid) {
    const data = await get('/api/family-menu', { resource: 'plan', household_id: hid });
    setPlan(data);
    if (!data) return;
    const auditRows = await get('/api/family-menu', { resource: 'plan-audit', plan_id: data.id });
    const map = new Map();
    for (const a of auditRows || []) {
      if (!a.plan_dish_id) continue;
      if (!map.has(a.plan_dish_id)) map.set(a.plan_dish_id, []);
      map.get(a.plan_dish_id).push(a);
    }
    setAuditByDish(map);
  }

  useEffect(() => {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) { router.push('/signin'); return; }
    (async () => {
      let hid = searchParams.get('household_id');
      try {
        if (!hid) {
          const data = await get('/api/family-menu', { resource: 'household' });
          hid = data?.household?.id || null;
        }
        if (!hid) { setNoHouseholdMsg('need-household'); return; }
        setHouseholdId(hid);
        await loadPlan(hid);
      } catch (e) {
        showToast(e.message, 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function regenerateWeek() {
    if (!window.confirm(t('mp.confirm_regen', 'Làm lại toàn bộ thực đơn tuần này?'))) return;
    try {
      await post('/api/family-menu', { action: 'regenerate_plan', plan_id: plan.id, scope: 'week' });
      showToast(t('mp.toast_regen', 'Đã tạo lại thực đơn tuần!'), 'success');
      await loadPlan(householdId);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function swapActiveDish() {
    if (!activeDish) return;
    try {
      await post('/api/family-menu', { action: 'swap_dish', plan_dish_id: activeDish.id });
      showToast(t('mp.toast_swapped', 'Đã đổi món!'), 'success');
      setActiveDish(null);
      await loadPlan(householdId);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function loadShoppingList(nextServings = servings) {
    setShoppingItems(null);
    setShoppingError(null);
    try {
      const list = await get('/api/family-menu', {
        resource: 'shopping-list',
        plan_id: plan.id,
        ...(nextServings ? { servings: nextServings } : {}),
      });
      setShoppingItems(list?.items || list?.shopping_list_items || []);
      setShoppingGroups(list?.groups || null);
      setShoppingTotals(list?.totals || null);
    } catch (e) {
      setShoppingError(e.message);
    }
  }

  /** Đổi số suất → danh sách mua được tính lại ngay, không phải sinh lại kế hoạch. */
  async function changeServings(next) {
    const n = Math.max(1, Number(next) || 1);
    setServings(n);
    if (tab === 'shopping') await loadShoppingList(n);
  }

  async function exportExcel(sheets) {
    try {
      const name = await download(
        '/api/family-menu',
        {
          resource: 'export',
          plan_id: plan.id,
          ...(sheets ? { sheets } : {}),
          ...(servings ? { servings } : {}),
        },
        'thuc-don.xlsx'
      );
      showToast(t('mp.toast_exported', `Đã tải ${name}`), 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  function switchTab(t) {
    setTab(t);
    if (t === 'shopping') loadShoppingList();
  }

  if (noHouseholdMsg) {
    return (
      <PageShell>
        <div className="card"><p>{t('fm.need_household', 'Bạn cần tạo hồ sơ gia đình trước.')} <Link href="/household">{t('fm.create_now', 'Tạo ngay →')}</Link></p></div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="schedule-hero">
        <div className="schedule-hero-text">
          <div className="schedule-hero-icon"><i className="fa-solid fa-calendar-week" /></div>
          <div>
            <h1>{t('mp.title', 'Thực đơn tuần của gia đình')}</h1>
            <p>{t('mp.subtitle', 'Được chọn từ thư viện chuẩn, tự động điều chỉnh theo dị ứng/bệnh lý từng người')}</p>
          </div>
        </div>
      </div>

      {!plan ? (
        <div className="card"><p>{t('mp.no_plan', 'Gia đình chưa có thực đơn nào.')} <Link href="/menu-library">{t('mp.pick_from_lib', 'Chọn thực đơn từ thư viện →')}</Link></p></div>
      ) : (
        <div>
          <div className="plan-toolbar">
            <div className="tabs">
              <button className={`tab-btn${tab === 'grid' ? ' active' : ''}`} onClick={() => switchTab('grid')}>{t('mp.tab_menu', 'Thực đơn')}</button>
              <button className={`tab-btn${tab === 'shopping' ? ' active' : ''}`} onClick={() => switchTab('shopping')}>{t('mp.tab_shopping', 'Danh sách mua sắm')}</button>
            </div>
            <div className="plan-actions">
              <label className="servings-control">
                <span>{t('mp.servings', 'Số suất')}</span>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={servings ?? ''}
                  placeholder={t('mp.servings_auto', 'Tự động')}
                  onChange={(e) => changeServings(e.target.value)}
                />
              </label>
              <ActionButton className="btn btn-primary" onClick={() => exportExcel()} loadingText={t('common.exporting', 'Đang xuất...')}>
                <i className="fa-solid fa-file-excel" /> {t('mp.export_all', 'Xuất Excel (4 sheet)')}
              </ActionButton>
              <ActionButton className="btn btn-secondary" onClick={() => exportExcel('shopping')} loadingText={t('common.exporting', 'Đang xuất...')}>
                <i className="fa-solid fa-cart-shopping" /> {t('mp.export_shopping', 'Chỉ danh sách đi chợ')}
              </ActionButton>
              <ActionButton className="btn btn-secondary" onClick={regenerateWeek} loadingText={t('common.creating', 'Đang tạo...')}>
                <i className="fa-solid fa-rotate" /> {t('mp.regen_week', 'Làm lại cả tuần')}
              </ActionButton>
            </div>
          </div>

          {tab === 'grid' && (
            <div className="plan-grid">
              <div />
              {[1, 2, 3, 4, 5, 6, 7].map((d) => <div className="plan-cell-head" key={d}>{t('mp.day', 'Ngày')} {d}</div>)}

              {MEAL_TYPES.map((mt) => (
                <Fragment key={mt.key}>
                  <div className="plan-meal-label">{t(mt.tkey, mt.label)}</div>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                    const dishes = findMeal(findDay(d), mt.key)?.plan_dishes || [];
                    if (!dishes.length) return <div key={`${mt.key}-${d}`} />;
                    return (
                      <div key={`${mt.key}-${d}`}>
                        {dishes.map((dish) => {
                          const hasAudit = auditByDish.has(dish.id);
                          return (
                            <div key={dish.id} className={`plan-dish-card${hasAudit ? ' has-audit' : ''}`} onClick={() => setActiveDish(dish)}>
                              <div className="d-name">{dish.name}</div>
                              <div className="d-cal">{Math.round(dish.calories || 0)} kcal{hasAudit && <> · <i className="fa-solid fa-triangle-exclamation" /></>}</div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          )}

          {tab === 'shopping' && (
            <div className="card">
              <h3><i className="fa-solid fa-cart-shopping" /> {t('mp.shopping_title', 'Danh sách nguyên liệu cần mua (cả tuần)')}</h3>
              {shoppingError ? (
                <p style={{ color: 'var(--danger)' }}>{shoppingError}</p>
              ) : shoppingItems === null ? (
                <p style={{ color: 'var(--text-sub)' }}>{t('common.loading', 'Đang tải...')}</p>
              ) : shoppingItems.length === 0 ? (
                <p style={{ color: 'var(--text-sub)' }}>{t('mp.no_ingredients', 'Chưa có nguyên liệu.')}</p>
              ) : (
                <>
                  {shoppingTotals && (
                    <p className="shopping-summary">
                      {shoppingTotals.itemCount} {t('mp.items', 'nguyên liệu')} · {t('mp.est_cost', 'Chi phí dự kiến')}:{' '}
                      <strong>{formatMoney(shoppingTotals.estimatedCost)} đ</strong>
                      {shoppingTotals.missingPriceCount > 0 && (
                        <span className="shopping-warn">
                          {' '}({t('mp.missing_price', 'chưa có giá')}: {shoppingTotals.missingPriceCount})
                        </span>
                      )}
                    </p>
                  )}
                  {(shoppingGroups || [{ key: 'all', label: '', items: shoppingItems }]).map((g) => (
                    <div key={g.key} className="shopping-group">
                      {g.label && <h4 className="shopping-group-title">{g.label}</h4>}
                      <table>
                        <thead>
                          <tr>
                            <th>{t('mp.ingredient', 'Nguyên liệu')}</th>
                            <th>{t('mp.quantity', 'Số lượng')}</th>
                            <th>{t('mp.unit_price', 'Đơn giá')}</th>
                            <th>{t('mp.line_total', 'Thành tiền')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.items.map((it, i) => (
                            <tr key={i} title={it.substitutes?.length ? `${t('mp.substitutes', 'Có thể thay bằng')}: ${it.substitutes.join(', ')}` : undefined}>
                              <td>{it.name}</td>
                              <td>{formatQty(it.qty ?? it.total_qty)} {it.unit || 'g'}</td>
                              <td>{it.unit_price == null ? '-' : formatMoney(it.unit_price)}</td>
                              <td>{it.line_total == null ? '-' : formatMoney(it.line_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className={`dish-modal-overlay${activeDish ? ' open' : ''}`}>
        {activeDish && (
          <div className="dish-modal card">
            <h3>{activeDish.name}</h3>
            <p style={{ color: 'var(--text-sub)' }}>
              {Math.round(activeDish.calories || 0)} kcal · {t('mp.protein', 'Đạm')} {activeDish.protein || 0}g · {t('mp.fat', 'Béo')} {activeDish.fat || 0}g · {t('mp.carbs', 'Tinh bột')} {activeDish.carbs || 0}g{activeDish.grams ? ` · ${activeDish.grams}g` : ''}
            </p>
            <div>
              {(auditByDish.get(activeDish.id) || []).map((a, i) => (
                <div className="audit-chip" key={i}><i className="fa-solid fa-circle-info" /><span>{a.reason}</span></div>
              ))}
            </div>
            <div className="dish-modal-actions">
              <button className="btn btn-secondary" onClick={() => setActiveDish(null)}>{t('common.close', 'Đóng')}</button>
              <ActionButton className="btn btn-primary" onClick={swapActiveDish} loadingText={t('common.processing', 'Đang xử lý...')}><i className="fa-solid fa-shuffle" /> {t('mp.swap_dish', 'Đổi món khác')}</ActionButton>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

/** Định dạng tiền/số kiểu Việt Nam; null → '-' để không bao giờ hiện NaN. */
function formatMoney(v) {
  if (v == null || Number.isNaN(Number(v))) return '-';
  return Math.round(Number(v)).toLocaleString('vi-VN');
}

function formatQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}
