'use client';
// RemindersBell.jsx — ports public/reminders.js to React. Same behavior:
// localStorage-backed per-user reminder list, browser Notification API,
// WebAudio 3-note alarm chime, floating bell + management panel + full-screen
// alarm overlay, 20s tick loop while the tab is open.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../lib-client/I18nContext';
import '../styles/reminders.css';

function userKey() {
  const uid = typeof window !== 'undefined' ? window.localStorage.getItem('user_id') || 'anon' : 'anon';
  return `calorie_ai_reminders_${uid}`;
}
function loadReminders() {
  try {
    const raw = window.localStorage.getItem(userKey());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveReminders(list) {
  window.localStorage.setItem(userKey(), JSON.stringify(list));
}
function uid() {
  return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default function RemindersBell() {
  const [enabled, setEnabled] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('meal');
  const [reminders, setReminders] = useState([]);
  const [label, setLabel] = useState('');
  const [time, setTime] = useState('');
  const [repeat, setRepeat] = useState(true);
  const [notifOk, setNotifOk] = useState(false);
  const [alarm, setAlarm] = useState(null); // { type, label, time } | null

  const audioCtxRef = useRef(null);
  const firedTodayRef = useRef({});
  const { t } = useTranslation();

  useEffect(() => {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) return;
    setEnabled(true);
    setReminders(loadReminders());
    setNotifOk(typeof Notification !== 'undefined' && Notification.permission === 'granted');

    const unlock = () => {
      const c = audioCtxRef.current;
      if (c && c.state === 'suspended') c.resume().catch(() => {});
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);

    const tick = () => {
      const list = loadReminders();
      if (!list.length) return;
      const now = new Date();
      const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const dateKey = now.toISOString().slice(0, 10);
      list.forEach((r) => {
        if (!r.time || r.time !== cur) return;
        const fkey = `${dateKey}_${cur}_${r.id}`;
        if (firedTodayRef.current[fkey]) return;
        firedTodayRef.current[fkey] = true;
        fire(r);
        if (!r.repeat) {
          const next = loadReminders().filter((x) => x.id !== r.id);
          saveReminders(next);
          setReminders(next);
        }
      });
    };
    tick();
    const interval = setInterval(tick, 20000);

    const onKey = (e) => { if (e.key === 'Escape') { setAlarm(null); setPanelOpen(false); } };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('keydown', onKey);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getAudioCtx() {
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      audioCtxRef.current = null;
    }
    return audioCtxRef.current;
  }

  function playAlarmSound() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      [880, 1175, 880].forEach((freq, i) => {
        const t0 = now + i * 0.22;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.22);
      });
    } catch {}
  }

  function fire(rem) {
    const isMed = rem.type === 'med';
    const title = isMed ? t('rem.fire_med', '💊 Đến giờ uống thuốc') : t('rem.fire_meal', '🍽️ Đến giờ ăn');
    const body = rem.label || (isMed ? t('rem.alarm_default_med', 'Đã đến giờ uống thuốc của bạn.') : t('rem.alarm_default_meal', 'Đã đến giờ ăn của bạn.'));
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, { body, icon: '/logo.png', tag: rem.id });
        n.onclick = () => { window.focus(); setAlarm(null); n.close(); };
      } catch {}
    }
    setAlarm(rem);
    playAlarmSound();
  }

  async function requestNotif() {
    if (typeof Notification === 'undefined') {
      return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }

  function addReminder() {
    if (!time) return;
    const list = loadReminders();
    list.push({
      id: uid(),
      type: activeTab,
      label: label.trim() || (activeTab === 'med' ? t('rem.tab_med', 'Uống thuốc') : t('rem.tab_meal', 'Bữa ăn')),
      time,
      repeat,
    });
    saveReminders(list);
    setReminders(list);
    setLabel('');
    requestNotif().then(setNotifOk);
  }

  function deleteReminder(id) {
    const next = loadReminders().filter((x) => x.id !== id);
    saveReminders(next);
    setReminders(next);
  }

  if (!enabled) return null;

  const hasReminders = reminders.length > 0;
  const visibleItems = reminders.filter((r) => r.type === activeTab).sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  return (
    <>
      <button type="button" className={`rem-bell${hasReminders ? ' has-rem' : ''}`} title={t('rem.open', 'Nhắc nhở')} onClick={() => setPanelOpen(true)}>
        <i className="fa-regular fa-bell" /><span className="rem-dot" />
      </button>

      {panelOpen && typeof document !== 'undefined' && createPortal(
        <div className="rem-overlay open" onClick={(e) => { if (e.target === e.currentTarget) setPanelOpen(false); }}>
          <div className="rem-panel" role="dialog" aria-modal="true">
            <div className="rem-head">
              <div>
                <h2>{t('rem.title', 'Nhắc nhở')}</h2>
                <p>{t('rem.subtitle', 'Nhắc uống thuốc & ăn đúng giờ')}</p>
              </div>
              <button className="rem-x" onClick={() => setPanelOpen(false)}>&times;</button>
            </div>
            <div className="rem-body">
              <div className="rem-tabs">
                <button className={`rem-tab${activeTab === 'meal' ? ' active' : ''}`} onClick={() => setActiveTab('meal')}>{t('rem.tab_meal', 'Bữa ăn')}</button>
                <button className={`rem-tab${activeTab === 'med' ? ' active' : ''}`} onClick={() => setActiveTab('med')}>{t('rem.tab_med', 'Uống thuốc')}</button>
              </div>
              <div className="rem-list">
                {!visibleItems.length && <div className="rem-empty">{t('rem.none', 'Chưa có nhắc nhở nào.')}</div>}
                {visibleItems.map((r) => (
                  <div key={r.id} className="rem-item">
                    <div className="rem-time">{r.time}</div>
                    <div className="rem-meta">
                      <div className="rem-lab" dangerouslySetInnerHTML={{ __html: escapeHtml(r.label || '') }} />
                      <div className="rem-rep">{r.repeat ? <><i className="fa-solid fa-rotate" /> {t('rem.repeat', 'Lặp lại hằng ngày')}</> : t('common.today', 'Hôm nay')}</div>
                    </div>
                    <button className="rem-del" title={t('common.delete', 'Xóa')} onClick={() => deleteReminder(r.id)}><i className="fa-solid fa-trash-can" /></button>
                  </div>
                ))}
              </div>
              <div className="rem-form">
                <div className="full">
                  <label>{t('rem.label', 'Nội dung nhắc')}</label>
                  <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={activeTab === 'med' ? t('rem.label_med_ph', 'VD: Uống vitamin D') : t('rem.label_meal_ph', 'VD: Ăn sáng')} />
                </div>
                <div>
                  <label>{t('rem.time', 'Giờ nhắc')}</label>
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <label className="rem-rep-row" style={{ margin: '0 0 8px' }}>
                    <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
                    <span>{t('rem.repeat', 'Lặp lại hằng ngày')}</span>
                  </label>
                </div>
                <button className="rem-add full" onClick={addReminder}>{t('rem.add', 'Thêm nhắc nhở')}</button>
              </div>
              <button className={`rem-notif-btn${notifOk ? ' ok' : ''}`} onClick={() => requestNotif().then(setNotifOk)}>
                <i className="fa-regular fa-bell" /> <span>{t('rem.enable_notif', 'Bật thông báo trình duyệt')}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {alarm && typeof document !== 'undefined' && createPortal(
        <div className={`rem-alarm-overlay open${alarm.type === 'med' ? ' med' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) setAlarm(null); }}>
          <div className="rem-alarm-card" role="dialog" aria-modal="true">
            <button className="rem-alarm-x" aria-label="Close" onClick={() => setAlarm(null)}>&times;</button>
            <div className="rem-alarm-icon"><i className={`fa-solid ${alarm.type === 'med' ? 'fa-pills' : 'fa-utensils'}`} /></div>
            <div className="rem-alarm-now">{t('rem.alarm_now', 'BÂY GIỜ')}</div>
            <h2 className="rem-alarm-title">{alarm.type === 'med' ? t('rem.fire_med', '💊 Đến giờ uống thuốc') : t('rem.fire_meal', '🍽️ Đến giờ ăn')}</h2>
            <div className="rem-alarm-body">{alarm.label || (alarm.type === 'med' ? t('rem.alarm_default_med', 'Đã đến giờ uống thuốc của bạn.') : t('rem.alarm_default_meal', 'Đã đến giờ ăn của bạn.'))}</div>
            <div className="rem-alarm-time">{alarm.time || ''}</div>
            <button className="rem-alarm-dismiss" onClick={() => setAlarm(null)}>{t('rem.alarm_dismiss', 'Đã hiểu')}</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
