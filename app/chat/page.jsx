'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PageShell from '../../components/PageShell';
import { useAuth } from '../../lib-client/AuthContext';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/chat.css';

const DEFAULT_ANALYZE_TEXTS = ['Phân tích hình ảnh này', 'Analyze this image'];
const isDefaultAnalyzeText = (s) => DEFAULT_ANALYZE_TEXTS.includes(String(s || '').trim());
const DEFAULT_FOOD_IMG = 'https://i.pinimg.com/736x/9d/51/c3/9d51c32cccb77dcf89cc2fb11aa20a17.jpg';
const DEFAULT_SIDEBAR = { calories: 0, description: '', protein: '--', fat: '--', carbs: '--', fiber: '--', sugar: '--', sodium: '--', confidence: 'medium' };

// Hiển thị MỌI chỉ số dinh dưỡng dạng KHOẢNG (min - max) từ 1 giá trị điểm + độ
// tin cậy. Bề rộng tỉ lệ NGHỊCH confidence (high hẹp ~±9%, medium ~±16%, low ~±25%).
// Dùng chung cho kcal + protein/fat/carbs/fiber/sugar/sodium. Giữ nguyên "--"/rỗng.
const RANGE_WIDTH = { high: 0.18, medium: 0.32, low: 0.5 };
function metricRange(raw, confidence, calorie = false) {
  const s = String(raw ?? '').trim();
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return calorie ? (s || '0') : (s || '--');
  const val = parseFloat(m[0]);
  if (!Number.isFinite(val) || val <= 0) return calorie ? String(Math.round(val || 0)) : s;
  const unit = s.slice(m.index + m[0].length).trim(); // 'g' | 'mg' | ''
  const half = (RANGE_WIDTH[confidence] ?? RANGE_WIDTH.medium) / 2;
  const step = unit === 'mg' ? 10 : (calorie ? 5 : 1);
  let lo = Math.floor((val * (1 - half)) / step) * step;
  let hi = Math.ceil((val * (1 + half)) / step) * step;
  if (lo < 0) lo = 0;
  if (hi <= lo) hi = lo + step;
  return `${lo} - ${hi}${unit}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inlineMd(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function renderMarkdown(text) {
  const lines = escapeHtml(text).split('\n');
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const line of lines) {
    const h = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    const li = line.match(/^\s*[-*•]\s+(.+?)\s*$/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      out.push(`<h${lvl} class="md-h">${inlineMd(h[2])}</h${lvl}>`);
    } else if (li) {
      if (!inList) { out.push('<ul class="md-ul">'); inList = true; }
      out.push(`<li>${inlineMd(li[1])}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      out.push(`<div class="md-p">${inlineMd(line)}</div>`);
    }
  }
  closeList();
  return out.join('');
}

