// lib/cors.js — shared CORS headers for every Route Handler. Non-negotiable:
// calorie-ai-mobile calls this backend cross-origin, so every response
// (including error paths) must carry these headers or the mobile app breaks.
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function corsJson(NextResponse, body, init = {}) {
  return NextResponse.json(body, { ...init, headers: { ...CORS_HEADERS, ...(init.headers || {}) } });
}

export function corsOptions(NextResponse) {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}
