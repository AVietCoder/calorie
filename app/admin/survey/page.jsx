'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Chart from 'chart.js/auto';
import PageShell from '../../../components/PageShell';
import { useToast } from '../../../lib-client/ToastContext';
import '../../../styles/survey-analytics.css';

const LABELS = {
  ageGroup: {
    under_18: 'Dưới 18',
    '18_24': '18 – 24',
    '25_34': '25 – 34',
    '35_44': '35 – 44',
    '45_54': '45 – 54',
    '55_plus': 'Từ 55',
    prefer_not: 'Không tiết lộ',
  },
  gender: { male: 'Nam', female: 'Nữ', other: 'Khác', prefer_not: 'Không tiết lộ' },
  usageFrequency: {
    daily: 'Hằng ngày',
    few_week: 'Vài lần/tuần',
    weekly: 'Mỗi tuần',
    rarely: 'Ít hơn mỗi tuần',
  },
  primaryGoal: {
    lose: 'Giảm cân',
    maintain: 'Giữ cân',
    gain: 'Tăng cân',
    muscle: 'Tăng cơ',
    health: 'Sức khỏe',
    disease: 'Kiểm soát bệnh lý',
    other: 'Khác',
  },
};

const CHART_COLORS = ['#4d9471', '#8bbda0', '#d9b76d', '#6f8fae', '#ad7f91', '#9a9f84', '#d48475'];

function formatDate(value, withTime = false) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', withTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { day: '2-digit', month: '2-digit' }
  ).format(new Date(value));
}

function entriesFor(source, type) {
  return Object.entries(source || {}).map(([value, count]) => ({
    label: LABELS[type]?.[value] || value,
    count,
  }));
}

function ChartPanel({ title, description, icon, className = '', children }) {
  return (
    <section className={`survey-chart-card ${className}`}>
      <div className="survey-chart-card__head">
        <span><i className={`fa-solid ${icon}`} /></span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function SurveyCharts({ data }) {
  const trendRef = useRef(null);
  const sectionRef = useRef(null);
  const ageRef = useRef(null);
  const frequencyRef = useRef(null);

  useEffect(() => {
    const charts = [];
    const grid = 'rgba(31, 67, 51, 0.08)';
    const tick = '#718078';
    const font = { family: 'Inter, sans-serif' };
    Chart.defaults.font.family = font.family;
    Chart.defaults.color = tick;

    const recentTrend = (data.trend || []).slice(-21);
    charts.push(new Chart(trendRef.current, {
      type: 'line',
      data: {
        labels: recentTrend.map((item) => formatDate(item.date)),
        datasets: [
          {
            label: 'Số phản hồi',
            data: recentTrend.map((item) => item.responses),
            borderColor: '#4d9471',
            backgroundColor: 'rgba(77, 148, 113, 0.12)',
            pointBackgroundColor: '#fff',
            pointBorderColor: '#4d9471',
            pointBorderWidth: 2,
            pointRadius: 3,
            fill: true,
            tension: 0.38,
            yAxisID: 'y',
          },
          {
            label: 'Điểm trung bình',
            data: recentTrend.map((item) => item.average),
            borderColor: '#d0a64f',
            pointBackgroundColor: '#d0a64f',
            borderDash: [5, 5],
            pointRadius: 2,
            tension: 0.35,
            yAxisID: 'score',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 7, padding: 18 } } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
          y: { beginAtZero: true, grid: { color: grid }, ticks: { precision: 0 } },
          score: { position: 'right', min: 0, max: 5, grid: { display: false }, ticks: { stepSize: 1 } },
        },
      },
    }));

    charts.push(new Chart(sectionRef.current, {
      type: 'radar',
      data: {
        labels: data.sectionScores.map((item) => item.label),
        datasets: [{
          label: 'Điểm trung bình',
          data: data.sectionScores.map((item) => item.average),
          borderColor: '#397458',
          backgroundColor: 'rgba(77, 148, 113, 0.18)',
          pointBackgroundColor: '#397458',
          pointBorderColor: '#fff',
          pointRadius: 4,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          r: {
            min: 0,
            max: 5,
            ticks: { stepSize: 1, backdropColor: 'transparent', font: { size: 9 } },
            angleLines: { color: grid },
            grid: { color: grid },
            pointLabels: { color: '#41544a', font: { size: 10, weight: 600 } },
          },
        },
      },
    }));

    const ageEntries = entriesFor(data.demographics.ageGroup, 'ageGroup');
    charts.push(new Chart(ageRef.current, {
      type: 'doughnut',
      data: {
        labels: ageEntries.map((item) => item.label),
        datasets: [{
          data: ageEntries.map((item) => item.count),
          backgroundColor: CHART_COLORS,
          borderColor: '#fff',
          borderWidth: 4,
          hoverOffset: 5,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 7, padding: 14, font: { size: 10 } } },
        },
      },
    }));

    const frequencyEntries = entriesFor(data.demographics.usageFrequency, 'usageFrequency');
    charts.push(new Chart(frequencyRef.current, {
      type: 'bar',
      data: {
        labels: frequencyEntries.map((item) => item.label),
        datasets: [{
          label: 'Người dùng',
          data: frequencyEntries.map((item) => item.count),
          backgroundColor: ['#427d5f', '#6aa181', '#99bfa7', '#d5e2d9'],
          borderRadius: 7,
          borderSkipped: false,
          maxBarThickness: 38,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: grid }, ticks: { precision: 0 } },
        },
      },
    }));

    return () => charts.forEach((chart) => chart.destroy());
  }, [data]);

  return (
    <div className="survey-charts-grid">
      <ChartPanel title="Nhịp độ phản hồi" description="Số lượt gửi và điểm trung bình theo ngày" icon="fa-arrow-trend-up">
        <div className="survey-chart survey-chart--trend"><canvas ref={trendRef} role="img" aria-label="Biểu đồ phản hồi theo ngày" /></div>
      </ChartPanel>
      <ChartPanel title="Chất lượng theo nhóm" description="So sánh 7 khía cạnh trải nghiệm" icon="fa-bullseye">
        <div className="survey-chart"><canvas ref={sectionRef} role="img" aria-label="Biểu đồ điểm theo nhóm câu hỏi" /></div>
      </ChartPanel>
      <ChartPanel title="Cơ cấu độ tuổi" description="Phân bổ người tham gia khảo sát" icon="fa-users">
        <div className="survey-chart"><canvas ref={ageRef} role="img" aria-label="Biểu đồ cơ cấu độ tuổi" /></div>
      </ChartPanel>
      <ChartPanel title="Tần suất sử dụng" description="Mức độ quay lại ứng dụng" icon="fa-calendar-days">
        <div className="survey-chart"><canvas ref={frequencyRef} role="img" aria-label="Biểu đồ tần suất sử dụng" /></div>
      </ChartPanel>
    </div>
  );
}

