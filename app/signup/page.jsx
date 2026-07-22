'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/style.css';
import '../../styles/signup.css';

export default function SignUpPage() {
  const [form, setForm] = useState({ username: '', password: '', birthYear: '', weight: '', height: '' });
  const [loading, setLoading] = useState(false);
  const showToast = useToast();
  const { t } = useTranslation();
  const router = useRouter();

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          email: `${form.username}@gmail.com`,
          password: form.password,
          username: form.username,
          birthYear: form.birthYear,
          weight: form.weight,
          height: form.height,
        }),
      });
      const result = await response.json();

      if (response.ok) {
        showToast('Đăng ký thành công! Bạn có thể đăng nhập ngay.', 'success');
        router.push('/signin');
      } else {
        showToast('Lỗi đăng ký: ' + result.error, 'error');
        setLoading(false);
      }
    } catch (err) {
      console.error('Lỗi kết nối:', err);
      showToast('Không thể kết nối tới máy chủ.', 'error');
      setLoading(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-header">
        <Link href="/" className="logo" style={{ marginBottom: 10, fontSize: '1.5rem', textDecoration: 'none' }}>
          <i className="fa-solid fa-leaf" style={{ color: '#2ecc71' }} />{' '}
          <span style={{ fontWeight: 700, color: '#333' }}>Calorie AI</span>
        </Link>
        <h2>{t('auth.signup_title', 'Tạo tài khoản mới')}</h2>
        <p style={{ color: '#666' }}>{t('auth.signup_sub', 'Bắt đầu hành trình dinh dưỡng của bạn')}</p>
      </div>

      <form className="auth-form" onSubmit={onSubmit}>
        <div className="input-group">
          <label>{t('auth.username', 'Tên đăng nhập')}</label>
          <input type="text" value={form.username} onChange={setField('username')} placeholder={t('auth.username_ph_signup', 'Ví dụ: nva123')} required />
        </div>
        <div className="input-group">
          <label>{t('auth.password', 'Mật khẩu')}</label>
          <input type="password" value={form.password} onChange={setField('password')} placeholder="••••••••" required />
        </div>
        <div className="input-group">
          <label>{t('auth.birth', 'Năm sinh')}</label>
          <input type="number" value={form.birthYear} onChange={setField('birthYear')} placeholder="1995" required />
        </div>
        <div className="input-group">
          <label>{t('auth.weight', 'Cân nặng (kg)')}</label>
          <input type="number" value={form.weight} onChange={setField('weight')} placeholder="65" required />
        </div>
        <div className="input-group">
          <label>{t('auth.height', 'Chiều cao (cm)')}</label>
          <input type="number" value={form.height} onChange={setField('height')} placeholder="170" required />
        </div>

        <button type="submit" className="btn-auth" disabled={loading}>
          {loading ? (
            <>
              <i className="fa-solid fa-circle-notch fa-spin" /> Đang đăng ký...
            </>
          ) : (
            t('auth.signup_btn', 'Đăng ký ngay')
          )}
        </button>
      </form>

      <div className="auth-footer">
        <span>{t('auth.have_account', 'Đã có tài khoản?')}</span>{' '}
        <Link href="/signin">{t('auth.signin_link', 'Đăng nhập')}</Link>
      </div>
    </div>
  );
}
