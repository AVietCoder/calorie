'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Chart } from 'chart.js/auto';
import PageShell from '../../components/PageShell';
import ActionButton from '../../components/ActionButton';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/diet-details.css';

const PALETTE = {
  protein: '#c25b4a', carbs: '#b8975a', fat: '#7d9b76',
  primary: '#7d9b76', primaryDeep: '#4d6549', gold: '#b8975a', sageLight: '#dce5d4',
};

Chart.defaults.color = '#6a7a66';
Chart.defaults.font.family = 'Inter, sans-serif';
Chart.defaults.borderColor = 'rgba(125,155,118,0.12)';
Chart.defaults.animation = false;

function parseMacroNum(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function loadWeeklyIntake() {
  let all = {};
  try {
    const uid = window.localStorage.getItem('user_id') || 'anon';
    all = JSON.parse(window.localStorage.getItem(`calorie_ai_intake_${uid}`)) || {};
  } catch {}
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const rec = all[key] || {};
    const tot = { date: key, calories: 0, protein: 0, fat: 0, carbs: 0, dishes: [] };
    Object.values(rec.eatenInfo || {}).forEach((m) => {
      tot.calories += parseMacroNum(m.calories);
      tot.protein += parseMacroNum(m.protein);
      tot.fat += parseMacroNum(m.fat);
      tot.carbs += parseMacroNum(m.carbs);
      if (m.food) tot.dishes.push(m.food);
    });
    (rec.extras || []).forEach((ex) => {
      tot.calories += parseMacroNum(ex.calories);
      tot.protein += parseMacroNum(ex.protein);
      tot.fat += parseMacroNum(ex.fat);
      tot.carbs += parseMacroNum(ex.carbs);
      if (ex.name) tot.dishes.push(ex.name);
    });
    days.push(tot);
  }
  return days;
}

const HEALTH_STATUS_UI = {
  good: { key: 'week.status_good', fb: 'Đang cải thiện tốt', icon: 'fa-circle-check', bg: '#eaf3ee', color: '#3d7353' },
  stable: { key: 'week.status_stable', fb: 'Duy trì ổn định', icon: 'fa-circle-minus', bg: '#fdf6e8', color: '#b8975a' },
  risk: { key: 'week.status_risk', fb: 'Có nguy cơ xấu đi', icon: 'fa-triangle-exclamation', bg: '#fdecea', color: '#c0392b' },
};

