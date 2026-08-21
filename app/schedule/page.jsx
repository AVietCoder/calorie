'use client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PageShell from '../../components/PageShell';
import ActionButton from '../../components/ActionButton';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import { openNearbySearch } from '../../lib-client/nearby';
import {
  todayPlanDay, getTodayIntake, computeTodayTotals, isEaten, setEaten,
  isSkipped, setSkipped, addExtraFood, removeExtraFood, parseMacro, getWeekExtras,
} from '../../lib-client/todayIntake';
import '../../styles/schedule.css';

const DAY_HEADERS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MEAL_ROWS = [
  { id: 'morning', label: 'Sáng', key: 'sch.breakfast' },
  { id: 'lunch', label: 'Trưa', key: 'sch.lunch' },
  { id: 'evening', label: 'Tối', key: 'sch.dinner' },
  { id: 'snack', label: 'Phụ', key: 'sch.snack' },
];
/**
 * Nhãn bữa (do LLM sinh) → id hàng trong bảng.
 *
 * Trước đây là một object tra khớp CHÍNH XÁC `{ Sáng:'morning', … }`. Nhãn lại
 * do model sinh ra nên thỉnh thoảng lệch chuẩn, và mỗi lần lệch là ô đó hiện
 * dấu "-" dù dữ liệu vẫn nằm nguyên trong thực đơn. Quét dữ liệu thật: có bữa
 * lưu là `"**Tối**"` (lọt cú pháp in đậm của markdown), có bữa `undefined`, có
 * bữa bị bọc thành mảng `["Phụ"]`.
 *
 * Nguy hiểm hơn cái "-" là nó TỰ DUY TRÌ: phía API đối chiếu bữa bằng
 * `String(m.meal).trim().toLowerCase()` (xem slotKey trong coach-dynamic), nên
 * server coi tuần đó ĐÃ ĐỦ bữa và không bao giờ chạy bù — còn client thì mãi
 * mãi hiện ô trống. Nới cho client khoan dung đúng bằng server là hết.
 */
const MEAL_ID_BY_KEYWORD = [
  ['sáng', 'morning'],
  ['trưa', 'lunch'],
  ['tối', 'evening'],
  ['phụ', 'snack'],
  // Biến thể model hay dùng thay cho "Phụ".
  ['xế', 'snack'],
  ['nhẹ', 'snack'],
];

