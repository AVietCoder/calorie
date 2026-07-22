'use client';
// AuthContext.jsx — replaces public/session.js. Holds access/refresh token +
// expiry in localStorage (same keys as before for continuity), refreshes the
// access token via /api/auth (action=refresh) before it expires (5 min skew),
// on mount, every 60s, and on window focus — identical behavior to the old
// vanilla implementation, just exposed as a React hook instead of a global.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const TOKEN_KEY = 'calorie_ai_token';
const REFRESH_KEY = 'calorie_ai_refresh';
const EXPIRES_KEY = 'calorie_ai_expires_at';
const SKEW = 5 * 60;

const AuthContext = createContext(null);
const now = () => Math.floor(Date.now() / 1000);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const refreshingRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    setToken(window.localStorage.getItem(TOKEN_KEY));
    setReady(true);
  }, []);

  const refresh = useCallback(async () => {
    const rt = window.localStorage.getItem(REFRESH_KEY);
    if (!rt) return false;
    if (refreshingRef.current) return refreshingRef.current;
    refreshingRef.current = (async () => {
      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'refresh', refresh_token: rt }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.token) return false;
        window.localStorage.setItem(TOKEN_KEY, data.token);
        if (data.refresh_token) window.localStorage.setItem(REFRESH_KEY, data.refresh_token);
        if (data.expires_at) window.localStorage.setItem(EXPIRES_KEY, String(data.expires_at));
        setToken(data.token);
        return true;
      } catch {
        return false;
      } finally {
        refreshingRef.current = null;
      }
    })();
    return refreshingRef.current;
  }, []);

  const ensureFresh = useCallback(async () => {
    const t = window.localStorage.getItem(TOKEN_KEY);
    if (!t) return false;
    const exp = parseInt(window.localStorage.getItem(EXPIRES_KEY) || '0', 10) || 0;
    if (!exp) return true;
    if (exp - now() > SKEW) return true;
    return refresh();
  }, [refresh]);

  useEffect(() => {
    if (!ready) return;
    ensureFresh();
    const interval = setInterval(ensureFresh, 60 * 1000);
    window.addEventListener('focus', ensureFresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', ensureFresh);
    };
  }, [ready, ensureFresh]);

  const login = useCallback(({ token: t, refresh_token, expires_at, user: u }) => {
    window.localStorage.setItem(TOKEN_KEY, t);
    if (refresh_token) window.localStorage.setItem(REFRESH_KEY, refresh_token);
    if (expires_at) window.localStorage.setItem(EXPIRES_KEY, String(expires_at));
    if (u?.id) window.localStorage.setItem('user_id', u.id);
    setToken(t);
    setUser(u || null);
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    window.localStorage.removeItem(EXPIRES_KEY);
    window.localStorage.removeItem('user_id');
    setToken(null);
    setUser(null);
    router.push('/signin');
  }, [router]);

  const value = useMemo(
    () => ({ token, user, ready, isAuthenticated: !!token, login, logout, ensureFresh }),
    [token, user, ready, login, logout, ensureFresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** useAuth() -> { token, user, ready, isAuthenticated, login, logout, ensureFresh } */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

export { TOKEN_KEY };
