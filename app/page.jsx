'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '../lib-client/I18nContext';
import LangSwitch from '../components/LangSwitch';
import { useToast } from '../lib-client/ToastContext';
import '../styles/style.css';
import '../styles/index.css';

export default function LandingPage() {
  const [authState, setAuthState] = useState('loading'); // 'loading' | 'guest' | 'user'
  const { t } = useTranslation();
  const showToast = useToast();

  useEffect(() => {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) {
      const timer = setTimeout(() => setAuthState('guest'), 500);
      return () => clearTimeout(timer);
    }
    (async () => {
      try {
        const res = await fetch('/api/status', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (res.ok && data.success) {
          setAuthState('user');
        } else {
          window.localStorage.removeItem('calorie_ai_token');
          window.localStorage.removeItem('user_id');
          setAuthState('guest');
        }
      } catch {
        setAuthState('guest');
      }
    })();
  }, []);

  async function handleLogout() {
    const token = window.localStorage.getItem('calorie_ai_token');
    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'logout' }),
      });
    } catch (e) {
      console.error('Lỗi gọi API logout:', e);
    } finally {
      window.localStorage.removeItem('calorie_ai_token');
      window.localStorage.removeItem('user_id');
      showToast('Đã đăng xuất thành công!', 'info');
      setTimeout(() => window.location.reload(), 1000);
    }
  }

  return (
    <>
      <header className="navbar">
        <div className="logo">
          <img src="banner.jpg" alt="ELTIVN" style={{ height: 67, width: 'auto' }} />
        </div>
        <nav className="nav-auth" id="auth-zone">
          <LangSwitch />
          {authState === 'loading' && (
            <div className="nav-loading">
              <span /><span /><span />
            </div>
          )}
          {authState === 'guest' && (
            <>
              <Link href="/signin" className="nav-link">{t('land.signin', 'Đăng nhập')}</Link>
              <Link href="/signup" className="btn-signup">
                <i className="fa-solid fa-user-plus" /> <span>{t('land.signup', 'Đăng ký')}</span>
              </Link>
            </>
          )}
          {authState === 'user' && (
            <div className="user-profile-nav" onClick={handleLogout} style={{ cursor: 'pointer' }} title={t('common.logout_hint', 'Nhấn để đăng xuất')}>
              <span className="user-name">
                <i className="fa-solid fa-circle-user" /> <span>{t('common.logout', 'Đăng xuất')}</span>
              </span>
              <div className="btn-logout">
                <i className="fa-solid fa-right-from-bracket" />
              </div>
            </div>
          )}
        </nav>
      </header>

      <main className="hero-container">
        <div className="hero-content">
          <div className="badge">
            <i className="fa-solid fa-sparkles" /> <span>{t('land.badge', 'Trí tuệ nhân tạo thế hệ mới')}</span>
          </div>
          <h1>
            <span>{t('land.title1', 'Kiểm soát Calorie')}</span> <br />
            <span className="highlight">{t('land.title2', 'Dễ dàng hơn bao giờ hết.')}</span>
          </h1>
          <p>{t('land.desc')}</p>

          <div className="hero-btns">
            <Link href="/guide" className="btn-main">
              <span>{t('land.cta', 'Bắt đầu ngay')}</span> <i className="fa-solid fa-arrow-right" />
            </Link>
          </div>
        </div>

        <div className="hero-visual">
          <div className="floating-card">
            <i className="fa-solid fa-award" />
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://i.pinimg.com/736x/ca/5d/37/ca5d371c8e432a9df5f3de23b40e20ca.jpg" alt="Healthy Food" />
        </div>
      </main>

      <footer>
        <p>{t('land.footer', '© 2026 ELTIVN. Phân tích dinh dưỡng thông minh.')}</p>
      </footer>
    </>
  );
}