export default function DietDetailsPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [diseaseList, setDiseaseList] = useState([]);
  const [diaryItems, setDiaryItems] = useState(null); // null = not loaded, [] = empty
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthResult, setHealthResult] = useState(null);

  const macroRef = useRef(null); const macroChartRef = useRef(null);
  const weightRef = useRef(null); const weightChartRef = useRef(null);
  const weeklyRef = useRef(null); const weeklyChartRef = useRef(null);
  const bmrRef = useRef(null); const bmrChartRef = useRef(null);
  const energyRef = useRef(null); const energyChartRef = useRef(null);
  const nutrientsRef = useRef(null); const nutrientsChartRef = useRef(null);

  const showToast = useToast();
  const { t, tn, localizeDisease, lang } = useTranslation();
  const router = useRouter();

  useEffect(() => {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) { router.push('/signin'); return; }

    (async () => {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [statusRes, dietRes] = await Promise.all([
          fetch('/api/status', { headers }),
          fetch('/api/diet-info', { headers }),
        ]);
        if (!statusRes.ok) throw new Error('Status request failed');
        if (!dietRes.ok) throw new Error('Diet info request failed');
        const statusData = await statusRes.json();
        if (!statusData?.is_setup_completed) { router.push('/setup'); return; }
        const result = await dietRes.json();
        if (!result?.success) throw new Error(result?.message || 'API returned success=false');
        setData(result.data || {});
      } catch (err) {
        console.error('Lỗi:', err);
        showToast(t('toast.diet_load_fail', 'Không thể tải dữ liệu lộ trình'), 'error');
        setData({
          calories: 2000, bmr: 1600, tdee: 2200, macros: { protein: 140, carbs: 220, fat: 60 },
          profile: { start_weight: 78, weight: 74, target_weight: 68, deadline: '01/12/2025' },
        });
      } finally {
        setLoading(false);
      }
    })();

    (async () => {
      try {
        const res = await fetch('/api/food-diary?limit=60', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const d = await res.json();
        setDiaryItems(Array.isArray(d.items) ? d.items : []);
      } catch {}
    })();

    function refreshIfDirty() {
      try {
        const dirty = window.localStorage.getItem('calorie_plan_dirty');
        if (dirty && dirty !== window.sessionStorage.getItem('calorie_diet_seen')) {
          window.sessionStorage.setItem('calorie_diet_seen', dirty);
          window.location.reload();
        }
      } catch {}
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfDirty(); });
    window.addEventListener('focus', refreshIfDirty);
    window.addEventListener('storage', (e) => { if (e.key === 'calorie_plan_dirty') refreshIfDirty(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!data) return;
    const calories = Number(data.calories) || 0;
    const p = Number(data.macros?.protein) || 0;
    const c = Number(data.macros?.carbs) || 0;
    const f = Number(data.macros?.fat) || 0;
    const bmr = Number(data.bmr) || 0;
    const tdee = Number(data.tdee) || 0;

    setDiseaseList(parseDiseaseList(data.profile?.disease));

    /* macro donut */
    macroChartRef.current?.destroy();
    if (macroRef.current) {
      macroChartRef.current = new Chart(macroRef.current, {
        type: 'doughnut',
        data: {
          labels: [t('chart.protein', 'Protein'), t('chart.carbs', 'Carbs'), t('chart.fats', 'Fats')],
          datasets: [{ data: [p * 4 || 0, c * 4 || 0, f * 9 || 0], backgroundColor: [PALETTE.protein, PALETTE.carbs, PALETTE.fat], borderColor: '#fff', borderWidth: 3, hoverOffset: 8 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '72%', animation: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${Math.round(ctx.parsed)} kcal` } } },
        },
      });
    }

    /* weight progress */
    weightChartRef.current?.destroy();
    if (weightRef.current) {
      const s = Number(data.profile?.start_weight) || Number(data.profile?.weight) || 0;
      const cur = Number(data.profile?.weight) || 0;
      const tgt = Number(data.profile?.target_weight) || cur;
      const labels = [t('chart.start', 'Bắt đầu'), tn('chart.week_n', { n: 1 }, 'Tuần 1'), tn('chart.week_n', { n: 2 }, 'Tuần 2'), t('chart.current', 'Hiện tại'), '...', data.profile?.deadline || t('chart.target', 'Mục tiêu')];
      const series = [s, +(s + (cur - s) * 0.33).toFixed(1), +(s + (cur - s) * 0.66).toFixed(1), cur, null, tgt];
      const grad = weightRef.current.getContext('2d').createLinearGradient(0, 0, 0, 280);
      grad.addColorStop(0, 'rgba(125,155,118,0.45)'); grad.addColorStop(1, 'rgba(125,155,118,0)');
      weightChartRef.current = new Chart(weightRef.current, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: t('chart.weight_kg', 'Cân nặng (kg)'), data: series, spanGaps: true, borderColor: PALETTE.primary, backgroundColor: grad, fill: true, tension: 0.4, borderWidth: 3, pointBackgroundColor: PALETTE.gold, pointBorderColor: '#fff', pointRadius: 5, pointHoverRadius: 7, pointBorderWidth: 2 },
            { label: t('chart.target', 'Mục tiêu'), data: labels.map(() => tgt), borderColor: PALETTE.gold, borderDash: [6, 6], borderWidth: 2, pointRadius: 0, fill: false },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 14 } } },
          scales: { y: { grid: { color: 'rgba(125,155,118,0.08)' }, ticks: { callback: (v) => v + ' kg' } }, x: { grid: { display: false } } },
        },
      });
    }

    /* weekly bar */
    weeklyChartRef.current?.destroy();
    if (weeklyRef.current) {
      const tc = calories || 2000;
      const variation = [1.0, 0.96, 1.02, 0.98, 1.05, 1.1, 1.04];
      const barData = variation.map((v) => Math.round(tc * v));
      const labels = [t('chart.mon', 'T2'), t('chart.tue', 'T3'), t('chart.wed', 'T4'), t('chart.thu', 'T5'), t('chart.fri', 'T6'), t('chart.sat', 'T7'), t('chart.sun', 'CN')];
      const grad = weeklyRef.current.getContext('2d').createLinearGradient(0, 0, 0, 280);
      grad.addColorStop(0, PALETTE.primary); grad.addColorStop(1, 'rgba(220,229,212,0.6)');
      weeklyChartRef.current = new Chart(weeklyRef.current, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: t('chart.cal_intake_est', 'Calo nạp (ước tính)'), data: barData, backgroundColor: grad, borderRadius: 10, borderSkipped: false, maxBarThickness: 36 },
            { label: t('chart.target', 'Mục tiêu'), data: labels.map(() => tc), type: 'line', borderColor: PALETTE.gold, borderDash: [5, 5], borderWidth: 2, pointRadius: 0, fill: false },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 14 } }, tooltip: { callbacks: { label: (c2) => ` ${c2.dataset.label}: ${c2.parsed.y} kcal` } } },
          scales: { y: { grid: { color: 'rgba(125,155,118,0.08)' }, ticks: { callback: (v) => v + ' kcal' } }, x: { grid: { display: false } } },
        },
      });
    }

    /* bmr vs tdee donut */
    bmrChartRef.current?.destroy();
    if (bmrRef.current) {
      const activity = Math.max(0, tdee - bmr);
      bmrChartRef.current = new Chart(bmrRef.current, {
        type: 'doughnut',
        data: { labels: [t('chart.bmr_basal', 'BMR (cơ bản)'), t('chart.activity', 'Vận động')], datasets: [{ data: [bmr, activity], backgroundColor: [PALETTE.primaryDeep, PALETTE.gold], borderColor: '#fff', borderWidth: 3, hoverOffset: 6 }] },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '68%', animation: false,
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 14 } }, tooltip: { callbacks: { label: (c2) => ` ${c2.label}: ${Math.round(c2.parsed)} kcal` } } },
        },
      });
    }

    /* energy polar area */
    energyChartRef.current?.destroy();
    if (energyRef.current) {
      const b = bmr || 1, td = tdee || 1, tg = calories || 1;
      energyChartRef.current = new Chart(energyRef.current, {
        type: 'polarArea',
        data: {
          labels: [t('chart.bmr', 'BMR'), t('chart.tdee', 'TDEE'), t('chart.target', 'Mục tiêu')],
          datasets: [{ data: [b, td, tg], backgroundColor: ['rgba(77,101,73,0.55)', 'rgba(125,155,118,0.55)', 'rgba(184,151,90,0.55)'], borderColor: [PALETTE.primaryDeep, PALETTE.primary, PALETTE.gold], borderWidth: 2 }],
        },
        plugins: [{
          id: 'alwaysTooltip',
          afterDraw(chart) {
            const { ctx, chartArea } = chart;
            const meta = chart.getDatasetMeta(0);
            const labels = chart.data.labels;
            const values = chart.data.datasets[0].data;
            ctx.save();
            meta.data.forEach((arc, i) => {
              if (!chart.getDataVisibility(i)) return;
              const pos = arc.tooltipPosition();
              const line1 = labels[i];
              const line2 = Number(values[i]).toLocaleString() + ' kcal';
              ctx.font = 'bold 12px Inter, sans-serif';
              const w = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 18;
              const h = 42;
              let offsetX = 0, offsetY = 0;
              if (i === 0) offsetX = 25;
              if (i === 1) offsetY = 10;
              if (i === 2) offsetX = -25;
              const x = pos.x - w / 2 + offsetX;
              const y = pos.y - h / 2 + offsetY;
              const out = x < chartArea.left || y < chartArea.top || x + w > chartArea.right || y + h > chartArea.bottom;
              if (out) return;
              ctx.fillStyle = 'rgba(255,255,255,0.96)';
              ctx.strokeStyle = 'rgba(125,155,118,0.18)';
              ctx.lineWidth = 1.2;
              ctx.beginPath();
              ctx.roundRect(x, y, w, h, 10);
              ctx.fill();
              ctx.stroke();
              ctx.fillStyle = '#2D3A2D';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(line1, x + w / 2, y + 14);
              ctx.font = '600 11px Inter, sans-serif';
              ctx.fillStyle = '#6a7a66';
              ctx.fillText(line2, x + w / 2, y + 29);
            });
            ctx.restore();
          },
        }],
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: { r: { ticks: { display: false, backdropColor: 'transparent' }, grid: { color: 'rgba(125,155,118,0.15)' }, angleLines: { color: 'rgba(125,155,118,0.15)' } } },
        },
      });
    }

    renderNutrients(data.macros);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, lang]);

  function renderNutrients(macros) {
    nutrientsChartRef.current?.destroy();
    if (!nutrientsRef.current) return;
    const days = loadWeeklyIntake();
    const labels = days.map((d) => d.date.slice(8, 10) + '/' + d.date.slice(5, 7));
    const tP = Number(macros?.protein) || 0, tC = Number(macros?.carbs) || 0, tF = Number(macros?.fat) || 0;
    const dash = { borderDash: [6, 6], borderWidth: 2, pointRadius: 0, fill: false };
    nutrientsChartRef.current = new Chart(nutrientsRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: t('chart.protein', 'Protein') + ' (g)', data: days.map((d) => Math.round(d.protein)), borderColor: '#c25b4a', backgroundColor: '#c25b4a', tension: 0.35, borderWidth: 3, pointRadius: 4 },
          { label: t('chart.fats', 'Fats') + ' (g)', data: days.map((d) => Math.round(d.fat)), borderColor: '#7d9b76', backgroundColor: '#7d9b76', tension: 0.35, borderWidth: 3, pointRadius: 4 },
          { label: t('chart.carbs', 'Carbs') + ' (g)', data: days.map((d) => Math.round(d.carbs)), borderColor: '#b8975a', backgroundColor: '#b8975a', tension: 0.35, borderWidth: 3, pointRadius: 4 },
          { label: `${t('chart.protein', 'Protein')} ${t('chart.target', 'Mục tiêu')}`, data: labels.map(() => tP), borderColor: 'rgba(194,91,74,0.45)', ...dash },
          { label: `${t('chart.fats', 'Fats')} ${t('chart.target', 'Mục tiêu')}`, data: labels.map(() => tF), borderColor: 'rgba(125,155,118,0.45)', ...dash },
          { label: `${t('chart.carbs', 'Carbs')} ${t('chart.target', 'Mục tiêu')}`, data: labels.map(() => tC), borderColor: 'rgba(184,151,90,0.45)', ...dash },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 12, filter: (item) => item.datasetIndex < 3 } }, tooltip: { callbacks: { label: (c2) => ` ${c2.dataset.label}: ${c2.parsed.y}g` } } },
        scales: { y: { grid: { color: 'rgba(125,155,118,0.08)' }, ticks: { callback: (v) => v + 'g' } }, x: { grid: { display: false } } },
      },
    });
  }

  function parseDiseaseList(raw) {
    if (Array.isArray(raw)) return raw.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
    if (typeof raw === 'string') return raw.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    return [];
  }

  async function runHealthCheck() {
    const days = loadWeeklyIntake().filter((d) => d.calories > 0);
    if (!days.length) {
      showToast(t('week.no_data', 'Chưa có dữ liệu — hãy tick "Đã ăn" ở trang Kế hoạch để hệ thống thống kê.'), 'info');
      return;
    }
    setHealthChecking(true);
    try {
      const token = window.localStorage.getItem('calorie_ai_token');
      const res = await fetch('/api/coach-dynamic', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'health_check', days, lang }),
      });
      const resData = await res.json();
      if (!resData.success) {
        showToast(`Lỗi (${resData.stage || 'unknown'}): ${resData.error || 'Không rõ'}`, 'error');
        return;
      }
      setHealthResult(resData);
    } catch (e) {
      console.error('[health-check]', e);
      showToast(t('toast.coach_net_err', 'Lỗi kết nối HLV AI'), 'error');
    } finally {
      setHealthChecking(false);
    }
  }

  if (!data) {
    return (
      <PageShell>
        <div className="loading-overlay" style={{ position: 'fixed' }}>
          <div className="typing-indicator"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
        </div>
      </PageShell>
    );
  }

  const calories = Number(data.calories) || 0;
  const p = Number(data.macros?.protein) || 0;
  const c = Number(data.macros?.carbs) || 0;
  const f = Number(data.macros?.fat) || 0;
  const safeCalories = calories > 0 ? calories : 1;
  const pPercent = ((p * 4 / safeCalories) * 100).toFixed(0);
  const cPercent = ((c * 4 / safeCalories) * 100).toFixed(0);
  const fPercent = ((f * 9 / safeCalories) * 100).toFixed(0);
  const healthUi = healthResult ? (HEALTH_STATUS_UI[healthResult.status] || HEALTH_STATUS_UI.stable) : null;

  return (
    <PageShell>
      {loading && (
        <div className="loading-overlay" style={{ position: 'fixed' }}>
          <div className="typing-indicator"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
        </div>
      )}
      <div className="roadmap-container">
        <div id="overview-content">
          <div className="hero">
            <div className="hero-grid">
              <div>
                <span className="hero-eyebrow"><i className="fa-solid fa-sparkles" /> {t('diet.today_route', 'Lộ trình hôm nay')}</span>
                <div style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>{t('diet.daily_target', 'Mục tiêu nạp mỗi ngày')}</div>
                <div className="target-value">{calories.toLocaleString()} <span className="target-unit">kcal</span></div>
                <div className="hero-meta">
                  <span className="chip"><i className="fa-solid fa-bolt" /> BMR: {Number(data.bmr) || 0}</span>
                  <span className="chip"><i className="fa-solid fa-fire" /> TDEE: {Number(data.tdee) || 0}</span>
                  <span className="chip"><i className="fa-solid fa-seedling" /> {t('diet.personalized', 'Cá nhân hoá')}</span>
                </div>
              </div>
              <div className="hero-chart"><canvas ref={energyRef} /></div>
            </div>
          </div>

          <div className="stats-grid">
            <div className="stat-box">
              <div className="stat-icon"><i className="fa-solid fa-weight-scale" /></div>
              <div className="stat-label">{t('diet.weight_now', 'Cân nặng hiện tại')}</div>
              <div className="stat-value">{data.profile?.weight ?? '--'} kg</div>
            </div>
            <div className="stat-box">
              <div className="stat-icon"><i className="fa-solid fa-bullseye" /></div>
              <div className="stat-label">{t('diet.target_to', 'Mục tiêu hướng đến')}</div>
              <div className="stat-value">{data.profile?.target_weight ?? '--'} kg</div>
            </div>
            <div className="stat-box">
              <div className="stat-icon"><i className="fa-solid fa-calendar-day" /></div>
              <div className="stat-label">{t('diet.deadline', 'Thời hạn (Deadline)')}</div>
              <div className="stat-value">{data.profile?.deadline || '--/--/--'}</div>
            </div>
          </div>

          <div className={`disease-card${diseaseList.length === 0 ? ' is-empty' : ''}`}>
            <div className="disease-icon"><i className="fa-solid fa-heart-pulse" /></div>
            <div className="disease-body">
              <span className="disease-eyebrow"><i className="fa-solid fa-shield-heart" /> {t('diet.disease_eyebrow', 'Bệnh lý cần lưu ý')}</span>
              <div className="disease-title">
                {diseaseList.length === 0
                  ? t('diet.disease_none_title', 'Không có bệnh nền')
                  : diseaseList.length === 1
                    ? t('diet.disease_one_title', 'Lưu ý chế độ ăn cho tình trạng sức khoẻ')
                    : tn('diet.disease_many_title', { n: diseaseList.length }, `Bạn đang có ${diseaseList.length} tình trạng cần lưu ý`)}
              </div>
              <div className="disease-desc">
                {diseaseList.length === 0
                  ? t('diet.disease_none_desc', 'Bạn chưa khai báo bệnh lý nào. Thực đơn sẽ tối ưu cho mục tiêu cân nặng & năng lượng.')
                  : t('diet.disease_warn_desc', 'Vui lòng chú ý lựa chọn thực phẩm phù hợp. Hệ thống sẽ ưu tiên cảnh báo món ăn không tốt cho các bệnh lý dưới đây.')}
              </div>
              <div className="disease-tags">
                {diseaseList.map((name, i) => (
                  <span className="disease-tag" key={i}><i className="fa-solid fa-notes-medical" />{localizeDisease(name)}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="section-title">
            <h2>{t('diet.nutri_title', 'Phân tích dinh dưỡng')}</h2>
            <p>{t('diet.nutri_sub', 'Tỉ lệ macro & tiến độ cân nặng theo lộ trình')}</p>
          </div>

          <div className="grid-2">
            <div className="card">
              <h3><i className="fa-solid fa-chart-pie" /> <span>{t('diet.macro_ratio', 'Tỉ lệ Macro đề xuất')}</span></h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'center' }}>
                <div className="macro-donut-wrap">
                  <canvas ref={macroRef} />
                  <div className="macro-center">
                    <div className="num">{calories.toLocaleString()}</div>
                    <div className="lbl">{t('diet.kcal_per_day', 'kcal / ngày')}</div>
                  </div>
                </div>
                <div className="macro-list">
                  <div className="macro-item">
                    <div className="macro-info"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#c25b4a' }} />Protein</span><span className="macro-val">{p}g</span></div>
                    <div className="macro-bar"><div className="macro-fill" style={{ width: pPercent + '%', background: '#c25b4a' }} /></div>
                  </div>
                  <div className="macro-item">
                    <div className="macro-info"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#b8975a' }} />Carbs</span><span className="macro-val">{c}g</span></div>
                    <div className="macro-bar"><div className="macro-fill" style={{ width: cPercent + '%', background: '#b8975a' }} /></div>
                  </div>
                  <div className="macro-item">
                    <div className="macro-info"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7d9b76' }} />Fats</span><span className="macro-val">{f}g</span></div>
                    <div className="macro-bar"><div className="macro-fill" style={{ width: fPercent + '%', background: '#7d9b76' }} /></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <h3><i className="fa-solid fa-route" /> <span>{t('diet.weight_progress', 'Tiến độ cân nặng')}</span></h3>
              <div className="chart-wrap"><canvas ref={weightRef} /></div>
            </div>
          </div>

          <div className="grid-charts">
            <div className="card">
              <h3><i className="fa-solid fa-chart-column" /> <span>{t('diet.cal_per_day', 'Calo theo từng ngày trong tuần')}</span></h3>
              <div className="chart-wrap"><canvas ref={weeklyRef} /></div>
            </div>
            <div className="card">
              <h3><i className="fa-solid fa-gauge-high" /> BMR vs TDEE</h3>
              <div className="chart-wrap"><canvas ref={bmrRef} /></div>
            </div>
          </div>

          <div className="section-title" style={{ marginTop: 28 }}>
            <h2>{t('week.title', 'Thống kê 7 ngày gần nhất')}</h2>
            <p>{t('week.sub', 'Các chất đã nạp mỗi ngày so với mức khuyến nghị & cảnh báo sức khỏe từ AI')}</p>
          </div>

          <div className="grid-charts">
            <div className="card">
              <h3><i className="fa-solid fa-chart-line" /> <span>{t('week.chart_title', 'Chất dinh dưỡng đã nạp vs khuyến nghị')}</span></h3>
              <div className="chart-wrap"><canvas ref={nutrientsRef} /></div>
            </div>
            <div className="card" id="health-card">
              <h3><i className="fa-solid fa-heart-pulse" /> <span>{t('week.health_title', 'Cảnh báo sức khỏe 7 ngày')}</span></h3>
              <p style={{ fontSize: 13, color: 'var(--text-sub)', lineHeight: 1.6 }}>{t('week.health_desc', 'AI phân tích hành vi ăn uống 7 ngày gần nhất, dự đoán xu hướng tình trạng bệnh và đưa lời khuyên.')}</p>
              {healthResult && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 13, padding: '7px 14px', borderRadius: 999, background: healthUi.bg, color: healthUi.color }}>
                    <i className={`fa-solid ${healthUi.icon}`} /> {t(healthUi.key, healthUi.fb)}
                  </div>
                  <p style={{ fontSize: 13.5, lineHeight: 1.65, margin: '12px 0 8px', color: 'var(--text-main)' }}>{healthResult.summary || ''}</p>
                  {(healthResult.advice || []).length > 0 && (
                    <>
                      <div style={{ fontWeight: 800, fontSize: 12.5, color: 'var(--primary-deep)', marginBottom: 4 }}>{t('week.advice', 'Lời khuyên')}</div>
                      <ul style={{ fontSize: 13, lineHeight: 1.75, paddingLeft: 18, margin: 0, color: 'var(--text-main)' }}>
                        {healthResult.advice.map((a, i) => <li key={i} dangerouslySetInnerHTML={{ __html: escapeHtml(a) }} />)}
                      </ul>
                    </>
                  )}
                </div>
              )}
              <ActionButton
                disabled={healthChecking}
                onClick={runHealthCheck}
                loadingText={t('week.analyzing', 'AI đang phân tích...')}
                style={{ marginTop: 14, width: '100%', border: 'none', borderRadius: 12, padding: 12, fontFamily: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer', color: '#fff', background: 'var(--gradient-primary,linear-gradient(135deg,#58a677,#3d7353))', boxShadow: '0 6px 16px -6px rgba(88,166,119,.6)' }}
              >
                <i className="fa-solid fa-wand-magic-sparkles" /> {t('week.analyze', 'Phân tích bằng AI')}
              </ActionButton>
            </div>
          </div>
        </div>

        {diaryItems && (
          <div className="card" style={{ marginTop: 20 }}>
            <h3><i className="fa-solid fa-images" /> <span>{t('diary.title', 'Nhật ký ảnh món ăn')}</span></h3>
            <p style={{ fontSize: 13, color: 'var(--text-sub)', margin: '-6px 0 14px' }}>{t('diary.sub', 'Những món bạn đã chụp và phân tích gần đây.')}</p>
            {diaryItems.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-sub)', textAlign: 'center', marginTop: 6 }}>{t('diary.empty', 'Chưa có ảnh nào — hãy chụp món ăn ở Chat hoặc trang Kế hoạch.')}</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 12 }}>
                {diaryItems.map((it) => {
                  const a = it.analysis || {};
                  const kcal = a.calories != null ? Math.round(a.calories) + ' kcal' : '';
                  const d = new Date(it.created_at);
                  const fmtDate = isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
                  return (
                    <div key={it.id} style={{ border: '1px solid var(--border-soft,#eee)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface,#fff)' }}>
                      <div style={{ aspectRatio: '1', background: `#f2f2f2 url('${it.url}') center/cover no-repeat` }} />
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-main,#2d3436)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.food}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-sub,#888)', display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                          <span><i className="fa-solid fa-fire-flame-curved" style={{ color: '#e8743b' }} /> {kcal}</span><span>{fmtDate}</span>
                        </div>
                        {a.confidence === 'low' && <div style={{ fontSize: 10.5, color: '#b8860b', marginTop: 2 }}>{t('extra.low_conf', 'Giá trị chỉ mang tính ước lượng.')}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}
