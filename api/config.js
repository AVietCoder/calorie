import { getCloudConfig } from "./lib/cloudinary.js";

/**
 * Public config endpoint - chỉ trả về biến môi trường PUBLIC.
 * Frontend gọi để biết Cloudinary cloud name / upload preset.
 */
export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  return res.status(200).json({
    cloudinary: getCloudConfig(),
  });
}
