'use client';
import { useTranslation } from '../lib-client/I18nContext';

export default function LangSwitch() {
  const { lang, setLang, t } = useTranslation();
  return (
    <div className="lang-switch" title={t('common.lang')}>
      <button type="button" className={`lang-opt${lang === 'vi' ? ' active' : ''}`} onClick={() => setLang('vi')}>VI</button>
      <button type="button" className={`lang-opt${lang === 'en' ? ' active' : ''}`} onClick={() => setLang('en')}>EN</button>
    </div>
  );
}
