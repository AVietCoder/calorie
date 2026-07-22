'use client';
import { Fragment, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import PageShell from '../../components/PageShell';
import { useApi } from '../../lib-client/useApi';
import { useToast } from '../../lib-client/ToastContext';
import '../../styles/menu-plan.css';

const MEAL_TYPES = [
  { key: 'breakfast', label: 'Sáng' },
  { key: 'lunch', label: 'Trưa' },
  { key: 'dinner', label: 'Tối' },
  { key: 'snack', label: 'Phụ' },
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
  const [shoppingError, setShoppingError] = useState(null);

  const { get, post } = useApi();
  const showToast = useToast();
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
    if (!window.confirm('Làm lại toàn bộ thực đơn tuần này?')) return;
    try {
      await post('/api/family-menu', { action: 'regenerate_plan', plan_id: plan.id, scope: 'week' });
      showToast('Đã tạo lại thực đơn tuần!', 'success');
      await loadPlan(householdId);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function swapActiveDish() {
    if (!activeDish) return;
    try {
      await post('/api/family-menu', { action: 'swap_dish', plan_dish_id: activeDish.id });
      showToast('Đã đổi món!', 'success');
      setActiveDish(null);
      await loadPlan(householdId);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function loadShoppingList() {
    setShoppingItems(null);
    setShoppingError(null);
    try {
      const list = await get('/api/family-menu', { resource: 'shopping-list', plan_id: plan.id });
      setShoppingItems(list?.items || list?.shopping_list_items || []);
    } catch (e) {
      setShoppingError(e.message);
    }
  }

  function switchTab(t) {
    setTab(t);
    if (t === 'shopping') loadShoppingList();
  }

  if (noHouseholdMsg) {
    return (
      <PageShell>
        <div className="card"><p>Bạn cần tạo hồ sơ gia đình trước. <Link href="/household">Tạo ngay →</Link></p></div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="schedule-hero">
        <div className="schedule-hero-text">
          <div className="schedule-hero-icon"><i className="fa-solid fa-calendar-week" /></div>
          <div>
            <h1>Thực đơn tuần của gia đình</h1>
            <p>Được chọn từ thư viện chuẩn, tự động điều chỉnh theo dị ứng/bệnh lý từng người</p>
          </div>
        </div>
      </div>

      {!plan ? (
        <div className="card"><p>Gia đình chưa có thực đơn nào. <Link href="/menu-library">Chọn thực đơn từ thư viện →</Link></p></div>
      ) : (
        <div>
          <div className="plan-toolbar">
            <div className="tabs">
              <button className={`tab-btn${tab === 'grid' ? ' active' : ''}`} onClick={() => switchTab('grid')}>Thực đơn</button>
              <button className={`tab-btn${tab === 'shopping' ? ' active' : ''}`} onClick={() => switchTab('shopping')}>Danh sách mua sắm</button>
            </div>
            <button className="btn btn-secondary" onClick={regenerateWeek}><i className="fa-solid fa-rotate" /> Làm lại cả tuần</button>
          </div>

          {tab === 'grid' && (
            <div className="plan-grid">
              <div />
              {[1, 2, 3, 4, 5, 6, 7].map((d) => <div className="plan-cell-head" key={d}>Ngày {d}</div>)}

              {MEAL_TYPES.map((mt) => (
                <Fragment key={mt.key}>
                  <div className="plan-meal-label">{mt.label}</div>
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
              <h3><i className="fa-solid fa-cart-shopping" /> Danh sách nguyên liệu cần mua (cả tuần)</h3>
              {shoppingError ? (
                <p style={{ color: 'var(--danger)' }}>{shoppingError}</p>
              ) : shoppingItems === null ? (
                <p style={{ color: 'var(--text-sub)' }}>Đang tải...</p>
              ) : shoppingItems.length === 0 ? (
                <p style={{ color: 'var(--text-sub)' }}>Chưa có nguyên liệu.</p>
              ) : (
                <table>
                  <thead><tr><th>Nguyên liệu</th><th>Số lượng</th></tr></thead>
                  <tbody>
                    {shoppingItems.map((it, i) => <tr key={i}><td>{it.name}</td><td>{it.total_qty ?? ''} {it.unit || 'g'}</td></tr>)}
                  </tbody>
                </table>
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
              {Math.round(activeDish.calories || 0)} kcal · Đạm {activeDish.protein || 0}g · Béo {activeDish.fat || 0}g · Tinh bột {activeDish.carbs || 0}g{activeDish.grams ? ` · ${activeDish.grams}g` : ''}
            </p>
            <div>
              {(auditByDish.get(activeDish.id) || []).map((a, i) => (
                <div className="audit-chip" key={i}><i className="fa-solid fa-circle-info" /><span>{a.reason}</span></div>
              ))}
            </div>
            <div className="dish-modal-actions">
              <button className="btn btn-secondary" onClick={() => setActiveDish(null)}>Đóng</button>
              <button className="btn btn-primary" onClick={swapActiveDish}><i className="fa-solid fa-shuffle" /> Đổi món khác</button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