export default function SurveyAnalyticsPage() {
  const [phase, setPhase] = useState('loading');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const router = useRouter();
  const showToast = useToast();

  const rankedQuestions = useMemo(
    () => [...(data?.questionScores || [])].filter((item) => item.responses > 0).sort((a, b) => a.average - b.average),
    [data]
  );

  async function loadAnalytics() {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) {
      router.push('/signin');
      return;
    }

    setPhase('loading');
    setError('');
    try {
      const whoamiResponse = await fetch('/api/admin?action=whoami', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (whoamiResponse.status === 401) {
        router.push('/signin');
        return;
      }
      const whoami = await whoamiResponse.json();
      if (!whoami.isAdmin) {
        setPhase('denied');
        return;
      }

      const response = await fetch('/api/survey', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Không tải được dữ liệu khảo sát.');
      setData(payload.data);
      setPhase('ready');
    } catch (loadError) {
      setError(loadError.message);
      setPhase('error');
      showToast(loadError.message, 'error');
    }
  }

  useEffect(() => {
    loadAnalytics();
    // Chỉ kiểm tra quyền và tải dữ liệu một lần khi mở trang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'loading') {
    return (
      <PageShell variant="survey-admin">
        <div className="survey-admin-state">
          <span className="survey-admin-spinner" />
          <h2>Đang tổng hợp dữ liệu khảo sát</h2>
          <p>Hệ thống đang kiểm tra quyền và tính toán báo cáo.</p>
        </div>
      </PageShell>
    );
  }

  if (phase === 'denied') {
    return (
      <PageShell variant="survey-admin">
        <div className="survey-admin-state">
          <span className="survey-admin-state__icon"><i className="fa-solid fa-lock" /></span>
          <h2>Khu vực dành riêng cho quản trị viên</h2>
          <p>Tài khoản hiện tại không có quyền xem dữ liệu khảo sát.</p>
        </div>
      </PageShell>
    );
  }

  if (phase === 'error') {
    return (
      <PageShell variant="survey-admin">
        <div className="survey-admin-state">
          <span className="survey-admin-state__icon survey-admin-state__icon--error"><i className="fa-solid fa-triangle-exclamation" /></span>
          <h2>Chưa thể tải báo cáo</h2>
          <p>{error}</p>
          <button type="button" onClick={loadAnalytics}><i className="fa-solid fa-rotate" /> Thử lại</button>
        </div>
      </PageShell>
    );
  }

  const summary = data.summary;
  const noResponses = summary.totalResponses === 0;
  const bestSection = [...data.sectionScores].sort((a, b) => b.average - a.average)[0];
  const weakestSection = [...data.sectionScores].filter((item) => item.average > 0).sort((a, b) => a.average - b.average)[0];

  return (
    <PageShell variant="survey-admin">
      <div className="survey-admin">
        <header className="survey-admin-hero">
          <div>
            <span className="survey-admin-eyebrow"><i className="fa-solid fa-wave-square" /> Customer intelligence</span>
            <h1>Thống kê khảo sát</h1>
            <p>Góc nhìn tập trung về mức độ hài lòng, chân dung người dùng và các điểm cần ưu tiên cải thiện.</p>
          </div>
          <button type="button" onClick={loadAnalytics}><i className="fa-solid fa-arrows-rotate" /> Làm mới dữ liệu</button>
        </header>

        <section className="survey-kpis" aria-label="Chỉ số tổng quan">
          {[
            ['fa-clipboard-check', 'Tổng phản hồi', summary.totalResponses.toLocaleString('vi-VN'), `${summary.responsesLast30Days} lượt trong 30 ngày`, 'green'],
            ['fa-star', 'Điểm hài lòng', summary.averageScore.toFixed(2), 'trên thang điểm 5', 'gold'],
            ['fa-thumbs-up', 'Tỷ lệ tích cực', `${summary.positiveRate.toFixed(1)}%`, 'câu trả lời đạt 4 – 5 điểm', 'blue'],
            ['fa-bullhorn', 'Sẵn sàng giới thiệu', summary.recommendationScore.toFixed(2), 'điểm trung bình câu giới thiệu', 'rose'],
          ].map(([icon, label, value, note, tone]) => (
            <article className={`survey-kpi survey-kpi--${tone}`} key={label}>
              <span className="survey-kpi__icon"><i className={`fa-solid ${icon}`} /></span>
              <div>
                <p>{label}</p>
                <strong>{value}</strong>
                <small>{note}</small>
              </div>
            </article>
          ))}
        </section>

        {noResponses ? (
          <section className="survey-empty">
            <span><i className="fa-solid fa-chart-simple" /></span>
            <h2>Chưa có phản hồi khảo sát</h2>
            <p>Biểu đồ sẽ tự động hiển thị ngay khi người dùng hoàn thành form tại trang Review.</p>
          </section>
        ) : (
          <>
            <SurveyCharts data={data} />

            <section className="survey-insights">
              <div className="survey-insight survey-insight--positive">
                <span><i className="fa-solid fa-arrow-trend-up" /></span>
                <div>
                  <p>Điểm mạnh nổi bật</p>
                  <strong>{bestSection?.label || '—'}</strong>
                  <small>Đạt trung bình {bestSection?.average.toFixed(2) || '0.00'}/5</small>
                </div>
              </div>
              <div className="survey-insight survey-insight--attention">
                <span><i className="fa-solid fa-lightbulb" /></span>
                <div>
                  <p>Cơ hội cải thiện</p>
                  <strong>{weakestSection?.label || 'Chưa đủ dữ liệu'}</strong>
                  <small>{weakestSection ? `Đang ở mức ${weakestSection.average.toFixed(2)}/5` : 'Cần thêm phản hồi'}</small>
                </div>
              </div>
              <div className="survey-insight">
                <span><i className="fa-solid fa-user-check" /></span>
                <div>
                  <p>Mục tiêu phổ biến</p>
                  <strong>{entriesFor(data.demographics.primaryGoal, 'primaryGoal').sort((a, b) => b.count - a.count)[0]?.label || '—'}</strong>
                  <small>Nhóm mục tiêu có nhiều phản hồi nhất</small>
                </div>
              </div>
            </section>

            <div className="survey-detail-grid">
              <section className="survey-data-card">
                <div className="survey-data-card__head">
                  <div>
                    <span className="survey-admin-eyebrow">Priority list</span>
                    <h2>Câu hỏi cần ưu tiên</h2>
                  </div>
                  <span className="survey-data-card__badge">Thấp nhất trước</span>
                </div>
                <div className="survey-priority-list">
                  {rankedQuestions.slice(0, 6).map((question, index) => (
                    <div className="survey-priority" key={question.id}>
                      <span className="survey-priority__rank">{index + 1}</span>
                      <div>
                        <small>{question.sectionLabel}</small>
                        <p>{question.text}</p>
                      </div>
                      <strong className={question.average < 3.5 ? 'low' : ''}>{question.average.toFixed(2)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="survey-data-card">
                <div className="survey-data-card__head">
                  <div>
                    <span className="survey-admin-eyebrow">Live feed</span>
                    <h2>Phản hồi gần đây</h2>
                  </div>
                  <span className="survey-data-card__badge">{data.recent.length} gần nhất</span>
                </div>
                <div className="survey-recent-list">
                  {data.recent.map((response) => (
                    <article className="survey-recent" key={response.id}>
                      <span className="survey-recent__avatar"><i className="fa-solid fa-user" /></span>
                      <div>
                        <strong>
                          {LABELS.ageGroup[response.ageGroup] || response.ageGroup}
                          <span> · </span>
                          {LABELS.primaryGoal[response.primaryGoal] || response.primaryGoal}
                        </strong>
                        <p>{response.comment || 'Không để lại góp ý mở.'}</p>
                        <small>{formatDate(response.submittedAt, true)}</small>
                      </div>
                      <span className="survey-recent__score">{response.averageScore.toFixed(1)}</span>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
