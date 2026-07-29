/**
 * cloudinary.js — store raw PDF files in Cloudinary.
 *
 * Supports TWO credential styles:
 *
 *  1) UNSIGNED (what you have): CLOUDINARY_CLOUD_NAME + CLOUDINARY_UPLOAD_PRESET.
 *     Uses Cloudinary's unsigned upload endpoint (no API secret needed). This is
 *     the same mechanism a Vite frontend uses, so the VITE_-prefixed names are
 *     also accepted: VITE_CLOUDINARY_CLOUD_NAME / VITE_CLOUDINARY_UPLOAD_PRESET.
 *     NOTE: deleting assets via API is NOT possible without an API secret, so in
 *     this mode destroyPdf() is a no-op (file stays in Cloudinary on delete).
 *
 *  2) SIGNED (optional, enables delete): CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY
 *     + CLOUDINARY_API_SECRET (or CLOUDINARY_URL). Uses the signed SDK; supports
 *     upload AND delete.
 *
 * If nothing is configured the helpers no-op (upload returns null) so the rest
 * of the pipeline still works while you finish setup.
 *
 * Uses Node 18+ global fetch/FormData/Blob (available on Vercel) for the
 * unsigned upload — no extra deps required.
 */
import { v2 as cloudinary } from "cloudinary";

const FOLDER = process.env.CLOUDINARY_PDF_FOLDER || "calorie-rag-pdfs";

function env() {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME || "",
    uploadPreset:
      process.env.CLOUDINARY_UPLOAD_PRESET || process.env.VITE_CLOUDINARY_UPLOAD_PRESET || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || "",
    url: process.env.CLOUDINARY_URL || "",
  };
}

/** "signed" | "unsigned" | null */
function mode() {
  const { cloudName, uploadPreset, apiKey, apiSecret, url } = env();
  if (url || (cloudName && apiKey && apiSecret)) return "signed";
  if (cloudName && uploadPreset) return "unsigned";
  return null;
}

export function cloudinaryConfigured() {
  return mode() !== null;
}

/** True only when we can also DELETE (needs an API secret). */
export function cloudinaryCanDelete() {
  return mode() === "signed";
}

let _signedConfigured = false;
function configureSigned() {
  if (_signedConfigured) return;
  const { cloudName, apiKey, apiSecret, url } = env();
  if (url) {
    cloudinary.config({ secure: true }); // SDK auto-reads CLOUDINARY_URL
  } else {
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  }
  _signedConfigured = true;
}

function publicIdFrom(filename) {
  const safe = String(filename || "document.pdf")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return safe || "document.pdf";
}

/** Signed upload via SDK (raw asset). */
async function signedUpload(buffer, filename) {
  configureSigned();
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: FOLDER,
        public_id: (() => {
        const safeName = publicIdFrom(filename);
        const dot = safeName.lastIndexOf(".");
        const ext = dot > 0 ? safeName.slice(dot) : ".pdf";
        const base = dot > 0 ? safeName.slice(0, dot) : safeName;
        return `${base}-${Date.now()}${ext}`;
      })(),
        use_filename: true,
        unique_filename: false,
        overwrite: false,
      },
      (err, res) => (err ? reject(err) : resolve(res))
    );
    stream.end(buffer);
  });
  return {
    public_id: result.public_id,
    url: result.secure_url || result.url,
    bytes: result.bytes,
    format: result.format || "pdf",
    resource_type: result.resource_type || "raw",
  };
}

