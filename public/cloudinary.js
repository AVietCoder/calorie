/* cloudinary.js — frontend unsigned upload helper.
 * Lấy config từ /api/config, sau đó upload trực tiếp tới Cloudinary.
 */
(function () {
  let _cfg = null;
  async function getConfig() {
    if (_cfg) return _cfg;
    try {
      const r = await fetch("/api/config");
      const j = await r.json();
      _cfg = j?.cloudinary || { cloudName: "", uploadPreset: "" };
    } catch {
      _cfg = { cloudName: "", uploadPreset: "" };
    }
    return _cfg;
  }

  /**
   * Upload File hoặc Blob lên Cloudinary.
   * resourceType: "image" | "raw" | "auto"  (raw cho PDF, image cho ảnh)
   * onProgress: (percent 0..100) callback
   */
  async function uploadToCloudinary(file, resourceType = "auto", onProgress) {
    const cfg = await getConfig();
    if (!cfg.cloudName || !cfg.uploadPreset) {
      throw new Error(
        "Chưa cấu hình CLOUDINARY_CLOUD_NAME / CLOUDINARY_UPLOAD_PRESET trên server."
      );
    }
    const url = `https://api.cloudinary.com/v1_1/${cfg.cloudName}/${resourceType}/upload`;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append("file", file);
      form.append("upload_preset", cfg.uploadPreset);
      xhr.open("POST", url);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(json);
          else reject(new Error(json?.error?.message || "Upload thất bại"));
        } catch (e) {
          reject(new Error("Phản hồi Cloudinary không hợp lệ"));
        }
      };
      xhr.onerror = () => reject(new Error("Lỗi mạng khi upload"));
      xhr.send(form);
    });
  }

  /** URL tối ưu (auto format/quality) cho hiển thị ảnh. */
  function optimizedUrl(url, width) {
    if (!url || !url.includes("/upload/")) return url;
    const tx = `f_auto,q_auto${width ? `,w_${width}` : ""}`;
    return url.replace("/upload/", `/upload/${tx}/`);
  }

  window.CloudinaryUploader = {
    upload: uploadToCloudinary,
    getConfig,
    optimizedUrl,
  };
})();
