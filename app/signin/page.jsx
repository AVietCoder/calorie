'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib-client/AuthContext';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/style.css';
import '../../styles/signin.css';

export default function SignInPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const { login } = useAuth();
  const showToast = useToast();
  const { t } = useTranslation();
  const router = useRouter();

  async function onSubmit(e) {
    e.preventDefault();
    // Chống double-submit: ref đồng bộ nên chặn được cả click nhanh 2 lần / giữ Enter
    // trong cùng 1 nhịp render (disabled theo state không kịp chặn).
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', email: `${username}@gmail.com`, password }),
      });
      const result = await response.json();

      if (response.ok) {
        showToast('Đăng nhập thành công!', 'success');
        login(result);
        // Thành công → GIỮ khoá tới lúc chuyển trang (không nhả submitting/loading)
        setTimeout(() => router.push('/guide'), 800);
      } else {
        showToast(result.error, 'error');
        setLoading(false);
        submitting.current = false;
      }
    } catch {
      showToast('Lỗi kết nối hệ thống.', 'error');
      setLoading(false);
      submitting.current = false;
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-header">
        <Link href="/" className="logo" style={{ marginBottom: 10, fontSize: '1.5rem', textDecoration: 'none' }}>
          <i className="fa-solid fa-leaf"/>{' '}
          <span style={{ fontWeight: 700, color: '#333' }}>Calorie AI</span>
        </Link>
        <h2>{t('auth.signin_title', 'Chào mừng trở lại')}</h2>
        <p style={{ color: '#666' }}>{t('auth.signin_sub', 'Tiếp tục theo dõi sức khỏe của bạn')}</p>
      </div>

      <form className="auth-form" onSubmit={onSubmit}>
        <div className="input-group">
          <label>{t('auth.username', 'Tên đăng nhập')}</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('auth.username_ph_signin', 'Nhập username')}
            required
          />
        </div>
        <div className="input-group">
          <label>{t('auth.password', 'Mật khẩu')}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
        </div>

        <button type="submit" className="btn-auth" disabled={loading}>
          {loading ? (
            <>
              <i className="fas fa-spinner" /> Đang xác thực...
            </>
          ) : (
            t('auth.signin_btn', 'Đăng nhập')
          )}
        </button>
      </form>

      <div className="auth-footer">
        <span>{t('auth.no_account', 'Chưa có tài khoản?')}</span>{' '}
        <Link href="/signup">{t('auth.signup_now', 'Đăng ký ngay')}</Link>
      </div>
    </div>
  );
}
