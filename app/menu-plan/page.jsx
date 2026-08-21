'use client';
/**
 * /menu-plan — Thực đơn tuần + Danh sách đi chợ.
 *
 * Thẻ ngày dạng dọc, gọn: mỗi thẻ chỉ tổng calo + macro + vài món; bấm vào mới
 * mở modal chi tiết. Ngày hiển thị "Thứ 2…Chủ nhật" (lib/excel/labels.js) chứ
 * không còn "Ngày 1…Ngày 7".
 *
 * Hộ chưa có kế hoạch thì nạp THỰC ĐƠN MẪU (knowledge/sample-menus.json) để màn
 * hình không trống — mẫu chỉ để xem, mọi nút ghi đều bị khoá.
 */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import PageShell from '../../components/PageShell';
import ActionButton from '../../components/ActionButton';
import DayCard from '../../components/menu-plan/DayCard';
import DayDetailModal from '../../components/menu-plan/DayDetailModal';
import ShoppingPanel from '../../components/menu-plan/ShoppingPanel';
import DayNotes from '../../components/menu-plan/DayNotes';
import GenerationProgress from '../../components/GenerationProgress';
import { useApi } from '../../lib-client/useApi';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/modal.css';
import '../../styles/menu-plan.css';
import '../../styles/shopping-panel.css';
// Thanh macro dùng chung với modal chi tiết ngày (styles/macro-bar.css).
import '../../styles/macro-bar.css';
// Khối bữa ăn + danh sách món trong modal chi tiết ngày.
import '../../styles/dish-list.css';
import '../../styles/day-notes.css';

export default function MenuPlanPage() {
  return (
    <Suspense fallback={null}>
      <MenuPlanInner />
    </Suspense>
  );
}