function mealRowId(meal) {
  // Mảng một phần tử vẫn xuất hiện trong dữ liệu đã lưu — lấy phần tử đầu.
  const raw = Array.isArray(meal) ? meal[0] : meal;
  const s = String(raw ?? '')
    .replace(/[*_`#]/g, '')   // rác markdown model để lọt: "**Tối**"
    .trim()
    .toLowerCase();
  if (!s) return null;
  // Khớp CHỨA chứ không bằng, để nuốt luôn "bữa sáng", "sáng sớm", "bữa phụ 1".
  for (const [kw, id] of MEAL_ID_BY_KEYWORD) if (s.includes(kw)) return id;
  return null;
}
/** Đã thử bù bữa thiếu trong phiên này chưa (chống gọi AI lại ở mọi lần mở trang). */
const HEAL_TRIED_KEY = 'calorie_sched_heal_tried';

function parseNum(val) {
  if (val == null || val === '' || val === 'N/A') return null;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}
function escapeHtmlSc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** Dùng chung với trang Danh sách đi chợ — xem lib-client/nearby.js. */
function searchFoodNearby(food) {
  openNearbySearch(`${food} gần đây`);
}
async function optimizeImageFile(file, targetPixels = 2097152, quality = 0.9) {
  try {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = (e) => res(e.target.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = dataUrl;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return file;
    const scale = Math.min(1, Math.sqrt(targetPixels / (w * h)));
    const nw = Math.max(1, Math.round(w * scale));
    const nh = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, nw, nh);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) return file;
    const base = (file.name || 'image').replace(/\.[^.]+$/, '');
    return new File([blob], base + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/* ═══════════════════════ Meal detail modal ═══════════════════════ */
function MealDetailModal({ item, pendingFood, onClose, onAction, t, localizeFood, router }) {
  const isToday = Number(item.day) === todayPlanDay();
  const skippedNow = isToday && isSkipped(item.day, item.meal);
  const [action, setAction] = useState(pendingFood ? 'change' : skippedNow ? 'skip' : 'eat');
  const [altFood, setAltFood] = useState(pendingFood || '');

  const p = parseNum(item.protein);
  const f = parseNum(item.fat);
  const c = parseNum(item.carbs);
  let pPct = 0, fPct = 0, cPct = 0;
  if (p != null && f != null && c != null) {
    const total = p * 4 + f * 9 + c * 4 || 1;
    pPct = (p * 4 / total) * 100;
    fPct = (f * 9 / total) * 100;
    cPct = (c * 4 / total) * 100;
  }
  const hasChart = p != null && f != null && c != null;

  function selectAction(next) {
    setAction(next);
    if (next === 'eat') { setAltFood(''); onAction('eat', ''); }
    else if (next === 'change') { onAction('change', altFood); }
    else if (next === 'skip') { setAltFood(''); onAction('skip', ''); }
  }

  function onAltInput(v) {
    setAltFood(v);
    onAction('change', v);
  }

  function goToChat() {
    if (item.food) window.sessionStorage.setItem('chatPrefill', `Cho tôi biết thêm về món ${item.food}`);
    router.push('/chat');
  }

  return (
    <div className="meal-modal-overlay open" id="meal-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="meal-modal" id="meal-modal">
        <div className="meal-modal-header">
          <div className="meal-modal-title">
            <h2>{localizeFood(item.food) || '—'}</h2>
            <div className="meal-badge"><i className="fa-solid fa-utensils" /><span>{item.meal || '—'}</span></div>
          </div>
          <button className="meal-modal-close" onClick={onClose}><i className="fa-solid fa-xmark" /></button>
        </div>

        <div className="meal-modal-body">
          <div className="meal-status-container">
            <div className="meal-action-group">
              <label className={`meal-action-opt eat${action === 'eat' ? ' sel' : ''}`}>
                <input type="radio" name="meal-action" checked={action === 'eat'} onChange={() => selectAction('eat')} />
                <span>{t('sch.opt_eat', 'Tôi sẽ ăn món này')}</span>
              </label>
              <label className={`meal-action-opt change${action === 'change' ? ' sel' : ''}`}>
                <input type="radio" name="meal-action" checked={action === 'change'} onChange={() => selectAction('change')} />
                <span>{t('sch.opt_change', 'Đổi sang món khác')}</span>
              </label>
              {isToday && (
                <label className={`meal-action-opt skip${action === 'skip' ? ' sel' : ''}`}>
                  <input type="radio" name="meal-action" checked={action === 'skip'} onChange={() => selectAction('skip')} />
                  <span>{t('sch.opt_skip', 'Tôi sẽ không ăn bữa này')}</span>
                </label>
              )}
            </div>
            {action === 'change' && (
              <>
                <input
                  type="text"
                  className="alt-food-input"
                  value={altFood}
                  autoFocus
                  onChange={(e) => onAltInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && altFood.trim()) onAction('save-and-close'); }}
                  placeholder={t('sch.alt_ph', 'Bạn muốn ăn món gì khác?')}
                />
                <div className="save-plan-footer">
                  <ActionButton
                    className="btn-save-all"
                    disabled={!altFood.trim()}
                    onClick={() => onAction('save-and-close')}
                    loadingText={t('common.saving', 'Đang lưu...')}
                  >
                    <i className="fa-solid fa-floppy-disk" /> <span>{t('sch.confirm_change', 'Xác nhận đổi món')}</span>
                  </ActionButton>
                  {!altFood.trim() && (
                    <div className="alt-hint">{t('sch.alt_hint', 'Nhập tên món bạn muốn đổi rồi bấm xác nhận')}</div>
                  )}
                </div>
              </>
            )}
            {action === 'skip' && (
              <div className="meal-skip-note" style={{ display: 'flex' }}>
                <i className="fa-solid fa-ban" /> <span>{t('sch.skip_saved', 'Đã đánh dấu bỏ bữa này')}</span>
              </div>
            )}
          </div>

          <div className="kcal-highlight">
            <div className="kcal-icon"><i className="fa-solid fa-fire-flame-curved" /></div>
            <div>
              <div className="kcal-num">{item.calories != null ? item.calories : '—'}</div>
              <div className="kcal-unit">kcal · <span style={{ color: 'var(--primary-deep)' }}>{item.amount || '—'}</span></div>
            </div>
          </div>

          {hasChart && (
            <div className="macro-chart-wrap">
              <div className="macro-chart-label">{t('sch.nutrition_struct', 'Cơ cấu dinh dưỡng')}</div>
              <div className="macro-bar-track">
                <div className="macro-bar-seg seg-protein" style={{ width: pPct.toFixed(1) + '%' }} />
                <div className="macro-bar-seg seg-fat" style={{ width: fPct.toFixed(1) + '%' }} />
                <div className="macro-bar-seg seg-carbs" style={{ width: cPct.toFixed(1) + '%' }} />
              </div>
              <div className="macro-legend">
                <div className="macro-legend-item"><div className="macro-legend-dot" style={{ background: '#5b9cf6' }} />Protein: <strong>{item.protein || '—'}</strong></div>
                <div className="macro-legend-item"><div className="macro-legend-dot" style={{ background: '#f5a623' }} />Chất béo: <strong>{item.fat || '—'}</strong></div>
                <div className="macro-legend-item"><div className="macro-legend-dot" style={{ background: '#7dc976' }} />Carbs: <strong>{item.carbs || '—'}</strong></div>
              </div>
            </div>
          )}

          <table className="nutrition-table">
            <tbody>
              <tr>
                <td><div className="nutrition-icon" style={{ background: '#edf4ff', color: '#5b9cf6' }}><i className="fa-solid fa-dumbbell" /></div>Protein</td>
                <td>{item.protein || '—'}</td>
              </tr>
              <tr>
                <td><div className="nutrition-icon" style={{ background: '#fff8ed', color: '#f5a623' }}><i className="fa-solid fa-droplet" /></div>Chất béo</td>
                <td>{item.fat || '—'}</td>
              </tr>
              <tr>
                <td><div className="nutrition-icon" style={{ background: '#f0faee', color: '#7dc976' }}><i className="fa-solid fa-wheat-awn" /></div>Carbohydrate</td>
                <td>{item.carbs || '—'}</td>
              </tr>
              {item.fiber && (
                <tr><td><div className="nutrition-icon" style={{ background: '#f5f0ff', color: '#9b7edb' }}><i className="fa-solid fa-seedling" /></div>Chất xơ</td><td>{item.fiber}</td></tr>
              )}
              {item.sugar && (
                <tr><td><div className="nutrition-icon" style={{ background: '#fff0f3', color: '#e07ca0' }}><i className="fa-solid fa-candy-cane" /></div>Đường</td><td>{item.sugar}</td></tr>
              )}
              {item.sodium && (
                <tr><td><div className="nutrition-icon" style={{ background: '#f0f4ff', color: '#7090d0' }}><i className="fa-solid fa-flask" /></div>Natri</td><td>{item.sodium}</td></tr>
              )}
            </tbody>
          </table>

          <div className="meal-modal-actions">
            <button className="btn-find" onClick={() => searchFoodNearby(item.food || '')}>
              <i className="fa-solid fa-location-dot" /> <span>{t('sch.find_near', 'Tìm quán gần đây')}</span>
            </button>
            <button className="btn-chat" onClick={goToChat}>
              <i className="fa-solid fa-comments" /> <span>{t('sch.ask_ai', 'Hỏi HLV AI')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════ Page ═══════════════════════ */
export default function SchedulePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // text | null
  const [tempPlan, setTempPlan] = useState([]);
  const [modifiedMap, setModifiedMap] = useState(new Map());
  const [dailyTarget, setDailyTarget] = useState({ calories: 0, macros: { protein: 0, fat: 0, carbs: 0 } });
  const [aiReplyHtml, setAiReplyHtml] = useState('');
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [modalItem, setModalItem] = useState(null);
  const [intakeVersion, setIntakeVersion] = useState(0);
  /**
   * Thứ trong tuần (1..7), 0 = CHƯA biết vì còn ở phía máy chủ.
   *
   * Không được tính bằng `todayPlanDay()` ngay trong thân render. Trang này
   * được Next prerender TĨNH lúc build, nên `new Date()` khi đó là ngày của máy
   * build: file .next/server/app/schedule.html đóng cứng class `today-col` vào
   * đúng cái thứ hôm build, và mọi người vào trang đều thấy highlight sai cột
   * cho tới khi React hydrate xong. Kiểm chứng thực tế: bản build hôm thứ Tư
   * sinh ra `day-header today-col">T4` nằm sẵn trong HTML, trong khi hôm sau
   * các ô "Đã ăn" lại nằm ở cột T5.
   *
   * Để 0 lúc dựng ở máy chủ ⇒ HTML tĩnh không gắn `today-col` vào cột nào, cũng
   * không dựng ô tick "Đã ăn" (chúng đều bám theo pday) ⇒ không còn lệch giữa
   * máy chủ và trình duyệt, và cột sáng lên luôn là hôm nay THẬT của người xem.
   */
  const [pday, setPday] = useState(0);
  const [extraForm, setExtraForm] = useState({ name: '', kcal: '', p: '', f: '', c: '' });
  const [extraPhotoPreview, setExtraPhotoPreview] = useState(null);
  const [extraAnalyzing, setExtraAnalyzing] = useState(false);
  const [extraAiResult, setExtraAiResult] = useState(null);
  const [extraFormOpen, setExtraFormOpen] = useState(false);
  const [extraNameFromAI, setExtraNameFromAI] = useState(false);
  const [aiEstimating, setAiEstimating] = useState(false);

  const extraPhotoInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const showToast = useToast();
  const { t, tn, localizeFood } = useTranslation();
  const router = useRouter();

  const bumpIntake = useCallback(() => setIntakeVersion((v) => v + 1), []);

  /* ── Load ───────────────────────────────────────────────────────── */
  useEffect(() => {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) { router.push('/signin'); return; }

    (async () => {
      try {
        const [statusRes, coachRes, dietRes] = await Promise.all([
          fetch('/api/status', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/coach-dynamic', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ isQueryOnly: true }),
          }),
          fetch('/api/diet-info', { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        if (!statusRes.ok) {
          showToast(t('toast.login_required', 'Vui lòng đăng nhập!'), 'info');
          setTimeout(() => router.push('/signin'), 1369);
          return;
        }
        const statusData = await statusRes.json();
        if (!statusData.is_setup_completed) { router.push('/setup'); return; }

        try {
          const dietData = await dietRes.json();
          if (dietData?.success && dietData.data) {
            setDailyTarget({
              calories: Number(dietData.data.calories) || 0,
              macros: {
                protein: Number(dietData.data.macros?.protein) || 0,
                fat: Number(dietData.data.macros?.fat) || 0,
                carbs: Number(dietData.data.macros?.carbs) || 0,
              },
            });
          }
        } catch {}

        const result = await coachRes.json();
        if (result.success) {
          setAiReplyHtml(result.reply || '');
          if (result.isDeadlinePassed) {
            setDeadlinePassed(true);
          } else if (result.newPlan && result.newPlan.length > 0) {
            setTempPlan(result.newPlan);
            setModifiedMap(new Map());
          }
          // Lượt load ở trên là CHỈ ĐỌC (isQueryOnly) nên trả về tức thì. Nếu thực
          // đơn còn trống/cũ/thiếu bữa thì mới chạy 1 lượt sinh trong NỀN — màn hình
          // đã hiện xong, người dùng không phải chờ AI.
          if (!result.isDeadlinePassed && result.needsGeneration) {
            // Trống/quá hạn tuần → luôn dựng lại. Chỉ THIẾU vài bữa → model có thể
            // không bao giờ bù đủ, nên chỉ thử 1 lần mỗi phiên để không bắn request
            // sinh plan ở MỌI lần mở trang.
            const onlyPatching = !result.planStale;
            const triedThisSession = window.sessionStorage.getItem(HEAL_TRIED_KEY) === '1';
            if (!onlyPatching || !triedThisSession) {
              if (onlyPatching) window.sessionStorage.setItem(HEAL_TRIED_KEY, '1');
              generatePlanInBackground(token);
            }
          }
        } else {
          console.error('Coach API error:', result);
          showToast(`Lỗi (${result.stage || 'unknown'}): ${result.error || 'Không rõ'}`, 'error');
        }
      } catch (err) {
        console.error('Lỗi kết nối HLV AI:', err);
        showToast(t('toast.coach_net_err', 'Lỗi kết nối HLV AI'), 'error');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Gọi HLV AI dựng/bù thực đơn — chạy SAU khi trang đã render, không chặn UI. */
  async function generatePlanInBackground(token) {
    setGenerating(true);
    try {
      const res = await fetch('/api/coach-dynamic', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // không isQueryOnly → cho phép gọi AI
      });
      const result = await res.json();
      if (!result.success) {
        showToast(result.error || t('toast.coach_gen_err', 'Chưa tạo được thực đơn, bạn thử lại sau nhé!'), 'error');
        return;
      }
      if (result.newPlan && result.newPlan.length > 0) {
        setTempPlan(result.newPlan);
        setModifiedMap(new Map());
        setAiReplyHtml(result.reply || '');
        showToast(t('toast.menu_updated', 'Đã cập nhật thực đơn mới từ AI!'), 'success');
      }
    } catch (err) {
      console.error('Lỗi tạo thực đơn nền:', err);
      showToast(t('toast.coach_net_err', 'Lỗi kết nối HLV AI'), 'error');
    } finally {
      setGenerating(false);
    }
  }

  /*
   * Chốt "hôm nay" ở phía trình duyệt, và tự chỉnh lại khi sang ngày mới.
   *
   * Hẹn đúng thời điểm nửa đêm chứ không lặp mỗi phút: trang này hay bị mở
   * xuyên đêm (đặt trên bàn bếp, tab ghim), mà không chỉnh lại thì cột sáng và
   * hàng tick "Đã ăn" vẫn nằm ở ngày hôm qua — người dùng tick vào ô của ngày
   * đã trôi qua.
   *
   * `visibilitychange` bù cho trường hợp trình duyệt bóp hẹn giờ ở tab nền
   * (máy ngủ, tab bị đóng băng) khiến hẹn giờ nửa đêm bắn muộn hoặc không bắn.
   */
  useEffect(() => {
    let timer;
    const sync = () => {
      setPday(todayPlanDay());
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      clearTimeout(timer);
      // +1s để chắc chắn đã bước hẳn sang ngày mới khi hàm chạy lại.
      timer = setTimeout(sync, midnight.getTime() - now.getTime() + 1000);
    };
    const onWake = () => { if (!document.hidden) sync(); };

    sync();
    document.addEventListener('visibilitychange', onWake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, []);

  useEffect(() => {
    function onVisible() { if (!document.hidden) refreshIfDirty(); }
    function onFocus() { refreshIfDirty(); }
    function onStorage(e) { if (e.key === 'calorie_plan_dirty') refreshIfDirty(); }
    function refreshIfDirty() {
      try {
        const dirty = window.localStorage.getItem('calorie_plan_dirty');
        if (dirty && dirty !== window.sessionStorage.getItem('calorie_sched_seen')) {
          window.sessionStorage.setItem('calorie_sched_seen', dirty);
          bumpIntake();
          window.location.reload();
        }
      } catch {}
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [bumpIntake]);

  /* ── Meal modal actions ────────────────────────────────────────── */
  function openModal(item) { setModalItem(item); }
  function closeModal() { setModalItem(null); }

  function handleModalAction(kind, altFood) {
    if (!modalItem) return;
    const key = `${modalItem.day}-${modalItem.meal}`;
    const pday = todayPlanDay();
    const isToday = Number(modalItem.day) === pday;

    if (kind === 'eat') {
      setModifiedMap((prev) => { const n = new Map(prev); n.delete(key); return n; });
      if (isToday) { setSkipped(modalItem.day, modalItem.meal, false); bumpIntake(); }
    } else if (kind === 'change') {
      if (isToday) { setSkipped(modalItem.day, modalItem.meal, false); bumpIntake(); }
      setModifiedMap((prev) => {
        const n = new Map(prev);
        if (altFood && altFood.trim()) n.set(key, { day: modalItem.day, meal: modalItem.meal, food: altFood.trim() });
        else n.delete(key);
        return n;
      });
    } else if (kind === 'skip') {
      setModifiedMap((prev) => { const n = new Map(prev); n.delete(key); return n; });
      setSkipped(modalItem.day, modalItem.meal, true);
      bumpIntake();
      showToast(t('sch.skip_saved', 'Đã đánh dấu bỏ bữa này'), 'info');
    } else if (kind === 'save-and-close') {
      closeModal();
    }
  }

  async function submitPlanChanges() {
    const modifiedMeals = Array.from(modifiedMap.values());
    if (modifiedMeals.length === 0) {
      showToast(t('toast.no_change', 'Bạn chưa thay đổi món nào'), 'info');
      return;
    }
    const token = window.localStorage.getItem('calorie_ai_token');
    closeModal();
    setSaving(t('toast.recalc', 'Đang tính lại dinh dưỡng món bạn đổi...'));

    try {
      const res = await fetch('/api/coach-dynamic', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_plan', modifiedMeals }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || t('toast.update_ok', 'Đã cập nhật & tính lại dinh dưỡng!'), 'success');
        setModifiedMap(new Map());
        setSaving(t('toast.reload_plan', 'Đang tải lại lộ trình mới...'));
        window.location.reload();
      } else {
        setSaving(null);
        console.error('Update plan failed:', data);
        showToast(`Lỗi (${data.stage || 'unknown'}): ${data.error || 'Không rõ'}`, 'error');
      }
    } catch (err) {
      setSaving(null);
      console.error('Network error:', err);
      showToast(t('toast.save_net_err', 'Lỗi kết nối khi lưu'), 'error');
    }
  }

  const hasPendingChanges = modifiedMap.size > 0;

  /* ── Today intake (recomputed from localStorage on every intakeVersion bump) ──
   *
   * `pday > 0` nghĩa là đã chạy ở trình duyệt (xem chú thích chỗ khai báo pday).
   * Hai hàm dưới đều đọc localStorage, mà lúc prerender tĩnh thì không có
   * localStorage nên chúng trả về rỗng — dựng thẳng ra HTML sẽ lệch với lần
   * render đầu ở trình duyệt: vòng calo và danh sách "món ngoài thực đơn" nhấp
   * nháy đổi số. Chờ tới khi ở trình duyệt rồi mới đọc.
   */
  /**
   * Số ô trống trong bảng 7 ngày × 4 bữa.
   *
   * Đếm theo ĐÚNG cách bảng dựng ô (cùng mealRowId) chứ không đếm phần tử trong
   * tempPlan: một bữa có nhãn lạ mà mealRowId không nhận vẫn nằm trong mảng
   * nhưng không lên được bảng — đếm kiểu kia sẽ báo "đủ" trong khi mắt người
   * dùng thấy ô trống.
   */
  const missingCount = (() => {
    if (!tempPlan.length) return 0;   // chưa có thực đơn thì không phải "thiếu"
    let n = 0;
    for (let d = 1; d <= 7; d++) {
      for (const row of MEAL_ROWS) {
        if (!tempPlan.some((p2) => Number(p2.day) === d && mealRowId(p2.meal) === row.id)) n++;
      }
    }
    return n;
  })();

  /** Bù bữa thiếu theo yêu cầu của người dùng — dùng lại đúng lượt sinh nền. */
  async function fillMissingMeals() {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) return;
    // Người dùng tự bấm thì bỏ chốt "mỗi phiên một lần" — chốt đó chỉ để chặn
    // việc TỰ ĐỘNG gọi lại ở mọi lần mở trang.
    try { window.sessionStorage.removeItem(HEAL_TRIED_KEY); } catch {}
    await generatePlanInBackground(token);
  }

  const clientReady = pday > 0;
  const EMPTY_TOTALS = { calories: 0, protein: 0, fat: 0, carbs: 0, count: 0 };
  const totals = clientReady ? computeTodayTotals(tempPlan) : EMPTY_TOTALS;
  const target = dailyTarget.calories || 0;
  const tMac = dailyTarget.macros || { protein: 0, fat: 0, carbs: 0 };
  const consumed = Math.round(totals.calories);
  const diff = target - consumed;
  const ringC = 2 * Math.PI * 52;
  const ringPct = target > 0 ? Math.min(1, consumed / target) : 0;
  const extras = clientReady ? (getTodayIntake().day.extras || []) : [];
  /* Món thêm của cả tuần, để bảng 7 ngày xếp vào đúng cột. Cùng lý do
     `clientReady` như trên: đọc localStorage lúc prerender là lệch máy chủ. */
  const weekExtras = clientReady ? getWeekExtras() : {};
  const hasWeekExtras = Object.keys(weekExtras).length > 0;

  function toggleEaten(item, checked) {
    /* Ghi vào NGÀY CỦA CHÍNH Ô ĐÓ, không phải hôm nay.
       Trước đây luôn dùng todayPlanDay() nên tick vào ô ngày khác sẽ ghi nhầm
       sang hôm nay — giờ ô của những ngày đã qua cũng tick được. */
    setEaten(Number(item.day) || todayPlanDay(), item.meal, checked, item);
    bumpIntake();
  }

  function deleteExtra(id) {
    removeExtraFood(id);
    bumpIntake();
  }

  function addExtra() {
    const name = extraForm.name.trim();
    if (!name) { showToast(t('extra.need_name', 'Vui lòng nhập tên món'), 'error'); return; }
    addExtraFood({
      id: 'ex_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name,
      calories: parseMacro(extraForm.kcal),
      protein: parseMacro(extraForm.p),
      fat: parseMacro(extraForm.f),
      carbs: parseMacro(extraForm.c),
    });
    setExtraForm({ name: '', kcal: '', p: '', f: '', c: '' });
    setExtraPhotoPreview(null);
    setExtraAiResult(null);
    setExtraNameFromAI(false);
    bumpIntake();
    showToast(t('extra.added', 'Đã thêm vào hôm nay!'), 'success');
  }

  async function estimateExtraFoodAI() {
    const name = extraForm.name.trim();
    if (!name) { showToast(t('extra.need_name', 'Vui lòng nhập tên món'), 'error'); return; }
    setAiEstimating(true);
    try {
      const token = window.localStorage.getItem('calorie_ai_token');
      const res = await fetch('/api/coach-dynamic', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'estimate_food', food: name }),
      });
      const data = await res.json();
      if (data.success && data.food) {
        const f = data.food;
        setExtraForm((prev) => ({
          ...prev,
          kcal: f.calories != null ? String(Math.round(f.calories)) : '',
          p: parseMacro(f.protein) ? String(Math.round(parseMacro(f.protein))) : '',
          f: parseMacro(f.fat) ? String(Math.round(parseMacro(f.fat))) : '',
          c: parseMacro(f.carbs) ? String(Math.round(parseMacro(f.carbs))) : '',
          name: f.food || prev.name,
        }));
        if (f.food) setExtraNameFromAI(true);
        if (f.confidence === 'low') showToast(t('extra.low_conf', 'Giá trị chỉ mang tính ước lượng.'), 'info');
      } else {
        showToast(data.error || t('toast.estimate_fail', 'Không ước tính được'), 'error');
      }
    } catch (e) {
      console.error(e);
      showToast(t('toast.estimate_net_err', 'Lỗi kết nối khi ước tính'), 'error');
    } finally {
      setAiEstimating(false);
    }
  }

  async function analyzeExtraPhoto(file) {
    if (!file) return;
    if (extraNameFromAI) { setExtraForm({ name: '', kcal: '', p: '', f: '', c: '' }); setExtraNameFromAI(false); }
    try { setExtraPhotoPreview(URL.createObjectURL(file)); } catch {}
    setExtraAnalyzing(true);
    setExtraAiResult(null);

    try {
      const token = window.localStorage.getItem('calorie_ai_token');
      if (!token) { showToast(t('common.session_expired', 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.'), 'error'); return; }

      const optimized = await optimizeImageFile(file);
      const fd = new FormData();
      fd.append('image', optimized);
      if (extraForm.name.trim()) fd.append('note', extraForm.name.trim());

      const res = await fetch('/api/analyze-food', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      if (!res.ok) {
        if (res.status === 401) { showToast(t('common.session_expired', 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.'), 'error'); return; }
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || t('extra.server_err', 'Lỗi server ({status}). Thử lại nhé!').replace('{status}', res.status), 'error');
        return;
      }
      const data = await res.json();
      if (data.notFood || data.is_food === false) {
        showToast(data.error || t('extra.not_food', 'Ảnh không phải món ăn — hãy chụp lại nhé!'), 'error');
        return;
      }
      if (!data.success || !data.food) {
        showToast(data.error || t('extra.photo_fail', 'Không phân tích được ảnh. Thử lại nhé!'), 'error');
        return;
      }
      const f = data.food;
      const foodName = (f.food || f.description || f.name || '').trim();
      setExtraForm({
        name: foodName,
        kcal: f.calories != null ? String(Math.round(f.calories)) : '',
        p: parseMacro(f.protein) ? String(Math.round(parseMacro(f.protein))) : '',
        f: parseMacro(f.fat) ? String(Math.round(parseMacro(f.fat))) : '',
        c: parseMacro(f.carbs) ? String(Math.round(parseMacro(f.carbs))) : '',
      });
      setExtraNameFromAI(true);
      setExtraAiResult({
        name: foodName,
        cals: f.calories != null ? Math.round(f.calories) : '?',
        proG: parseMacro(f.protein) ? Math.round(parseMacro(f.protein)) + 'g' : '?',
        fatG: parseMacro(f.fat) ? Math.round(parseMacro(f.fat)) + 'g' : '?',
        carbG: parseMacro(f.carbs) ? Math.round(parseMacro(f.carbs)) + 'g' : '?',
        lowConf: f.confidence === 'low',
      });
      showToast(t('extra.detected', 'Nhận diện') + ': ' + (foodName || '?') + ' · ' + (f.calories != null ? Math.round(f.calories) : '?') + ' kcal', 'success');
    } catch (e) {
      console.error('[analyzeExtraPhoto]', e);
      showToast(t('extra.photo_net_err', 'Không phân tích được ảnh. Kiểm tra kết nối mạng nhé!'), 'error');
    } finally {
      setExtraAnalyzing(false);
    }
  }

  useEffect(() => {
    function onPaste(e) {
      if (!extraFormOpen) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); analyzeExtraPhoto(file); }
          break;
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraFormOpen, extraForm.name, extraNameFromAI]);

  /* ── Render ─────────────────────────────────────────────────────── */
  const kcalLabel = t('common.kcal', 'kcal');

  return (
    <PageShell>
      {modalItem && (
        <MealDetailModal
          item={modalItem}
          pendingFood={modifiedMap.get(`${modalItem.day}-${modalItem.meal}`)?.food}
          onClose={closeModal}
          onAction={(kind, altFood) => { handleModalAction(kind, altFood); if (kind === 'save-and-close') return submitPlanChanges(); }}
          t={t}
          localizeFood={localizeFood}
          router={router}
        />
      )}

      {saving && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(251,250,246,0.96)', backdropFilter: 'blur(6px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          <div className="typing-indicator" style={{ display: 'flex', gap: 6 }}><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--primary-deep)' }}>{saving}</div>
          <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>Vui lòng không đóng trang…</div>
        </div>
      )}

      <div className="schedule-hero">
        <div className="schedule-hero-text">
          <div className="schedule-hero-icon"><i className="fa-solid fa-calendar-week" /></div>
          <div>
            <h1>{t('sch.hero_title', 'Lộ trình thực đơn của bạn')}</h1>
            <p>{t('sch.hero_desc', 'AI lên lịch 7 ngày dựa trên mục tiêu, khẩu vị và cường độ vận động')}</p>
          </div>
        </div>
      </div>

      {/* Today intake */}
      <div className="card today-intake-card">
        <div className="ti-head">
          <div>
            <h3><i className="fa-solid fa-bolt" /> <span>{t('today.title', 'Hôm nay bạn đã nạp')}</span></h3>
            <p>{t('today.subtitle', 'Tổng năng lượng & dinh dưỡng đã ăn trong ngày')}</p>
          </div>
          <div className="ti-ring">
            <svg viewBox="0 0 120 120">
              <circle className="ti-ring-bg" cx="60" cy="60" r="52" />
              <circle className="ti-ring-fg" cx="60" cy="60" r="52" style={{ strokeDasharray: `${ringC}`, strokeDashoffset: `${ringC * (1 - ringPct)}`, stroke: diff < 0 ? 'var(--danger)' : 'var(--primary)' }} />
            </svg>
            <div className="ti-ring-center">
              <div className="ti-ring-num">{consumed.toLocaleString()}</div>
              <div className="ti-ring-sub">{target.toLocaleString()} {kcalLabel}</div>
            </div>
          </div>
        </div>

        <div className="ti-summary">
          <div className="ti-chip"><span>{t('today.consumed', 'Đã nạp')}</span><b>{consumed.toLocaleString()} {kcalLabel}</b></div>
          <div className="ti-chip"><span>{t('today.target', 'Mục tiêu')}</span><b>{target.toLocaleString()} {kcalLabel}</b></div>
          <div className={`ti-chip${diff < 0 ? ' over' : ''}`}>
            <span>{diff >= 0 ? t('today.remaining', 'Còn lại') : t('today.over', 'Vượt mức')}</span>
            <b>{Math.abs(diff).toLocaleString()} {kcalLabel}</b>
          </div>
        </div>

        <div className="ti-macros">
          {[
            { key: 'chat.protein', fb: 'Protein', val: totals.protein, tgt: tMac.protein, cls: 'p' },
            { key: 'chat.fat', fb: 'Chất béo', val: totals.fat, tgt: tMac.fat, cls: 'f' },
            { key: 'chat.carbs', fb: 'Carbs', val: totals.carbs, tgt: tMac.carbs, cls: 'c' },
          ].map((m) => {
            const v = Math.round(m.val), tg = Math.round(m.tgt || 0);
            const pct = tg > 0 ? Math.min(100, (v / tg) * 100) : 0;
            return (
              <div className="ti-macro" key={m.cls}>
                <div className="ti-macro-top"><span>{t(m.key, m.fb)}</span><span>{v} / {tg}g</span></div>
                <div className="ti-macro-bar"><div className={`ti-macro-fill ${m.cls}`} style={{ width: pct + '%' }} /></div>
              </div>
            );
          })}
        </div>

        {totals.count === 0 && <div className="ti-empty">{t('today.no_meal', 'Bạn chưa đánh dấu bữa nào hôm nay. Tick "Đã ăn" ở từng bữa để theo dõi.')}</div>}

        {/* Extra food */}
        <div className="extra-block">
          <button type="button" className={`extra-toggle${extraFormOpen ? ' open' : ''}`} onClick={() => setExtraFormOpen((o) => !o)}>
            <i className="fa-solid fa-plus" /> <span>{t('extra.add_btn', 'Thêm món ăn ngoài thực đơn')}</span>
          </button>

          {extraFormOpen && (
            <div className="extra-form">
              <p className="extra-desc">{t('extra.desc', 'Ăn vặt, trái cây, đồ uống… ngoài thực đơn? Thêm vào đây để tính vào tổng hôm nay.')}</p>

              <div className={`extra-photo-drop-zone${dragOver ? ' drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const file = e.dataTransfer?.files?.[0]; if (file && file.type.startsWith('image/')) analyzeExtraPhoto(file); }}
              >
                <div className="extra-photo-drop-inner">
                  <button type="button" className="btn-extra-photo" onClick={() => extraPhotoInputRef.current?.click()}>
                    <i className="fa-solid fa-camera" /> <span>{t('extra.upload_photo', 'Tải ảnh món ăn')}</span>
                  </button>
                  <span className="extra-photo-hint">hoặc kéo thả / dán ảnh vào đây <kbd>Ctrl+V</kbd></span>
                  <input ref={extraPhotoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const file = e.target.files?.[0]; if (file) analyzeExtraPhoto(file); e.target.value = ''; }} />
                </div>
              </div>

              {extraPhotoPreview && (
                <div className="extra-photo-preview" style={{ display: 'block' }}>
                  <div className="extra-photo-preview-inner">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img id="extra-photo-img" alt="" src={extraPhotoPreview} style={{ opacity: extraAnalyzing ? 0.5 : 1 }} />
                    <button type="button" className="extra-photo-remove" title="Xoá ảnh" onClick={() => { setExtraPhotoPreview(null); setExtraAiResult(null); if (extraNameFromAI) { setExtraForm({ name: '', kcal: '', p: '', f: '', c: '' }); setExtraNameFromAI(false); } }}>
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </div>
                </div>
              )}

              {extraAiResult && (
                <div style={{ background: 'var(--sage-50,#f3f7f1)', border: '1.5px solid var(--primary,#4a7c59)', borderRadius: 10, padding: '10px 13px', margin: '8px 0 4px', fontSize: 13, lineHeight: 1.7 }}>
                  <div style={{ fontWeight: 700, color: 'var(--primary-deep,#2d5a3d)', marginBottom: 2 }}><i className="fa-solid fa-utensils" style={{ marginRight: 5 }} />{extraAiResult.name}</div>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <span><i className="fa-solid fa-fire-flame-curved" style={{ color: '#e8743b', marginRight: 4 }} /><b>{extraAiResult.cals} kcal</b></span>
                    <span>{t('chat.protein', 'Protein')} <b>{extraAiResult.proG}</b></span>
                    <span>{t('chat.fat', 'Chất béo')} <b>{extraAiResult.fatG}</b></span>
                    <span>{t('chat.carbs', 'Carbs')} <b>{extraAiResult.carbG}</b></span>
                  </div>
                  <div style={{ marginTop: 5, fontSize: 12, color: 'var(--text-sub,#888)' }}><i className="fa-solid fa-circle-check" style={{ color: 'var(--primary,#4a7c59)', marginRight: 4 }} />{t('extra.filled_note', 'Đã điền vào form — nhấn Thêm để lưu')}</div>
                  {extraAiResult.lowConf && <div style={{ marginTop: 4, fontSize: 12, color: '#b8860b' }}><i className="fa-solid fa-circle-info" style={{ marginRight: 4 }} />{t('extra.low_conf', 'Giá trị chỉ mang tính ước lượng.')}</div>}
                </div>
              )}

              <div className="extra-row">
                <div className="extra-field grow">
                  <label>{t('extra.name', 'Tên món')}</label>
                  <input type="text" value={extraForm.name} onChange={(e) => { setExtraForm((f) => ({ ...f, name: e.target.value })); setExtraNameFromAI(false); }} placeholder={t('extra.name_ph', 'VD: Táo, sữa chua, trà sữa...')} />
                </div>
                <div className="extra-field">
                  <label>{t('extra.kcal', 'Năng lượng (kcal)')}</label>
                  <input type="number" min="0" value={extraForm.kcal} onChange={(e) => setExtraForm((f) => ({ ...f, kcal: e.target.value }))} placeholder={t('extra.kcal_ph', 'VD: 95')} />
                </div>
              </div>
              <div className="extra-row extra-macros">
                <div className="extra-field"><label>Protein (g)</label><input type="number" min="0" value={extraForm.p} onChange={(e) => setExtraForm((f) => ({ ...f, p: e.target.value }))} /></div>
                <div className="extra-field"><label>{t('chat.fat', 'Chất béo')}</label><input type="number" min="0" value={extraForm.f} onChange={(e) => setExtraForm((f) => ({ ...f, f: e.target.value }))} /></div>
                <div className="extra-field"><label>Carbs (g)</label><input type="number" min="0" value={extraForm.c} onChange={(e) => setExtraForm((f) => ({ ...f, c: e.target.value }))} /></div>
              </div>
              <div className="extra-actions">
                <ActionButton type="button" className="btn-extra-ai" disabled={aiEstimating} onClick={estimateExtraFoodAI} loadingText={t('extra.estimating', 'AI đang ước tính...')}>
                  <i className="fa-solid fa-wand-magic-sparkles" /> {t('extra.estimate', 'Tự động tính bằng AI')}
                </ActionButton>
                <button type="button" className="btn-extra-add" onClick={addExtra}><i className="fa-solid fa-check" /> {t('common.add', 'Thêm')}</button>
              </div>
            </div>
          )}

          {extras.length > 0 && (
            <div className="extra-list-wrap">
              <div className="extra-list-title">{t('extra.list_title', 'Món thêm hôm nay')}</div>
              <div className="extra-list">
                {extras.map((ex) => (
                  <div key={ex.id} className="extra-item">
                    <div className="extra-item-main">
                      <div className="extra-item-name" dangerouslySetInnerHTML={{ __html: escapeHtmlSc(ex.name) }} />
                      <div className="extra-item-macro">P {Math.round(parseMacro(ex.protein))}g · F {Math.round(parseMacro(ex.fat))}g · C {Math.round(parseMacro(ex.carbs))}g</div>
                    </div>
                    <div className="extra-item-kcal">{Math.round(parseMacro(ex.calories)).toLocaleString()} {kcalLabel}</div>
                    <button className="extra-item-del" title="Xóa" onClick={() => deleteExtra(ex.id)}><i className="fa-solid fa-xmark" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div id="ai-menu-container" style={{ position: 'relative' }}>
        <div className="redirect-chat-card" onClick={() => router.push('/chat')}>
          <div className="redirect-chat-icon"><i className="fa-solid fa-comments" /></div>
          <div className="redirect-chat-content">
            <h3>{t('sch.coach_title', 'HLV Dinh Dưỡng AI')}</h3>
            <p>{t('sch.coach_desc', 'Trao đổi với AI để cập nhật thực đơn và theo dõi bữa ăn.')}</p>
          </div>
          <div className="redirect-chat-arrow"><i className="fa-solid fa-chevron-right" /></div>
        </div>

        <div className="card">
          <h3><i className="fa-solid fa-calendar-week" /> <span>{t('sch.week_title', 'Lộ trình thực đơn 7 ngày')}</span></h3>
          <div id="menu-content-area" style={{ position: 'relative' }}>
            {aiReplyHtml && <div id="ai-response-text"><div className="ai-reply-text"><i className="fa-solid fa-quote-left" /> {aiReplyHtml}</div></div>}

            {generating && (
              <div className="plan-generating" role="status" aria-live="polite">
                <span className="btn-spinner" aria-hidden="true" />
                <span>{t('sch.generating', 'HLV AI đang soạn thực đơn tuần — bạn cứ dùng trang bình thường, bảng sẽ tự cập nhật khi xong.')}</span>
              </div>
            )}

            {/*
              Thực đơn thiếu bữa mà AI KHÔNG còn tự bù.
              Lượt bù chỉ chạy MỘT lần mỗi phiên (xem HEAL_TRIED_KEY) để không
              bắn request sinh plan ở mọi lần mở trang — mặt trái là nếu lượt đó
              hụt thì bảng cứ thủng lỗ chỗ mãi, không nói vì sao và cũng không
              có cách nào thử lại. Nói thẳng còn thiếu bao nhiêu bữa và cho một
              nút bấm.
            */}
            {!generating && !deadlinePassed && missingCount > 0 && tempPlan.length > 0 && (
              <div className="plan-incomplete" role="status">
                <i className="fa-solid fa-circle-exclamation" />
                <span>
                  {tn('sch.incomplete', { n: missingCount },
                    `Thực đơn tuần còn thiếu ${missingCount} bữa nên bảng có ô để trống.`)}
                </span>
                <ActionButton
                  className="btn btn-secondary btn-sm"
                  onClick={fillMissingMeals}
                  loadingText={t('sch.filling', 'Đang bù…')}
                >
                  <i className="fa-solid fa-wand-magic-sparkles" /> {t('sch.fill_missing', 'Bù bữa còn thiếu')}
                </ActionButton>
              </div>
            )}

            <div className={`timetable-grid${deadlinePassed ? ' blur-content' : ''}`}>
              <div className="time-header">{t('sch.meal', 'Bữa')}</div>
              {DAY_HEADERS.map((d, i) => (
                <div key={d} className={`day-header${i + 1 === pday ? ' today-col' : ''}`}>{d}</div>
              ))}

              {MEAL_ROWS.map((row) => (
                <Fragment key={row.id}>
                  <div className="time-label">{t(row.key, row.label)}</div>
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                    const item = tempPlan.find((p2) => Number(p2.day) === day && mealRowId(p2.meal) === row.id);
                    const isToday = day === pday;
                    /* Ô chưa có món. Lúc AI đang soạn thì hiện ô chờ có nhịp
                       nhấp nháy thay vì dấu "-" trơ: bảng nửa đầy nửa gạch
                       ngang trông như hỏng, còn ô chờ nói rõ là đang chạy. */
                    if (!item) {
                      return (
                        <div
                          key={`${day}-${row.id}`}
                          className={`meal-cell${generating ? ' is-pending' : ''}`}
                          aria-label={generating
                            ? t('sch.cell_pending', 'Đang soạn bữa này')
                            : t('sch.cell_empty', 'Chưa có món')}
                        >
                          {generating ? <span className="cell-pending-bar" aria-hidden="true" /> : '-'}
                        </div>
                      );
                    }
                    /* Ngày đã qua và hôm nay đều đọc/sửa được trạng thái đã ăn;
                       ngày TƯƠNG LAI thì không, vì chưa ăn thì không có gì để
                       đánh dấu. `pday > 0` là cờ "đã chạy ở trình duyệt". */
                    const trackable = pday > 0 && day <= pday;
                    const skipped = trackable && isSkipped(day, item.meal);
                    const eaten = trackable && !skipped && isEaten(day, item.meal);
                    return (
                      <div
                        key={`${day}-${row.id}`}
                        /* has-mark = ô CÓ huy hiệu (đã ăn / bỏ bữa). CSS xếp dọc
                           bám vào class này chứ không bám .today-cell nữa, vì
                           huy hiệu giờ xuất hiện ở cả những ngày đã qua. */
                        className={`meal-cell has-data${isToday ? ' today-cell' : ''}${trackable ? ' has-mark' : ''}`}
                        style={{ border: '1.5px solid var(--primary-green)', background: 'linear-gradient(180deg, #ffffff, var(--sage-50))', position: 'relative', cursor: 'pointer' }}
                        onClick={(e) => { if (e.target.closest('.eaten-check') || e.target.closest('button[data-search]')) return; openModal(item); }}
                      >
                        <div className={`cell-inner${eaten ? ' is-eaten' : ''}${skipped ? ' is-skipped' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%', pointerEvents: 'none' }}>
                          <div style={{ fontWeight: 700, color: 'var(--primary-deep)', fontSize: 12, lineHeight: 1.3 }}>{localizeFood(item.food)}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-sub)' }}>{item.amount || '—'}</div>
                          <div style={{ marginTop: 2, fontWeight: 800, color: 'var(--primary)', fontSize: 11 }}>{item.calories != null && item.calories !== '' ? item.calories : '—'} kcal</div>
                        </div>
                        {skipped && <span className="skipped-badge"><i className="fa-solid fa-ban" />{t('sch.skipped_badge', 'Đã bỏ bữa')}</span>}
                        {trackable && !skipped && (
                          <label className={`eaten-check${eaten ? ' on' : ''}`} title={t('sch.eaten', 'Đã ăn')} onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={eaten} onChange={(e) => toggleEaten(item, e.target.checked)} />
                            <i className="fa-solid fa-check" /><span>{t('sch.eaten', 'Đã ăn')}</span>
                          </label>
                        )}
                        <button
                          data-search={item.food || ''}
                          title={`Tìm quán ${item.food || ''} gần đây`}
                          style={{ position: 'absolute', bottom: 6, right: 6, width: 22, height: 22, borderRadius: '50%', background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, opacity: 0.75, boxShadow: '0 2px 6px rgba(125,155,118,0.45)' }}
                          onClick={(e) => { e.stopPropagation(); searchFoodNearby(item.food || ''); }}
                        >
                          <i className="fa-solid fa-location-dot" style={{ fontSize: 9, pointerEvents: 'none' }} />
                        </button>
                      </div>
                    );
                  })}
                </Fragment>
              ))}

              {/*
                Hàng "Món thêm" — món người dùng tự nhập, xếp vào đúng cột ngày.

                Trước đây bảng chỉ vẽ thực đơn do AI sinh, nên món tự thêm không
                xuất hiện ở bất kỳ đâu trong bảng: nhìn vào tưởng hôm đó chưa ăn
                gì ngoài kế hoạch, dù vòng calo và trang phân tích đều đã tính.

                Chỉ dựng hàng này khi trong tuần thực sự có món thêm — không thì
                mọi người đều phải nhìn thêm một hàng trống suốt.
              */}
              {hasWeekExtras && (
                <Fragment key="extras">
                  <div className="time-label">{t('extra.row', 'Món thêm')}</div>
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                    const list = weekExtras[day] || [];
                    if (!list.length) return <div key={`x-${day}`} className="meal-cell">-</div>;
                    return (
                      <div
                        key={`x-${day}`}
                        className={`meal-cell has-data extra-cell${day === pday ? ' today-cell' : ''}`}
                      >
                        <div className="cell-inner extra-cell-inner">
                          {list.map((ex) => (
                            <div key={ex.id} className="extra-cell-item">
                              <span className="extra-cell-name">{ex.name}</span>
                              <span className="extra-cell-kcal">
                                {Math.round(parseMacro(ex.calories)).toLocaleString()} {kcalLabel}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </Fragment>
              )}
            </div>

            {deadlinePassed && (
              <div className="expired-overlay">
                <div className="congrat-card">
                  <i className="fa-solid fa-trophy" />
                  <h3>{t('plan.congrat_title', 'Chúc mừng bạn!')}</h3>
                  <p>{t('plan.congrat_body', 'Bạn đã hoàn thành xuất sắc chặng đường dinh dưỡng. Hãy cập nhật lại chỉ số mới để AI thiết kế lộ trình tiếp theo nhé!')}</p>
                  <button onClick={() => router.push('/setup?mode=extend')} className="meal-modal-btn primary" style={{ width: '100%' }}>{t('plan.congrat_btn', 'Tiếp tục chặng đường mới')}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="loading-overlay" style={{ position: 'fixed' }}>
          <div className="typing-indicator"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
        </div>
      )}
    </PageShell>
  );
}