/** Unsigned upload via the public endpoint (cloud_name + upload_preset only). */
async function unsignedUpload(buffer, filename) {
  const { cloudName, uploadPreset } = env();
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "application/pdf" }), filename || "document.pdf");
  form.append("upload_preset", uploadPreset);
  // "auto" is the most compatible with arbitrary unsigned presets.
  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`;
  const res = await fetch(endpoint, { method: "POST", body: form });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* keep text for error */
  }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 200);
    throw new Error(`Cloudinary upload thất bại (${res.status}): ${msg}`);
  }
  return {
    public_id: json.public_id,
    // Store the plain delivery URL (no fl_attachment baked in here).
    // The download link with fl_attachment is built on the frontend
    // (public/admin.js), which is the single place that needs it —
    // baking it in here too caused a duplicated/garbled "/upload/"
    // segment when the frontend added its own fl_attachment:<name>.
    url: json.secure_url || json.url || "",
    bytes: json.bytes,
    format: json.format || "pdf",
    resource_type: json.resource_type || "raw",
  };
}

/**
 * Upload a PDF buffer to Cloudinary.
 * @returns {Promise<{public_id, url, bytes, format, resource_type}|null>}
 *          null when Cloudinary isn't configured (treat as optional).
 * @throws if Cloudinary IS configured but the upload fails.
 */
export async function uploadPdf(buffer, filename) {
  const m = mode();
  if (m === "signed") return signedUpload(buffer, filename);
  if (m === "unsigned") return unsignedUpload(buffer, filename);
  return null;
}

const IMAGE_FOLDER = process.env.CLOUDINARY_IMAGE_FOLDER || "calorie-food-photos";

/** Upload 1 ảnh món ăn (JPEG) cho "Nhật ký ảnh" (bundle D). Trả null nếu
 *  Cloudinary chưa cấu hình (nhật ký ảnh là tuỳ chọn — không chặn phân tích).
 *
 *  @param {object} [opts]
 *  @param {string} [opts.folder]  ghi đè thư mục (ảnh bìa thực đơn để riêng,
 *                                 không lẫn vào kho ảnh món ăn)
 *  @param {string} [opts.mime]    kiểu ảnh thật khi upload unsigned (PNG/WebP)
 */
export async function uploadImage(buffer, filename = "food.jpg", opts = {}) {
  const folder = opts.folder || IMAGE_FOLDER;
  const m = mode();
  if (!m) return null; // mode() trả null khi chưa cấu hình (không phải chuỗi "none")
  try {
    if (m === "signed") {
      configureSigned();
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: "image", folder, use_filename: true, unique_filename: true, overwrite: false },
          (err, res) => (err ? reject(err) : resolve(res))
        );
        stream.end(buffer);
      });
      return {
        public_id: result.public_id,
        url: result.secure_url || result.url,
        width: result.width, height: result.height,
        bytes: result.bytes, format: result.format || "jpg",
      };
    }
    // unsigned — đẩy ảnh vào folder riêng để không lẫn với PDF (nếu preset cho phép
    // override folder; preset chặn thì Cloudinary bỏ qua field này, không lỗi).
    const { cloudName, uploadPreset } = env();
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: opts.mime || "image/jpeg" }), filename);
    form.append("upload_preset", uploadPreset);
    form.append("folder", folder);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
    return {
      public_id: json.public_id,
      url: json.secure_url || json.url || "",
      width: json.width, height: json.height,
      bytes: json.bytes, format: json.format || "jpg",
    };
  } catch (err) {
    console.warn(`⚠️ [cloudinary] uploadImage failed: ${err.message}`);
    return null;
  }
}

/**
 * Best-effort delete. Only possible in SIGNED mode (needs API secret).
 * In unsigned mode this returns false without throwing.
 */
export async function destroyPdf(publicId, resourceType) {
  if (!publicId || mode() !== "signed") return false;
  configureSigned();
  // resource_type isn't stored per-asset; try the likely ones.
  const types = resourceType ? [resourceType] : ["raw", "image"];
  for (const rt of types) {
    try {
      const r = await cloudinary.uploader.destroy(publicId, { resource_type: rt });
      if (r && r.result === "ok") return true;
    } catch (err) {
      console.warn(`⚠️ [cloudinary] destroy (${rt}) failed: ${err.message}`);
    }
  }
  return false;
}

export async function testCloudinaryConnection() {
  try {
    const m = mode();

    console.log("=================================");
    console.log("☁️ CLOUDINARY CONNECTION TEST");
    console.log("=================================");

    console.log("Mode:", process.env.CLOUDINARY_CLOUD_NAME);

    console.log("Environment:");
    console.log({
      cloudName: process.env.CLOUDINARY_CLOUD_NAME || "(missing)",
      uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || "(missing)",
      hasApiKey: !!process.env.CLOUDINARY_API_KEY,
      hasApiSecret: !!process.env.CLOUDINARY_API_SECRET,
      hasCloudinaryUrl: !!process.env.CLOUDINARY_URL,
      folder: FOLDER,
    });

    if (!m) {
      console.error("❌ Cloudinary chưa được cấu hình");

      return {
        success: false,
        mode: null,
        details: "Missing Cloudinary environment variables",
      };
    }

    if (m === "signed") {
      configureSigned();

      const ping = await cloudinary.api.ping();

      console.log("✅ Cloudinary SIGNED connection successful");
      console.log("Ping response:", ping);

      return {
        success: true,
        mode: "signed",
        details: ping,
      };
    }

    // unsigned mode
    console.log("✅ Cloudinary UNSIGNED configuration detected");

    const testBuffer = Buffer.from("Cloudinary test file");
    const testFilename = `test-${Date.now()}.pdf`;

    const uploadResult = await unsignedUpload(
      testBuffer,
      testFilename
    );

    console.log("✅ Test upload successful");
    console.log(uploadResult);

    return {
      success: true,
      mode: "unsigned",
      details: uploadResult,
    };
  } catch (error) {
    console.error("❌ Cloudinary connection failed");
    console.error(error);

    return {
      success: false,
      mode: mode(),
      details: error.message,
    };
  }
}

export default { cloudinaryConfigured, cloudinaryCanDelete, uploadPdf, destroyPdf, testCloudinaryConnection };