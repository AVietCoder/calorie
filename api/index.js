// api/index.js — health check endpoint
// Vercel Hobby plan giới hạn 12 Serverless Functions.
// File này chỉ dùng làm health check, KHÔNG duplicate routes từ các file khác.

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  return res.status(200).json({
    status: "ok",
    message: "Calorie API is running 🚀",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
}
