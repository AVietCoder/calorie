'use client';
/**
 * DeleteAccountDialog — xác nhận xoá tài khoản vĩnh viễn.
 *
 * Ba lớp chống bấm nhầm, theo mức độ nghiêm trọng của hành động:
 *   1. liệt kê CỤ THỂ những gì sẽ mất, không nói chung chung "dữ liệu của bạn";
 *   2. bắt gõ đúng một từ xác nhận — nút không bật cho tới lúc đó;
 *   3. khoá nút trong lúc gửi để không tạo hai yêu cầu.
 *
 * Xoá xong hiện màn thành công rồi mới chuyển trang: biến mất ngay lập tức về
 * màn đăng nhập khiến người dùng không biết việc đã xong hay vừa bị văng ra.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '../lib-client/useApi';
import { useAuth } from '../lib-client/AuthContext';

/** Từ khoá xác nhận — cùng chữ với app mobile. */
const CONFIRM_WORD = 'XOA';

const ITEMS = [
  ['fa-user', 'set.d_profile', 'Hồ sơ cá nhân'],
  ['fa-apple-whole', 'set.d_nutrition', 'Thông tin dinh dưỡng'],
  ['fa-utensils', 'set.d_meals', 'Lịch sử bữa ăn và thực đơn'],
  ['fa-image', 'set.d_photos', 'Ảnh món ăn đã tải lên'],
  ['fa-comments', 'set.d_chat', 'Lịch sử trò chuyện với AI'],
  ['fa-people-roof', 'set.d_family', 'Liên kết gia đình'],
  ['fa-sliders', 'set.d_prefs', 'Tuỳ chọn cá nhân'],
];

export default function DeleteAccountDialog({ open, onClose, t }) {
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  const { del } = useApi();
  const { logout } = useAuth();
  const router = useRouter();

  // Mở lại thì phải sạch: giữ lại chữ đã gõ lần trước là bỏ mất lớp chặn số 2.
  useEffect(() => {
    if (open) { setWord(''); setErr(null); setBusy(false); setDone(false); }
  }, [open]);

  const canDelete = word.trim().toUpperCase() === CONFIRM_WORD && !busy;

  async function submit(e) {
    e.preventDefault();
    if (!canDelete) return;
    setBusy(true);
    setErr(null);
    try {
      await del('/api/account');
      // Dọn sạch phía client TRƯỚC khi hiện màn thành công: token đã chết, để
      // lại chỉ khiến các request nền bắn 401 lung tung.
      clearLocalState();
      setDone(true);
      setTimeout(() => { logout(); }, 2600);   // logout() tự đẩy sang /signin
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  if (!open) return null;

  if (done) {
    return (
      <div className="mp-modal-overlay open">
        <div className="mp-modal da-modal da-done" onClick={(e) => e.stopPropagation()}>
          <div className="da-done-icon"><i className="fa-solid fa-circle-check" /></div>
          <h3>{t('set.done_title', 'Đã xoá tài khoản')}</h3>
          <p>
            {t('set.done_body', 'Tài khoản và toàn bộ dữ liệu của bạn đã được xoá vĩnh viễn. Cảm ơn bạn đã sử dụng Dr.Fit.')}
          </p>
          <button type="button" className="btn btn-primary" onClick={logout}>
            {t('set.done_btn', 'Về trang đăng nhập')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mp-modal-overlay open" onClick={busy ? undefined : onClose}>
      <form className="mp-modal da-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="mp-modal-header da-header">
          <div className="da-icon"><i className="fa-solid fa-triangle-exclamation" /></div>
          <h3>{t('set.delete_title', 'Xoá tài khoản')}</h3>
          {!busy && (
            <button type="button" className="mp-modal-close" onClick={onClose} aria-label={t('common.close', 'Đóng')}>
              <i className="fa-solid fa-xmark" />
            </button>
          )}
        </div>

        <div className="mp-modal-body">
          <p className="da-lead">
            {t('set.delete_lead', 'Xoá tài khoản là vĩnh viễn. Những dữ liệu sau sẽ bị xoá:')}
          </p>

          <ul className="da-list">
            {ITEMS.map(([icon, key, fallback]) => (
              <li key={key}><i className={`fa-solid ${icon}`} /> {t(key, fallback)}</li>
            ))}
          </ul>

          <p className="da-warn">
            <i className="fa-solid fa-circle-exclamation" />{' '}
            {t('set.delete_irreversible', 'Hành động này không thể hoàn tác.')}
          </p>

          <label className="da-confirm">
            {t('set.type_to_confirm', 'Nhập')} <b>{CONFIRM_WORD}</b>{' '}
            {t('set.type_to_confirm2', 'để xác nhận')}
            <input
              type="text"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              placeholder={CONFIRM_WORD}
            />
          </label>

          {err && <p className="da-err"><i className="fa-solid fa-circle-exclamation" /> {err}</p>}
        </div>

        <div className="da-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel', 'Hủy')}
          </button>
          <button type="submit" className="btn-danger-solid" disabled={!canDelete}>
            {busy
              ? <><i className="fa-solid fa-spinner fa-spin" /> {t('set.deleting', 'Đang xoá...')}</>
              : <><i className="fa-solid fa-trash-can" /> {t('set.delete_btn', 'Xoá tài khoản')}</>}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Xoá mọi dấu vết của phiên cũ ở trình duyệt.
 *
 * Không dùng localStorage.clear(): trang còn giữ cả tuỳ chọn không thuộc về tài
 * khoản (ngôn ngữ) và checklist đi chợ của thực đơn mẫu. Quét theo tiền tố để
 * chỉ lấy đúng thứ gắn với người dùng.
 */
function clearLocalState() {
  const PREFIXES = ['calorie_ai_', 'dr-fit:', 'user_id', 'chat_history', 'plan_cache'];
  try {
    const doomed = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && PREFIXES.some((p) => k.startsWith(p))) doomed.push(k);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
    window.sessionStorage.clear();
  } catch {
    /* chế độ riêng tư chặn storage — token đã chết ở server nên vẫn an toàn */
  }
}
