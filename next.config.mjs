/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    // Equivalent of the old vercel.json `includeFiles: "knowledge/**"` —
    // these routes read knowledge/knowledge-base.json at runtime.
    '/api/chat': ['./knowledge/**'],
    '/api/coach': ['./knowledge/**'],
    '/api/admin': ['./knowledge/**'],
    '/api/health': ['./knowledge/**'],
  },
};

export default nextConfig;
