/**
 * cloudinary.js — store raw PDF files in Cloudinary.
 *
 * Every PDF an admin uploads is saved to Cloudinary (resource_type "raw") and
 * the resulting secure URL + public_id are kept in the admin_pdfs row. The RAG
 * text/chunks live in Supabase; the original file lives in Cloudinary.
 *
 * Configure with EITHER:
 *   • CLOUDINARY_URL = cloudinary://<api_key>:<api_secret>@<cloud_name>
 *   • or the trio CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
 *
 * If nothing is configured the helpers no-op gracefully (upload returns null)
 * so the rest of the pipeline still works while you finish setup.
 */
import { v2 as cloudinary } from "cloudinary";

const FOLDER = process.env.CLOUDINARY_PDF_FOLDER || "calorie-rag-pdfs";

let _configured = null;
function configure() {
  if (_configured !== null) return _configured;
  const { CLOUDINARY_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;
  if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    cloudinary.config({
      cloud_name: CLOUDINARY_CLOUD_NAME,
      api_key: CLOUDINARY_API_KEY,
      api_secret: CLOUDINARY_API_SECRET,
      secure: true,
    });
    _configured = true;
  } else if (CLOUDINARY_URL) {
    // SDK auto-reads CLOUDINARY_URL; just flip secure on.
    cloudinary.config({ secure: true });
    _configured = true;
  } else {
    _configured = false;
  }
  return _configured;
}

export function cloudinaryConfigured() {
  return configure();
}

/** Make a filesystem-safe-ish public id from a filename (no extension). */
function publicIdFrom(filename) {
  const base = String(filename || "document").replace(/\.[^.]+$/, "");
  return (
    base
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "document"
  );
}

/**
 * Upload a PDF buffer to Cloudinary as a raw asset.
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<{public_id:string, url:string, bytes:number, format:string}|null>}
 *          null when Cloudinary isn't configured (caller should treat as optional).
 * @throws if Cloudinary IS configured but the upload fails.
 */
export async function uploadPdf(buffer, filename) {
  if (!configure()) return null;
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: FOLDER,
        public_id: `${publicIdFrom(filename)}-${Date.now()}`,
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
  };
}

/** Best-effort delete of a raw asset. Never throws. */
export async function destroyPdf(publicId) {
  if (!publicId || !configure()) return false;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
    return true;
  } catch (err) {
    console.warn(`⚠️ [cloudinary] destroy failed: ${err.message}`);
    return false;
  }
}

export default { cloudinaryConfigured, uploadPdf, destroyPdf };
