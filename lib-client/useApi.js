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

  return { get, post, postForm, request };
}
