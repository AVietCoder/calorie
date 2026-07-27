'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslation } from '../lib-client/I18nContext';

const ITEMS = [
  { href: '/chat', icon: 'fa-comment', key: 'nav.ai', fallback: 'AI' },
  { href: '/diet-details', icon: 'fa-fire-flame-curved', key: 'nav.diet', fallback: 'DIET' },
  { href: '/schedule', icon: 'fa-calendar-days', key: 'nav.plan', fallback: 'PLAN' },
  { href: '/household', icon: 'fa-kitchen-set', key: 'nav.kitchen', fallback: 'KITCHEN' },
  { href: '/setup', icon: 'fa-user', key: 'nav.profile', fallback: 'PROFILE' },
  { href: '/guide', icon: 'fa-circle-question', key: 'nav.guide', fallback: 'GUIDE' },
];

export default function SideNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const [isAdmin, setIsAdmin] = useState(false);

  // Ported from public/admin-link.js — shows an "ADMIN" item for admin users only.
  useEffect(() => {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) return;
    const cached = window.sessionStorage.getItem('calorie_is_admin');
    if (cached === 'true') { setIsAdmin(true); return; }
    if (cached === 'false') return;
    fetch('/api/admin?action=whoami', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const admin = !!(d && d.isAdmin);
        window.sessionStorage.setItem('calorie_is_admin', admin ? 'true' : 'false');
        if (admin) setIsAdmin(true);
      })
      .catch(() => {});
  }, []);

  return (
    <aside className="side-nav">
      {ITEMS.map((item) => (
        <div
          key={item.href}
          className={`nav-item${pathname?.startsWith(item.href) ? ' active' : ''}`}
          onClick={() => router.push(item.href)}
        >
          <i className={`fa-solid ${item.icon}`} />
          <span>{t(item.key, item.fallback)}</span>
        </div>
      ))}
      {isAdmin && (
        <div className={`nav-item${pathname === '/admin' ? ' active' : ''}`} title="Quản trị tài liệu RAG" onClick={() => router.push('/admin')}>
          <i className="fa-solid fa-shield-halved" /><span>ADMIN</span>
        </div>
      )}
      {isAdmin && (
        <div className={`nav-item${pathname?.startsWith('/admin/survey') ? ' active' : ''}`} title="Thống kê khảo sát người dùng" onClick={() => router.push('/admin/survey')}>
          <i className="fa-solid fa-chart-column" /><span>KHẢO SÁT</span>
        </div>
      )}
    </aside>
  );
}
