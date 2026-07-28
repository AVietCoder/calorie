'use client';
// useApi.js — one fetch helper for every page, replacing the scattered
// ad-hoc `fetch(...)` calls in the old vanilla pages. Auto-attaches the
// bearer token, auto-refreshes it first (useAuth().ensureFresh), and
// normalizes every backend response envelope ({success,data,error} or
// {success,message,...}-shaped legacy routes) into a single throw-on-error
// contract so components can just `await` and catch.
import { useCallback } from 'react';
import { useAuth } from './AuthContext';

function normalize(payload) {
  if (payload && payload.success === false) {
    throw new Error(payload.error || payload.message || 'Có lỗi xảy ra');
  }
  return payload && 'data' in payload ? payload.data : payload;
}

export function useApi() {
  const { token, ensureFresh } = useAuth();

  const request = useCallback(
    async (path, { method = 'GET', body, isForm = false, query } = {}) => {
      await ensureFresh();
      const t = window.localStorage.getItem('calorie_ai_token') || token;
      const url = query ? `${path}?${new URLSearchParams(query).toString()}` : path;
      const headers = t ? { Authorization: `Bearer ${t}` } : {};
      let payload = body;
      if (!isForm && body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const res = await fetch(url, { method, headers, body: payload });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && data.success === undefined) {
        throw new Error(data.error || data.message || `Lỗi ${res.status}`);
      }
      return normalize(data);
    },
    [token, ensureFresh]
  );

  const get = useCallback((path, query) => request(path, { method: 'GET', query }), [request]);
  const post = useCallback((path, body) => request(path, { method: 'POST', body }), [request]);
  const postForm = useCallback((path, formData) => request(path, { method: 'POST', body: formData, isForm: true }), [request]);

  /**
   * Tải file nhị phân (Excel…) kèm bearer token.
   *
   * Không dùng được `get()` cho việc này vì `get()` luôn `res.json()`, còn ở
   * đây body là .xlsx. Tên file lấy từ Content-Disposition (server gửi kèm
   * `filename*=UTF-8''…` nên tên tiếng Việt có dấu vẫn đúng).
   *
   * @returns {Promise<string>} tên file đã tải
   */
  const download = useCallback(
    async (path, query, fallbackName = 'download.xlsx') => {
      await ensureFresh();
      const t = window.localStorage.getItem('calorie_ai_token') || token;
      const url = query ? `${path}?${new URLSearchParams(query).toString()}` : path;
      const res = await fetch(url, { headers: t ? { Authorization: `Bearer ${t}` } : {} });

      if (!res.ok) {
        // Lỗi luôn trả JSON, kể cả trên endpoint nhị phân.
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Lỗi ${res.status}`);
      }

      const filename = parseFilename(res.headers.get('Content-Disposition')) || fallbackName;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      return filename;
    },
    [token, ensureFresh]
  );

  return { get, post, postForm, download, request };
}

/** Ưu tiên `filename*=UTF-8''…` (có dấu) rồi mới tới `filename="…"`. */
function parseFilename(disposition) {
  if (!disposition) return null;
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* rơi xuống nhánh ASCII */
    }
  }
  const ascii = disposition.match(/filename="?([^";]+)"?/i);
  return ascii ? ascii[1] : null;
}