function cleanDisplayContent(raw) {
  let displayContent = String(raw ?? '').trim();
  displayContent = displayContent.replace(/<message>[\s\S]*?<\/message>/g, '');
  displayContent = displayContent.replace(/<data>[\s\S]*?<\/data>/g, '');
  displayContent = displayContent.replace(/<image>[\s\S]*?<\/image>/g, '');
  displayContent = displayContent.replace(/<error>[\s\S]*?<\/error>/g, '');
  displayContent = displayContent.replace(/<deleted>[\s\S]*?<deleted>/gi, '');
  const urlIndex = displayContent.indexOf('có url:');
  if (urlIndex !== -1) displayContent = displayContent.substring(0, urlIndex).trim();
  if (displayContent.includes('Nội dung cụ thể:')) {
    const parts = displayContent.split('Nội dung cụ thể:');
    const prefix = parts[0].trim();
    const suffix = parts[1].trim();
    displayContent = (prefix === suffix || suffix === '') ? prefix : suffix;
  }
  if (displayContent.includes('[XÁC NHẬN BỮA ĂN THỰC TẾ')) {
    const cutKeywords = ['YÊU CẦU BẮT BUỘC', 'Nếu không thể update'];
    for (const kw of cutKeywords) {
      const idx = displayContent.indexOf(kw);
      if (idx !== -1) { displayContent = displayContent.substring(0, idx).trim(); break; }
    }
  }
  return displayContent.replace(/\n{3,}/g, '\n\n').trim();
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

function MealModal({ onConfirm, onCancel, t }) {
  const [activeTime, setActiveTime] = useState(null);
  const [dayMode, setDayMode] = useState('today');
  const [customDate, setCustomDate] = useState(() => new Date().toISOString().split('T')[0]);
  const today = new Date().toISOString().split('T')[0];

  const times = [
    { val: 'Sáng', key: 'meal.breakfast', fallback: 'Sáng' },
    { val: 'Trưa', key: 'meal.lunch', fallback: 'Trưa' },
    { val: 'Tối', key: 'meal.dinner', fallback: 'Tối' },
    { val: 'Bữa phụ', key: 'meal.snack', fallback: 'Bữa phụ' },
  ];

  return (
    <div className="meal-inline-container">
      <div className="meal-interactive-card">
        <div className="meal-modal-title"><i className="fa-solid fa-utensils" /> <span>{t('meal.confirm_title', 'Xác nhận bữa ăn của bạn')}</span></div>
        <div className="meal-modal-section">
          <div className="meal-label">{t('meal.choose_time', 'Chọn buổi ăn')}</div>
          <div className="meal-choice-grid">
            {times.map((tm) => (
              <button key={tm.val} type="button" className={`meal-choice-btn${activeTime === tm.val ? ' active' : ''}`} onClick={() => setActiveTime(tm.val)}>
                {t(tm.key, tm.fallback)}
              </button>
            ))}
          </div>
        </div>
        <div className="meal-modal-section">
          <div className="meal-label">{t('meal.when', 'Thời điểm')}</div>
          <div className="meal-choice-grid">
            <button type="button" className={`meal-choice-btn day-btn${dayMode === 'today' ? ' active' : ''}`} onClick={() => setDayMode('today')}>{t('meal.today', 'Hôm nay')}</button>
            <button type="button" className={`meal-choice-btn day-btn${dayMode === 'other' ? ' active' : ''}`} onClick={() => setDayMode('other')}>{t('meal.other_day', 'Ngày khác')}</button>
          </div>
        </div>
        {dayMode === 'other' && (
          <div className="other-day-wrap">
            <input className="other-day-input" type="date" max={today} value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
          </div>
        )}
        <div className="meal-modal-actions">
          <button type="button" className="meal-modal-btn primary btn-confirm-meal" onClick={() => onConfirm(activeTime, dayMode, dayMode === 'today' ? 'today' : customDate)}>
            {t('meal.confirm', 'Xác nhận')}
          </button>
          <button type="button" className="meal-modal-btn secondary btn-cancel-meal" onClick={onCancel}>{t('meal.cancel', 'Hủy')}</button>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState([{ id: 'greeting', kind: 'text', role: 'bot', html: null, key: 'chat.greeting', fallback: 'Chào bạn! Hãy gửi tin nhắn hoặc ảnh món ăn, tôi sẽ phân tích giúp bạn.' }]);
  const [inputText, setInputText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [sidebar, setSidebar] = useState(DEFAULT_SIDEBAR);
  const [foodImg, setFoodImg] = useState(DEFAULT_FOOD_IMG);
  const [pastePreview, setPastePreview] = useState(null);
  const [isRecording, setIsRecording] = useState(false);

  const fileInputRef = useRef(null);
  const chatWindowRef = useRef(null);
  const pastedImageFileRef = useRef(null);
  const sessionPhotosRef = useRef([]);
  const lastNutritionDataRef = useRef(null);
  const flagRef = useRef(false);
  const sendingRef = useRef(false); // khoá chống double-send (spam click / giữ Enter)
  const voiceRecognitionRef = useRef(null);
  const msgIdRef = useRef(1);

  const { logout } = useAuth();
  const showToast = useToast();
  const { t, lang } = useTranslation();
  const router = useRouter();

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (chatWindowRef.current) chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
    });
  }

  function addMessage(msg) {
    const id = `m${msgIdRef.current++}`;
    setMessages((prev) => [...prev, { id, ...msg }]);
    scrollToBottom();
  }

  function renderBotOrUser(role, text) {
    const displayContent = cleanDisplayContent(text);
    if (String(text ?? '').trim().includes('<deleted please>')) return;
    addMessage({ kind: 'text', role, html: renderMarkdown(displayContent || 'Đang phân tích dữ liệu...') });
  }

  function updateSidebarFrom(data) {
    setSidebar({
      calories: data.calories || 0,
      description: data.description || '',
      protein: data.protein || '--',
      fat: data.fat || '--',
      carbs: data.carbs || '--',
      fiber: data.fiber || '--',
      sugar: data.sugar || '--',
      sodium: data.sodium || '--',
      confidence: data.confidence || 'medium',
    });
  }

  function clearNutritionValues() {
    setSidebar({ ...DEFAULT_SIDEBAR, description: t('chat.info_update', 'Thông tin sẽ cập nhật sau khi phân tích.') });
  }

  function resetSidebar() {
    setSidebar({ ...DEFAULT_SIDEBAR, description: 'Thông tin sẽ cập nhật sau khi phân tích.' });
    setFoodImg(DEFAULT_FOOD_IMG);
  }

  /* ── Voice recognition ─────────────────────────────────────────── */
  function initVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = true;
    rec.onstart = () => setIsRecording(true);
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join('');
      setInputText(transcript);
      if (e.results[e.results.length - 1].isFinal) stopRecognition();
    };
    rec.onerror = (e) => {
      stopRecognition();
      const msgs = {
        'not-allowed': t('chat.voice_denied', 'Vui lòng cấp quyền microphone.'),
        'no-speech': t('chat.voice_nospeech', 'Không nghe thấy gì, thử lại nhé.'),
        network: t('chat.voice_neterr', 'Lỗi mạng khi nhận giọng nói.'),
      };
      showToast(msgs[e.error] || 'Lỗi: ' + e.error, 'error');
    };
    rec.onend = () => stopRecognition();
    voiceRecognitionRef.current = rec;
    return rec;
  }

  function stopRecognition() {
    setIsRecording(false);
    try { voiceRecognitionRef.current?.stop(); } catch {}
  }

  function cancelVoice() {
    stopRecognition();
    setInputText('');
  }

  function confirmVoice() {
    stopRecognition();
  }

  function toggleVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast(t('chat.voice_unsupported', 'Trình duyệt của bạn không hỗ trợ nhận giọng nói.'), 'error');
      return;
    }
    if (isRecording) { confirmVoice(); return; }
    const rec = voiceRecognitionRef.current || initVoice();
    rec.lang = lang === 'en' ? 'en-US' : 'vi-VN';
    try { rec.start(); } catch { const rec2 = initVoice(); rec2.lang = lang === 'en' ? 'en-US' : 'vi-VN'; rec2.start(); }
  }

  useEffect(() => {
    if (isRecording) confirmVoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  /* ── Paste / file upload ───────────────────────────────────────── */
  function handlePastedImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64Data = e.target.result;
      setFoodImg(base64Data);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          pastedImageFileRef.current = new File([blob], 'pasted-image.jpg', { type: 'image/jpeg' });
          setPastePreview(base64Data);
          setInputText((cur) => (cur.trim() ? cur : t('chat.analyze_image', 'Phân tích hình ảnh này')));
          showToast(t('chat.pasted_image', 'Đã dán ảnh! Nhấn Gửi để phân tích.'), 'info');
        }, 'image/jpeg', 0.92);
      };
      img.src = base64Data;
    };
    reader.readAsDataURL(file);
  }

  function removePastePreview() {
    setPastePreview(null);
    pastedImageFileRef.current = null;
    setFoodImg(DEFAULT_FOOD_IMG);
    setInputText((cur) => (isDefaultAnalyzeText(cur) ? '' : cur));
  }

  function handleFileSelect() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.jpg') && !file.name.toLowerCase().endsWith('.jpeg')) {
      showToast(t('chat.jpg_only', 'Chỉ được gửi ảnh JPG!'), 'error');
      fileInputRef.current.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setFoodImg(e.target.result);
      setInputText(t('chat.analyze_image', 'Phân tích hình ảnh này'));
    };
    reader.readAsDataURL(file);
  }

  /* ── Meal modal flow ───────────────────────────────────────────── */
  function openMealModal(mealData) {
    addMessage({ kind: 'meal-modal', mealData });
  }

  function cancelMealModal(id) {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    renderBotOrUser('bot', t('meal.cancelled', 'Đã hủy. Bạn có thể nhập món khác.'));
  }

  async function confirmMealModal(id, mealData, mealTime, dayMode, dayValue) {
    if (!mealTime) { showToast(t('meal.pick_time', 'Hãy chọn buổi ăn'), 'info'); return; }
    setMessages((prev) => prev.filter((m) => m.id !== id));
    await submitMealUpdate(mealData, mealTime, dayMode, dayValue);
  }

  async function submitMealUpdate(mealData, mealTime, dayMode, dayValue) {
    const backendDayText = dayValue === 'today' ? 'hôm nay' : dayValue;
    const mealLabelMap = {
      Sáng: t('meal.breakfast', 'Sáng'), Trưa: t('meal.lunch', 'Trưa'),
      Tối: t('meal.dinner', 'Tối'), 'Bữa phụ': t('meal.snack', 'Bữa phụ'),
    };
    const shownTime = mealLabelMap[mealTime] || mealTime;
    const shownDate = dayValue === 'today' ? t('meal.today', 'Hôm nay') : dayValue;
    const confirmMessage = t('meal.confirm_sent', `Xác nhận: Ăn vào buổi ${shownTime}, ${shownDate}`).replace('{meal}', shownTime).replace('{day}', shownDate);

    renderBotOrUser('user', confirmMessage);
    const typingId = addTyping();
    setIsAnalyzing(true);

    const token = window.localStorage.getItem('calorie_ai_token');
    const formData = new FormData();
    formData.append('message', confirmMessage);
    formData.append('followupType', 'meal_time_update');
    formData.append('mealData', JSON.stringify(mealData));
    formData.append('mealTime', mealTime);
    formData.append('mealDayText', backendDayText);
    formData.append('mealDayValue', dayValue);
    formData.append('lang', lang);

    try {
      const res = await fetch('/api/chat', { method: 'POST', body: formData, headers: { Authorization: `Bearer ${token}` } });
      const result = await res.json();
      removeTyping(typingId);
      if (result.success) {
        renderBotOrUser('bot', result.reply || t('meal.logged', 'Đã ghi lại bữa ăn của bạn!'));
        try {
          if (result.newPlan) window.localStorage.setItem('calorie_weekly_plan_cache', JSON.stringify(result.newPlan));
          window.localStorage.setItem('calorie_plan_dirty', String(Date.now()));
          window.dispatchEvent(new CustomEvent('calorie:plan-updated', { detail: { at: Date.now() } }));
        } catch {}
        showToast(t('meal.updated_toast', 'Đã cập nhật thời khóa biểu & thống kê!'), 'success');
      } else {
        renderBotOrUser('bot', result.reply || result.error || t('meal.update_fail', 'Mình chưa cập nhật được, bạn thử lại nhé.'));
      }
    } catch {
      removeTyping(typingId);
      showToast(t('meal.conn_err', 'Lỗi kết nối server'), 'error');
    } finally {
      setIsAnalyzing(false);
    }
  }

  function addTyping() {
    const id = `typing${msgIdRef.current++}`;
    setMessages((prev) => [...prev, { id, kind: 'typing' }]);
    scrollToBottom();
    return id;
  }
  function removeTyping(id) {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  /* ── Send message ──────────────────────────────────────────────── */
  async function sendMessage() {
    // Ref đồng bộ: chặn double-click / Enter giữ liên tục ngay trong cùng 1 nhịp
    // render (state isAnalyzing cập nhật bất đồng bộ nên không kịp chặn).
    if (sendingRef.current) return;
    if (isAnalyzing || isLoadingHistory) return;
    sendingRef.current = true;
    try {
      await doSendMessage();
    } finally {
      sendingRef.current = false;
    }
  }

  async function doSendMessage() {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) {
      showToast(t('common.please_login', 'Vui lòng đăng nhập!'), 'info');
      router.push('/signin');
      return;
    }
    const text = inputText.trim();
    let file = fileInputRef.current?.files?.[0] || pastedImageFileRef.current;
    flagRef.current = false;
    if (!text && !file) return;
    if (file && fileInputRef.current?.files?.[0] && !file.name.toLowerCase().endsWith('.jpg') && !file.name.toLowerCase().endsWith('.jpeg')) {
      showToast(t('chat.jpg_only', 'Chỉ được gửi ảnh JPG!'), 'error');
      return;
    }
    if (file) file = await optimizeImageFile(file);
    let currentFileBase64 = null;
    if (file) {
      currentFileBase64 = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = (e) => resolve(e.target.result);
        r.readAsDataURL(file);
      });
    }
    setIsAnalyzing(true);
    renderBotOrUser('user', text || (file ? t('chat.sent_image', '[Đã gửi ảnh]') : ''));
    const typingId = addTyping();

    const resendSamePhoto = !!(file && currentFileBase64 && sessionPhotosRef.current.includes(currentFileBase64));
    const trimmedText = text || '';
    const isDefaultPrompt = !trimmedText || isDefaultAnalyzeText(trimmedText);
    const isEnLang = lang === 'en';

    if (resendSamePhoto && isDefaultPrompt && lastNutritionDataRef.current) {
      removeTyping(typingId);
      const nm = lastNutritionDataRef.current.description || 'món ăn';
      renderBotOrUser('bot', isEnLang
        ? `I already analyzed this photo — it's **${nm}**. Its nutrition is still shown in the card on the right. If it looks wrong, type a correction and resend the photo and I'll re-analyze it.`
        : `Mình vừa phân tích tấm ảnh này rồi nè: **${nm}**. Thông tin dinh dưỡng vẫn đang hiển thị ở thẻ bên phải. Nếu chưa đúng, bạn nhập mô tả/chỉnh sửa rồi gửi lại ảnh để mình phân tích lại nhé!`);
      updateSidebarFrom(lastNutritionDataRef.current);
      setIsAnalyzing(false);
      finishSendCleanup();
      return;
    }

    clearNutritionValues();

    const formData = new FormData();
    formData.append('message', text);
    if (file && (!resendSamePhoto || !isDefaultPrompt || !lastNutritionDataRef.current)) {
      formData.append('image', file);
      if (resendSamePhoto && !isDefaultPrompt) formData.append('reanalyze', '1');
    }
    formData.append('lang', lang);
    if (lastNutritionDataRef.current && lastNutritionDataRef.current.description) {
      formData.append('lastClientMeal', JSON.stringify(lastNutritionDataRef.current));
    }

    try {
      const res = await fetch('/api/chat', { method: 'POST', body: formData, headers: { Authorization: `Bearer ${token}` } });
      const result = await res.json();
      removeTyping(typingId);
      if (result.reply) {
        if (result.reply.includes('<error>')) {
          const errorMatch = result.reply.match(/<error>([\s\S]*?)<\/error>/);
          const errorMsg = errorMatch ? errorMatch[1] : 'Không phải thức ăn';
          showToast(errorMsg, 'error');
          flagRef.current = true;
          renderBotOrUser('bot', result.reply);
          resetSidebar();
          setIsAnalyzing(false);
          finishSendCleanup();
          return;
        }
        renderBotOrUser('bot', result.reply);
        const dataMatch = result.reply.match(/<data>([\s\S]*?)<\/data>/);
        if (dataMatch && dataMatch[1]) {
          try {
            const nutritionData = JSON.parse(dataMatch[1]);
            updateSidebarFrom(nutritionData);
            lastNutritionDataRef.current = nutritionData;
            openMealModal(nutritionData);
          } catch (e) { console.error('Không parse được data dinh dưỡng:', e); }
          if (file && currentFileBase64 && !sessionPhotosRef.current.includes(currentFileBase64)) sessionPhotosRef.current.push(currentFileBase64);
        }
      }
    } catch (e) {
      console.error(e);
      if (!flagRef.current) showToast(t('common.error_generic', 'Có lỗi đang xảy ra!'), 'error');
    } finally {
      setIsAnalyzing(false);
      finishSendCleanup();
    }
  }

  function finishSendCleanup() {
    setInputText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setPastePreview(null);
    pastedImageFileRef.current = null;
  }

  /* ── History + paste listener ──────────────────────────────────── */
  useEffect(() => {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) {
      showToast(t('common.please_login', 'Vui lòng đăng nhập!'), 'info');
      setTimeout(() => router.push('/signin'), 1369);
      return;
    }

    (async () => {
      try {
        const res = await fetch('/api/chat-history', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (res.ok === false) {
          showToast(t('common.please_login', 'Vui lòng đăng nhập!'), 'info');
          setTimeout(() => router.push('/signin'), 1369);
          return;
        }
        if (data.history && Array.isArray(data.history)) {
          for (const msg of data.history) renderBotOrUser(msg.role, msg.content);
        }
      } catch {
        showToast(t('common.please_login', 'Vui lòng đăng nhập!'), 'info');
        setTimeout(() => router.push('/signin'), 1369);
      } finally {
        setIsLoadingHistory(false);
      }
    })();

    function onPaste(e) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); handlePastedImage(file); }
          break;
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageShell variant="chat">
      <section className="chat-section">
        <div className="chat-window" id="chat-window" ref={chatWindowRef}>
          {messages.map((m) => {
            if (m.kind === 'typing') {
              return (
                <div key={m.id} className="typing-indicator">
                  <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                </div>
              );
            }
            if (m.kind === 'meal-modal') {
              return (
                <MealModal
                  key={m.id}
                  t={t}
                  onCancel={() => cancelMealModal(m.id)}
                  onConfirm={(time, mode, date) => confirmMealModal(m.id, m.mealData, time, mode, date)}
                />
              );
            }
            const html = m.html != null ? m.html : renderMarkdown(t(m.key, m.fallback));
            return (
              <div key={m.id} className={`msg-container ${m.role === 'user' ? 'msg-user' : 'msg-bot'}`} dangerouslySetInnerHTML={{ __html: html }} />
            );
          })}
        </div>

        {pastePreview && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-card,#f5f5f5)', borderRadius: 10, marginBottom: 6 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pastePreview} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: '1.5px solid var(--border,#ddd)' }} />
            <span style={{ fontSize: 13, color: 'var(--text-sub,#888)', flex: 1 }}>{t('chat.pasted_label', 'Ảnh vừa dán (Ctrl+V)')}</span>
            <button type="button" title={t('chat.remove_image', 'Xoá ảnh')} onClick={removePastePreview} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e74c3c', fontSize: 16, padding: '2px 6px' }}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        )}

        <div className={`input-wrapper${isRecording ? ' is-recording' : ''}`} id="input-wrapper">
          <div className="input-tools" id="upload-btn" onClick={() => fileInputRef.current?.click()} title={t('chat.upload_hint', 'Tải ảnh món ăn')}>
            <i className="fa-solid fa-circle-plus" />
            <input ref={fileInputRef} type="file" accept=".jpg,.jpeg" style={{ display: 'none' }} onChange={handleFileSelect} />
          </div>
          <input
            id="user-input"
            type="text"
            className="chat-input"
            placeholder={t('chat.placeholder', 'Hỏi tôi liên quan về dinh dưỡng...')}
            value={inputText}
            disabled={isAnalyzing || isLoadingHistory}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={(e) => { if (e.key === 'Enter') sendMessage(); }}
          />

          <div className="voice-waveform" id="voice-waveform">
            {Array.from({ length: 10 }).map((_, i) => <span key={i} />)}
          </div>

          <button className={`voice-btn${isRecording ? ' recording' : ''}`} id="voice-btn" onClick={toggleVoice} title="Nhấn để nói" disabled={isAnalyzing || isLoadingHistory}>
            <i className="fa-solid fa-microphone" />
          </button>
          <button className="voice-cancel-btn" id="voice-cancel-btn" onClick={cancelVoice} title="Hủy"><i className="fa-solid fa-xmark" /></button>
          <button className="voice-confirm-btn" id="voice-confirm-btn" onClick={confirmVoice} title="Giữ văn bản"><i className="fa-solid fa-check" /></button>

          <button className="send-btn" id="send-btn" onClick={sendMessage} title={t('chat.send', 'Gửi')} disabled={isAnalyzing || isLoadingHistory}>
            <i className="fa-solid fa-paper-plane" />
          </button>
        </div>
      </section>

      <aside className="info-sidebar">
        <div className="card card-food">
          <div className="food-img-container">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img id="display-food-img" src={foodImg} alt="Food" />
          </div>

          <div className="calories-box">
            <div className="title"><i className="fa-solid fa-utensils" /> <span>{t('chat.total_energy', 'Tổng năng lượng')}</span></div>
            <div className="value">{metricRange(sidebar.calories, sidebar.confidence, true)} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-sub)' }}>{t('common.kcal', 'kcal')}</span></div>
          </div>

          <div className="desc-text">{sidebar.description || t('chat.info_update', 'Thông tin sẽ cập nhật sau khi phân tích.')}</div>

          <div className="stats-grid-mini">
            <div className="stat-item-mini"><span>{t('chat.protein', 'Protein')}</span><b>{metricRange(sidebar.protein, sidebar.confidence)}</b></div>
            <div className="stat-item-mini"><span>{t('chat.fat', 'Chất béo')}</span><b>{metricRange(sidebar.fat, sidebar.confidence)}</b></div>
            <div className="stat-item-mini"><span>{t('chat.carbs', 'Carbs')}</span><b>{metricRange(sidebar.carbs, sidebar.confidence)}</b></div>
            <div className="stat-item-mini"><span>{t('chat.fiber', 'Chất xơ')}</span><b>{metricRange(sidebar.fiber, sidebar.confidence)}</b></div>
            <div className="stat-item-mini"><span>{t('chat.sugar', 'Đường')}</span><b>{metricRange(sidebar.sugar, sidebar.confidence)}</b></div>
            <div className="stat-item-mini"><span>{t('chat.sodium', 'Natri')}</span><b>{metricRange(sidebar.sodium, sidebar.confidence)}</b></div>
          </div>
        </div>
      </aside>
    </PageShell>
  );
}
