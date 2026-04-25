
  if (typeof window.showToast !== 'function') {
    window.showToast = (m) => console.log('[toast]', m);
  }

  const PALETTE = {
    protein: '#c25b4a',
    carbs: '#b8975a',
    fat: '#7d9b76',
    primary: '#7d9b76',
    primaryDeep: '#4d6549',
    gold: '#b8975a',
    sageLight: '#dce5d4'
  };

  // Tối ưu Chart.js toàn cục
  if (window.Chart) {
    Chart.defaults.color = '#6a7a66';
    Chart.defaults.font.family = 'Inter, sans-serif';
    Chart.defaults.borderColor = 'rgba(125,155,118,0.12)';
    Chart.defaults.animation = false;
    Chart.defaults.responsiveAnimationDuration = 0;
  }

  let macroChart = null;
  let weightChart = null;
  let weeklyChart = null;
  let bmrChart = null;
  let energyChart = null;

  const $ = (id) => document.getElementById(id);

  function destroyChart(chartRef) {
    if (chartRef) {
      chartRef.destroy();
    }
    return null;
  }

  function renderMacroChart(p, c, f) {
    const ctx = $('macroChart');
    if (!ctx || !window.Chart) return;

    macroChart = destroyChart(macroChart);

    macroChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Protein', 'Carbs', 'Fats'],
        datasets: [{
          data: [Number(p) * 4 || 0, Number(c) * 4 || 0, Number(f) * 9 || 0],
          backgroundColor: [PALETTE.protein, PALETTE.carbs, PALETTE.fat],
          borderColor: '#fff',
          borderWidth: 3,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${Math.round(ctx.parsed)} kcal`
            }
          }
        }
      }
    });
  }

  function renderWeightChart(start, current, target, deadline) {
    const ctx = $('weightChart');
    if (!ctx || !window.Chart) return;

    const s = Number(start) || Number(current) || 0;
    const cur = Number(current) || 0;
    const tgt = Number(target) || cur;

    const labels = ['Bắt đầu', 'Tuần 1', 'Tuần 2', 'Hiện tại', '...', deadline || 'Mục tiêu'];
    const series = [
      s,
      +(s + (cur - s) * 0.33).toFixed(1),
      +(s + (cur - s) * 0.66).toFixed(1),
      cur,
      null,
      tgt
    ];
    const targetLine = labels.map(() => tgt);

    const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 280);
    grad.addColorStop(0, 'rgba(125,155,118,0.45)');
    grad.addColorStop(1, 'rgba(125,155,118,0)');

    weightChart = destroyChart(weightChart);

    weightChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Cân nặng (kg)',
            data: series,
            spanGaps: true,
            borderColor: PALETTE.primary,
            backgroundColor: grad,
            fill: true,
            tension: 0.4,
            borderWidth: 3,
            pointBackgroundColor: PALETTE.gold,
            pointBorderColor: '#fff',
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBorderWidth: 2
          },
          {
            label: 'Mục tiêu',
            data: targetLine,
            borderColor: PALETTE.gold,
            borderDash: [6, 6],
            borderWidth: 2,
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { usePointStyle: true, boxWidth: 8, padding: 14 }
          }
        },
        scales: {
          y: {
            grid: { color: 'rgba(125,155,118,0.08)' },
            ticks: { callback: (v) => v + ' kg' }
          },
          x: { grid: { display: false } }
        }
      }
    });
  }

  function renderWeeklyChart(targetCal) {
    const ctx = $('weeklyChart');
    if (!ctx || !window.Chart) return;

    const tc = Number(targetCal) || 2000;
    const variation = [1.00, 0.96, 1.02, 0.98, 1.05, 1.10, 1.04];
    const data = variation.map(v => Math.round(tc * v));
    const labels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    const goalLine = labels.map(() => tc);

    const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 280);
    grad.addColorStop(0, PALETTE.primary);
    grad.addColorStop(1, 'rgba(220,229,212,0.6)');

    weeklyChart = destroyChart(weeklyChart);

    weeklyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Calo nạp (ước tính)',
            data,
            backgroundColor: grad,
            borderRadius: 10,
            borderSkipped: false,
            maxBarThickness: 36
          },
          {
            label: 'Mục tiêu',
            data: goalLine,
            type: 'line',
            borderColor: PALETTE.gold,
            borderDash: [5, 5],
            borderWidth: 2,
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { usePointStyle: true, boxWidth: 8, padding: 14 }
          },
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.dataset.label}: ${c.parsed.y} kcal`
            }
          }
        },
        scales: {
          y: {
            grid: { color: 'rgba(125,155,118,0.08)' },
            ticks: { callback: (v) => v + ' kcal' }
          },
          x: { grid: { display: false } }
        }
      }
    });
  }

  function renderBmrChart(bmr, tdee) {
    const ctx = $('bmrChart');
    if (!ctx || !window.Chart) return;

    const b = Number(bmr) || 0;
    const t = Number(tdee) || 0;
    const activity = Math.max(0, t - b);

    bmrChart = destroyChart(bmrChart);

    bmrChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['BMR (cơ bản)', 'Vận động'],
        datasets: [{
          data: [b, activity],
          backgroundColor: [PALETTE.primaryDeep, PALETTE.gold],
          borderColor: '#fff',
          borderWidth: 3,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        animation: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { usePointStyle: true, boxWidth: 8, padding: 14 }
          },
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.label}: ${Math.round(c.parsed)} kcal`
            }
          }
        }
      }
    });
  }function renderEnergyChart(bmr, tdee, target) {
  const ctx = $('energyChart');
  if (!ctx || !window.Chart) return;

  const b = Number(bmr) || 1;
  const t = Number(tdee) || 1;
  const tg = Number(target) || 1;

  energyChart = destroyChart(energyChart);

  energyChart = new Chart(ctx, {
    type: 'polarArea',
    data: {
      labels: ['BMR', 'TDEE', 'Mục tiêu'],
      datasets: [{
        data: [b, t, tg],
        backgroundColor: [
          'rgba(77,101,73,0.55)',
          'rgba(125,155,118,0.55)',
          'rgba(184,151,90,0.55)'
        ],
        borderColor: [
          PALETTE.primaryDeep,
          PALETTE.primary,
          PALETTE.gold
        ],
        borderWidth: 2
      }]
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
          // nếu bị tắt từ legend thì không vẽ label
          if (!chart.getDataVisibility(i)) return;

          const pos = arc.tooltipPosition();

          const line1 = labels[i];
          const line2 = Number(values[i]).toLocaleString() + ' kcal';

          ctx.font = 'bold 12px Inter, sans-serif';

          const w = Math.max(
            ctx.measureText(line1).width,
            ctx.measureText(line2).width
          ) + 18;

          const h = 42;

          let offsetX = 0;
          let offsetY = 0;

          if (i === 0) offsetX = 25;   // BMR
          if (i === 1) offsetY = 10;   // TDEE
          if (i === 2) offsetX = -25;  // Mục tiêu

          const x = pos.x - w / 2 + offsetX;
          const y = pos.y - h / 2 + offsetY;

          const out =
            x < chartArea.left ||
            y < chartArea.top ||
            x + w > chartArea.right ||
            y + h > chartArea.bottom;

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
      }
    }],

    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: false
        }
      },
      scales: {
        r: {
          ticks: {
            display: false,
            backdropColor: 'transparent'
          },
          grid: {
            color: 'rgba(125,155,118,0.15)'
          },
          angleLines: {
            color: 'rgba(125,155,118,0.15)'
          }
        }
      }
    }
  });
}  function scrollToBottom() {
    const h = $('chat-history');
    if (h) h.scrollTo({ top: h.scrollHeight, behavior: 'smooth' });
  }

  function updateProgress() {}

  function setText(id, value) {
    const el = $(id);
    if (el) el.innerText = value;
  }

  function setHTML(id, value) {
    const el = $(id);
    if (el) el.innerHTML = value;
  }

  function setWidth(id, percent) {
    const el = $(id);
    if (el) el.style.width = percent;
  }

  function renderAllCharts(d) {
    const calories = Number(d?.calories) || 0;
    const p = Number(d?.macros?.protein) || 0;
    const c = Number(d?.macros?.carbs) || 0;
    const f = Number(d?.macros?.fat) || 0;

    const doRender = () => {
      renderMacroChart(p, c, f);
      renderWeightChart(d?.profile?.start_weight, d?.profile?.weight, d?.profile?.target_weight, d?.profile?.deadline);
      renderWeeklyChart(calories);
      renderBmrChart(d?.bmr, d?.tdee);
      renderEnergyChart(d?.bmr, d?.tdee, calories);
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => doRender(), { timeout: 250 });
    } else {
      requestAnimationFrame(() => doRender());
    }
  }

  function renderDisease(raw){
    const card = document.getElementById('disease-card');
    const titleEl = document.getElementById('disease-title');
    const descEl = document.getElementById('disease-desc');
    const tagsEl = document.getElementById('disease-tags');
    if (!card) return;

    let list = [];
    if (Array.isArray(raw)) list = raw.filter(Boolean).map(x => String(x).trim()).filter(Boolean);
    else if (typeof raw === 'string') list = raw.split(/[,;\n]/).map(x => x.trim()).filter(Boolean);

    if (list.length === 0){
      card.classList.add('is-empty');
      titleEl.textContent = 'Không có bệnh nền';
      descEl.textContent = 'Bạn chưa khai báo bệnh lý nào. Thực đơn sẽ tối ưu cho mục tiêu cân nặng & năng lượng.';
      tagsEl.innerHTML = '';
      return;
    }

    card.classList.remove('is-empty');
    titleEl.textContent = list.length === 1 ? 'Lưu ý chế độ ăn cho tình trạng sức khoẻ' : `Bạn đang có ${list.length} tình trạng cần lưu ý`;
    descEl.textContent = 'Vui lòng chú ý lựa chọn thực phẩm phù hợp. Hệ thống sẽ ưu tiên cảnh báo món ăn không tốt cho các bệnh lý dưới đây.';
    tagsEl.innerHTML = list.map(name => `<span class="disease-tag"><i class="fa-solid fa-notes-medical"></i>${escapeHtml(name)}</span>`).join('');
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function loadDietData() {
    const token = localStorage.getItem('calorie_ai_token');
    if (!token) {
      window.location.href = 'signin.html';
      return;
    }

    const roadmapContainer = document.querySelector('.content');
    let loader = null;

    if (roadmapContainer) {
      loader = document.createElement('div');
      loader.className = 'loading-overlay';
      loader.id = 'main-loader';
      loader.innerHTML = `
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      `;
      roadmapContainer.appendChild(loader);
    }

    try {
      const headers = { 'Authorization': `Bearer ${token}` };

      const [statusRes, dietRes] = await Promise.all([
        fetch('/api/status', { method: 'GET', headers }),
        fetch('/api/diet-info', { headers })
      ]);

      if (!statusRes.ok) throw new Error('Status request failed');
      if (!dietRes.ok) throw new Error('Diet info request failed');

      const statusData = await statusRes.json();
      if (!statusData?.is_setup_completed) {
        window.location.href = 'setup.html';
        return;
      }

      const result = await dietRes.json();

      if (!result?.success) {
        throw new Error(result?.message || 'API returned success=false');
      }

      const d = result.data || {};
      const calories = Number(d.calories) || 0;
      const weight = d.profile?.weight ?? '';
      const targetWeight = d.profile?.target_weight ?? '';
      const deadline = d.profile?.deadline ?? '';
      const bmr = Number(d.bmr) || 0;
      const tdee = Number(d.tdee) || 0;
      const p = Number(d.macros?.protein) || 0;
      const c = Number(d.macros?.carbs) || 0;
      const f = Number(d.macros?.fat) || 0;

      setHTML('display-calories', `${calories.toLocaleString()} <span class="target-unit">kcal</span>`);
      setText('display-weight', `${weight} kg`);
      setText('display-target', `${targetWeight} kg`);
      setText('display-deadline', deadline);
      renderDisease(d.profile?.disease);
      setHTML('display-bmr', `<i class="fa-solid fa-bolt"></i> BMR: ${bmr}`);
      setHTML('display-tdee', `<i class="fa-solid fa-fire"></i> TDEE: ${tdee}`);
      setText('p-val', `${p}g`);
      setText('c-val', `${c}g`);
      setText('f-val', `${f}g`);

      const safeCalories = calories > 0 ? calories : 1;
      const pPercent = ((p * 4 / safeCalories) * 100).toFixed(0);
      const cPercent = ((c * 4 / safeCalories) * 100).toFixed(0);
      const fPercent = ((f * 9 / safeCalories) * 100).toFixed(0);

      setWidth('p-bar', pPercent + '%');
      setWidth('c-bar', cPercent + '%');
      setWidth('f-bar', fPercent + '%');
      setText('macro-center-cal', calories.toLocaleString());

      renderAllCharts(d);
    } catch (err) {
      console.error('Lỗi:', err);
      showToast('Không thể tải dữ liệu lộ trình', 'error');

      // Fallback demo
      setText('macro-center-cal', '2,000');
      setHTML('display-calories', `2,000 <span class="target-unit">kcal</span>`);
      setText('display-weight', '74 kg');
      setText('display-target', '68 kg');
      setText('display-deadline', '01/12/2025');
      setHTML('display-bmr', `<i class="fa-solid fa-bolt"></i> BMR: 1600`);
      setHTML('display-tdee', `<i class="fa-solid fa-fire"></i> TDEE: 2200`);
      setText('p-val', '140g');
      setText('c-val', '220g');
      setText('f-val', '60g');

      setWidth('p-bar', ((140 * 4 / 2000) * 100).toFixed(0) + '%');
      setWidth('c-bar', ((220 * 4 / 2000) * 100).toFixed(0) + '%');
      setWidth('f-bar', ((60 * 9 / 2000) * 100).toFixed(0) + '%');

      renderMacroChart(140, 220, 60);
      renderWeightChart(78, 74, 68, '01/12/2025');
      renderWeeklyChart(2000);
      renderBmrChart(1600, 2200);
      renderEnergyChart(1600, 2200, 2000);
    } finally {
      const loaderObj = $('main-loader');
      if (loaderObj) {
        setTimeout(() => loaderObj.remove(), 250);
      }
    }
  }

  function handleLogout() {
    localStorage.removeItem('calorie_ai_token');
    showToast('Đang đăng xuất...', 'info');
    setTimeout(() => {
      window.location.href = 'signin.html';
    }, 800);
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadDietData();

    const navHome = $('nav-home');
    const navPlan = $('nav-plan');
    const navProfile = $('nav-profile');

    if (navHome) navHome.onclick = () => window.location.href = 'chat.html';
    if (navPlan) navPlan.onclick = () => window.location.href = 'schedule.html';
    if (navProfile) navProfile.onclick = () => window.location.href = 'setup.html';
  });

  window.loadDietData = loadDietData;
  window.handleLogout = handleLogout;
  window.scrollToBottom = scrollToBottom;
  window.updateProgress = updateProgress;