'use client';
import Link from 'next/link';
import { useAuth } from '../lib-client/AuthContext';
import { useTranslation } from '../lib-client/I18nContext';
import LangSwitch from './LangSwitch';
import RemindersBell from './RemindersBell';

export default function Header() {
  const { logout, isAuthenticated } = useAuth();
  const { t } = useTranslation();

  return (
    <header className="header">
      <Link href="/" className="logo"><i className="fa-solid fa-leaf" /> Calorie AI</Link>
      <div id="auth-zone" className="header-tools">
        <LangSwitch />
        {isAuthenticated && <RemindersBell />}
        {isAuthenticated && (
          <div className="user-profile-nav" onClick={logout} title={t('common.logout_hint')}>
            <span className="user-name"><i className="fa-solid fa-circle-user" /> <strong>{t('common.logout')}</strong></span>
            <div className="btn-logout-icon"><i className="fa-solid fa-right-from-bracket" /></div>
          </div>
        )}
      </div>
    </header>
  );
}
