'use client';
// I18nContext.jsx — replaces public/i18n.js's data-i18n DOM scanning with a
// React context. Same dictionary (lib-client/i18n-dict.js), same t()/tn()
// signatures, same localStorage key so language choice persists.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DICT, DISEASE_KEY_BY_VALUE, FOOD_EN } from './i18n-dict';

const LS_KEY = 'calorie_ai_lang';
const DEFAULT_LANG = 'vi';
const I18nContext = createContext(null);

function readStoredLang() {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  const l = window.localStorage.getItem(LS_KEY);
  return l === 'en' || l === 'vi' ? l : DEFAULT_LANG;
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(DEFAULT_LANG);

  useEffect(() => {
    setLangState(readStoredLang());
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  const setLang = useCallback((next) => {
    const l = next === 'en' || next === 'vi' ? next : DEFAULT_LANG;
    window.localStorage.setItem(LS_KEY, l);
    setLangState(l);
  }, []);

  const t = useCallback(
    (key, fallback) => {
      const table = DICT[lang] || DICT[DEFAULT_LANG];
      if (table && key in table) return table[key];
      if (DICT[DEFAULT_LANG] && key in DICT[DEFAULT_LANG]) return DICT[DEFAULT_LANG][key];
      return fallback != null ? fallback : key;
    },
    [lang]
  );

  const tn = useCallback(
    (key, vars, fallback) => {
      let s = t(key, fallback);
      if (vars && typeof s === 'string') {
        for (const k of Object.keys(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
      }
      return s;
    },
    [t]
  );

  const localizeDisease = useCallback(
    (value) => {
      const raw = String(value || '').trim();
      if (!raw) return raw;
      const k = DISEASE_KEY_BY_VALUE[raw.toLowerCase()];
      return k ? t(k, raw) : raw;
    },
    [t]
  );

  const localizeFood = useCallback(
    (name) => {
      const raw = String(name || '').trim();
      if (!raw || lang !== 'en') return raw;
      const key = raw.toLowerCase().replace(/\s+/g, ' ');
      if (FOOD_EN[key]) return FOOD_EN[key];
      const base = key.replace(/\(.*?\)/g, '').trim();
      if (FOOD_EN[base]) return FOOD_EN[base];
      return raw;
    },
    [lang]
  );

  const value = useMemo(
    () => ({ lang, setLang, t, tn, localizeDisease, localizeFood }),
    [lang, setLang, t, tn, localizeDisease, localizeFood]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** useTranslation() -> { lang, setLang, t, tn, localizeDisease, localizeFood } */
export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation must be used within an I18nProvider');
  return ctx;
}
