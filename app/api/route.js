// app/api/route.js — bare `/api` health check. Vercel's old zero-config
// routing mapped `api/index.js` to BOTH `/api` and `/api/index`; this thin
// re-export preserves the `/api` path too, just in case any caller (e.g.
// calorie-ai-mobile) hits the bare path instead of `/api/index`.
export { GET, OPTIONS } from './index/route.js';
export const maxDuration = 10;
