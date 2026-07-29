'use client';
/**
 * useChecklist — trạng thái "đã mua" của một danh sách đi chợ, lưu ở trình duyệt.
 *
 * Dùng localStorage chứ không phải DB vì checklist có thể thuộc một thực đơn
 * CHƯA áp dụng (xem trước trong thư viện) — lúc đó chẳng có shopping_list nào
 * để ghi vào. Với kế hoạch thật, tick "đã mua" ở tầng DB vẫn do API lo riêng.
 *
 * `scope` nên gắn với id của kế hoạch/thực đơn để hai danh sách không đè tick
 * của nhau.
 */
import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'dr-fit:checklist:';

export function useChecklist(scope) {
  const key = PREFIX + (scope || 'preview');
  const [ticked, setTicked] = useState(() => new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      setTicked(new Set(raw ? JSON.parse(raw) : []));
    } catch {
      setTicked(new Set());   // JSON hỏng / chế độ riêng tư — coi như chưa tick gì
    }
  }, [key]);

  const toggle = useCallback((id) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try {
        window.localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        /* hết quota — mất tick chứ không được làm vỡ trang */
      }
      return next;
    });
  }, [key]);

  const clear = useCallback(() => {
    setTicked(new Set());
    try { window.localStorage.removeItem(key); } catch { /* không sao */ }
  }, [key]);

  return { ticked, toggle, clear, has: (id) => ticked.has(id) };
}

export default useChecklist;