function MenuPlanInner() {
  const [householdId, setHouseholdId] = useState(null);
  const [noHousehold, setNoHousehold] = useState(false);
  const [plan, setPlan] = useState(null);
  const [auditByDish, setAuditByDish] = useState(new Map());
  const [openDay, setOpenDay] = useState(null);

  const [samples, setSamples] = useState([]);
  const [sampleId, setSampleId] = useState(null);

  const [tab, setTab] = useState('menu');
  /** null | 'regen' (đang chạy) | 'done' (đã xong, cho thanh chạy nốt 100%). */
  const [busy, setBusy] = useState(null);
  const [shopping, setShopping] = useState({ items: null, groups: null, totals: null, text: '', error: null });
  const [cost, setCost] = useState(null);          // { byDay, byMeal, total }
  const [servings, setServings] = useState(null);

  const { get, post, download } = useApi();
  const showToast = useToast();
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const router = useRouter();

  const isSample = !!plan?.is_sample;
  const days = [...(plan?.plan_days || [])].sort((a, b) => a.day_index - b.day_index);

  /* ── nạp dữ liệu ─────────────────────────────────────────────────────── */

  async function loadPlan(hid) {
    const data = await get('/api/family-menu', { resource: 'plan', household_id: hid });
    if (data) {
      setPlan(data);
      const rows = await get('/api/family-menu', { resource: 'plan-audit', plan_id: data.id });
      const map = new Map();
      for (const a of rows || []) {
        if (!a.plan_dish_id) continue;
        if (!map.has(a.plan_dish_id)) map.set(a.plan_dish_id, []);
        map.get(a.plan_dish_id).push(a);
      }
      setAuditByDish(map);
      // Chi phí nạp ngay ở tab Thực đơn — người dùng thấy tiền từng ngày mà
      // không phải mở tab Danh sách đi chợ. Hỏng thì thẻ ngày chỉ thiếu dòng
      // tiền, không chặn cả trang.
      get('/api/family-menu', { resource: 'shopping-list', plan_id: data.id })
        .then((l) => { if (l?.cost) setCost(l.cost); })
        .catch(() => {});
      return;
    }
    // Chưa có kế hoạch → hiện thực đơn mẫu thay vì màn hình trống.
    await loadSamples();
  }

  async function loadSamples() {
    const list = await get('/api/family-menu', { resource: 'sample-menus' });
    setSamples(list || []);
    if (list?.length) await pickSample(list[0].id);
  }

  async function pickSample(id) {
    setSampleId(id);
    setAuditByDish(new Map());
    setPlan(await get('/api/family-menu', { resource: 'sample-menu', id }));
    setShopping({ items: null, groups: null, totals: null, days: null, text: '', error: null });
  }

  useEffect(() => {
    if (!window.localStorage.getItem('calorie_ai_token')) { router.push('/signin'); return; }
    (async () => {
      try {
        let hid = searchParams.get('household_id');
        if (!hid) {
          const data = await get('/api/family-menu', { resource: 'household' });
          hid = data?.household?.id || null;
        }
        if (!hid) { setNoHousehold(true); await loadSamples(); return; }
        setHouseholdId(hid);
        await loadPlan(hid);
      } catch (e) {
        showToast(e.message, 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadShopping(nextServings = servings) {
    setShopping({ items: null, groups: null, totals: null, days: null, text: '', error: null });
    try {
      const q = isSample
        ? { resource: 'sample-shopping-list', id: plan.sample_id, ...(nextServings ? { servings: nextServings } : {}) }
        : { resource: 'shopping-list', plan_id: plan.id, ...(nextServings ? { servings: nextServings } : {}) };
      const list = await get('/api/family-menu', q);
      setShopping({
        items: list?.items || [],
        groups: list?.groups || null,
        totals: list?.totals || null,
        days: list?.days || null,
        text: list?.text || buildText(list?.items),
        error: null,
      });
      if (list?.cost) setCost(list.cost);
      return list;
    } catch (e) {
      setShopping({ items: null, groups: null, totals: null, days: null, text: '', error: e.message });
      return null;
    }
  }

  /* ── thao tác ────────────────────────────────────────────────────────── */

  function switchTab(next) {
    setTab(next);
    if (next === 'shopping' && plan) loadShopping();
  }

  async function changeServings(v) {
    const n = Math.max(1, Number(v) || 1);
    setServings(n);
    if (tab === 'shopping' && plan) await loadShopping(n);
  }

  async function regenerateWeek() {
    if (!window.confirm(t('mp.confirm_regen', 'Làm lại toàn bộ thực đơn tuần này?'))) return;
    setBusy('regen');
    try {
      await post('/api/family-menu', { action: 'regenerate_plan', plan_id: plan.id, scope: 'week' });
      await loadPlan(householdId);
      /* Bật `done` để thanh chạy nốt lên 100% rồi mới tắt — trước đây làm xong
         không có dấu hiệu gì trên màn, người dùng không biết đã xong hay chưa. */
      setBusy('done');
      showToast(t('mp.toast_regen', 'Đã tạo lại thực đơn tuần!'), 'success');
      setTimeout(() => setBusy(null), 900);
    } catch (e) {
      setBusy(null);
      showToast(e.message, 'error');
    }
  }

  async function swapDish(dish) {
    try {
      await post('/api/family-menu', { action: 'swap_dish', plan_dish_id: dish.id });
      showToast(t('mp.toast_swapped', 'Đã đổi món!'), 'success');
      setOpenDay(null);
      await loadPlan(householdId);
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function exportExcel(sheets) {
    try {
      const name = await download('/api/family-menu', {
        resource: 'export',
        plan_id: plan.id,
        ...(sheets ? { sheets } : {}),
        ...(servings ? { servings } : {}),
      }, 'thuc-don.xlsx');
      showToast(`${t('mp.toast_exported', 'Đã tải')} ${name}`, 'success');
    } catch (e) { showToast(e.message, 'error'); }
  }

  /* ── render ──────────────────────────────────────────────────────────── */

  return (
    <PageShell>
      <div className="schedule-hero">
        <div className="schedule-hero-text">
          <div className="schedule-hero-icon"><i className="fa-solid fa-utensils" /></div>
          <div>
            <h1>{t('mp.title', 'Thực đơn tuần')}</h1>
            <p>{t('mp.subtitle', 'Bấm vào từng ngày để xem chi tiết bữa ăn, dinh dưỡng và danh sách đi chợ')}</p>
          </div>
        </div>
      </div>

      {noHousehold && (
        <div className="mp-sample-banner">
          <i className="fa-solid fa-circle-info" />
          <span>{t('mp.need_household', 'Bạn chưa có hồ sơ gia đình — đây là thực đơn mẫu để tham khảo.')}</span>
          <Link href="/household" className="btn btn-primary mp-sample-cta">
            {t('mp.create_household', 'Tạo gia đình')}
          </Link>
        </div>
      )}

      {isSample && !noHousehold && (
        <div className="mp-sample-banner">
          <i className="fa-solid fa-circle-info" />
          <span>
            {t('mp.sample_note', 'Đây là thực đơn mẫu từ')} <b>{plan.source_name}</b>{' '}
            {t('mp.sample_note2', '— dữ liệu tham khảo, chưa phải của gia đình bạn.')}
          </span>
          <Link href="/menu-library" className="btn btn-primary mp-sample-cta">
            {t('mp.pick_real', 'Chọn thực đơn cho gia đình')}
          </Link>
        </div>
      )}

      {isSample && samples.length > 1 && (
        <div className="mp-sample-picker">
          {samples.map((s) => (
            <button
              type="button"
              key={s.id}
              className={`mp-sample-chip${s.id === sampleId ? ' active' : ''}`}
              onClick={() => pickSample(s.id)}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}

      {plan && (
        <div className="mp-toolbar">
          <div className="mp-tabs">
            <button className={`mp-tab${tab === 'menu' ? ' active' : ''}`} onClick={() => switchTab('menu')}>
              {t('mp.tab_menu', 'Thực đơn')}
            </button>
            <button className={`mp-tab${tab === 'shopping' ? ' active' : ''}`} onClick={() => switchTab('shopping')}>
              {t('mp.tab_shopping', 'Danh sách đi chợ')}
            </button>
          </div>

          <div className="mp-actions">
            <label className="mp-servings">
              <span>{t('mp.servings', 'Số suất')}</span>
              <input
                type="number" min="1" max="1000"
                value={servings ?? ''}
                placeholder={t('mp.servings_auto', 'Tự động')}
                onChange={(e) => changeServings(e.target.value)}
              />
            </label>

            {/* Mẫu chỉ để xem: không xuất file, không sinh lại. */}
            {!isSample && (
              <>
                <ActionButton className="btn btn-primary" onClick={() => exportExcel()}>
                  <i className="fa-solid fa-file-excel" /> {t('mp.export_all', 'Xuất Excel')}
                </ActionButton>
                <ActionButton className="btn btn-secondary" onClick={() => exportExcel('shopping')}>
                  <i className="fa-solid fa-cart-shopping" /> {t('mp.export_shopping', 'Chỉ danh sách đi chợ')}
                </ActionButton>
                <ActionButton className="btn btn-secondary" onClick={regenerateWeek}>
                  <i className="fa-solid fa-rotate" /> {t('mp.regen_week', 'Làm lại cả tuần')}
                </ActionButton>
              </>
            )}
          </div>
        </div>
      )}

      {/* Dựng lại cả tuần chạy khá lâu — có thanh tiến trình thì người dùng
          biết hệ thống đang làm, và biết lúc nào xong. */}
      {busy && (
        <GenerationProgress
          running={busy === 'regen'}
          done={busy === 'done'}
          expectedMs={9_000}
          title={busy === 'done' ? null : t('mp.regenerating', 'Đang dựng lại thực đơn tuần…')}
          t={t}
        />
      )}

      {!plan && !busy && (
        <GenerationProgress
          running
          done={false}
          showSteps={false}
          expectedMs={3500}
          title={t('mp.loading_plan', 'Đang tải thực đơn...')}
          t={t}
        />
      )}

      {plan && tab === 'menu' && (
        <div className="mp-days">
          {days.map((d) => (
            <DayCard key={d.id || d.day_index} day={d} cost={cost?.byDay?.[d.day_index]} onOpen={setOpenDay} t={t} />
          ))}
        </div>
      )}

      {plan && tab === 'shopping' && (
        <>
          <div className="card">
            <h3><i className="fa-solid fa-cart-shopping" /> {t('mp.shopping_title', 'Nguyên liệu cần mua (cả tuần)')}</h3>
            <ShoppingPanel
              items={shopping.items}
              groups={shopping.groups}
              totals={shopping.totals}
              text={shopping.text}
              error={shopping.error}
              loading={shopping.items === null && !shopping.error}
              checkable
              scope={isSample ? `sample:${plan.sample_id}` : `plan:${plan.id}`}
              t={t}
            />
          </div>

          <DayNotes
            days={shopping.days}
            scope={isSample ? `sample:${plan.sample_id}` : `plan:${plan.id}`}
            t={t}
          />
        </>
      )}

      <DayDetailModal
        day={openDay}
        auditByDish={auditByDish}
        cost={cost}
        readOnly={isSample}
        onClose={() => setOpenDay(null)}
        onSwapDish={swapDish}
        t={t}
      />
    </PageShell>
  );
}

/** Dòng text gọn khi API không kèm sẵn (mẫu). Định dạng khớp formatItemLine. */
function buildText(items) {
  return (items || [])
    .map((i) => (i.qty == null
      ? `${i.name} (cần ước lượng)`
      : `${Number(i.qty).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ${i.unit || ''} ${i.name}`.replace(/\s+/g, ' ').trim()))
    .join(' / ');
}
