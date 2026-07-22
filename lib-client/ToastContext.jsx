'use client';
// ToastContext.jsx — replaces public/toast.js's DOM-node toast with a React-
// rendered stack. Same visual classes (toast-msg, fade-out) and 4s timing.
import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const showToast = useCallback((message, type = 'info') => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type, fading: false }]);
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, fading: true } : t)));
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 400);
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div id="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-msg ${t.type}${t.fading ? ' fade-out' : ''}`}>
            <i className={`fa-solid ${iconFor(t.type)}`} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function iconFor(type) {
  if (type === 'success') return 'fa-circle-check';
  if (type === 'error') return 'fa-triangle-exclamation';
  return 'fa-circle-info';
}

/** useToast()(message, type) — same call shape as the old global showToast(). */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
