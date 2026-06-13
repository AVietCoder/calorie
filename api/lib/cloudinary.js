/**
 * Cloudinary helper (server side - dùng cho upload PDF từ admin panel).
 * Frontend dùng unsigned upload preset trực tiếp tới api.cloudinary.com.
 *
 * Env yêu cầu (server):
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_UPLOAD_PRESET  (unsigned preset, dùng cả frontend & server fallback)
 */

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || process.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export function getCloudConfig() {
  return {
    cloudName: CLOUD_NAME || "",
    uploadPreset: UPLOAD_PRESET || "",
  };
}

/**
 * Upload buffer lên Cloudinary qua unsigned preset.
 * Dùng khi server cần upload (ví dụ fallback admin upload PDF).
 */
export async function uploadBufferToCloudinary(buffer, filename, resourceType = "auto") {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error("Thiếu CLOUDINARY_CLOUD_NAME hoặc CLOUDINARY_UPLOAD_PRESET");
  }
  const form = new FormData();
  const blob = new Blob([buffer]);
  form.append("file", blob, filename);
  form.append("upload_preset", UPLOAD_PRESET);
  if (filename) form.append("public_id", filename.replace(/\.[^.]+$/, ""));

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`;
  const resp = await fetch(url, { method: "POST", body: form });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json?.error?.message || "Cloudinary upload failed");
  }
  return json; // { public_id, secure_url, bytes, width, height, format, ... }
}
