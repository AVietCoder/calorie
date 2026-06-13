/* admin.js — RAG document manager (admin only).
 * Talks to /api/admin. Auth via the same calorie_ai_token used across the app. */

const API = "/api/admin";
const token = localStorage.getItem("calorie_ai_token");

const $ = (id) => document.getElementById(id);
const toast = (msg, type) => (window.showToast ? showToast(msg, type) : console.log(type, msg));

/* ---- helpers ---- */
function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}
function fmtBytes(n) {
  if (!n && n !== 0) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
function statusBadge(s) {
  const map = {
    ready: ["Đã tải", "badge"],
    error: ["Lỗi", "badge bad"],
    uploaded: ["Đã nhận", "badge gray"],
    extracting: ["Trích text…", "badge gray"],
    chunking: ["Chia đoạn…", "badge gray"],
    embedding: ["Embedding…", "badge gray"],
    saving: ["Đang lưu…", "badge gray"],
  };
  const [label, cls] = map[s] || [s || "—", "badge gray"];
  return `<span class="${cls}">${label}</span>`;
}

/* ---- page loader ---- */
function hidePageLoader() {
  const el = $("adminPageLoader");
  if (!el) return;
  el.style.opacity = "0";
  setTimeout(() => { el.style.display = "none"; }, 250);
}

/* ---- status pills ---- */
function setStatusLoading() {
  ["pillStore","pillPdfs","pillChunks","pillStorage","pillCloud","pillEmbed"].forEach(id => {
    const el = $(id);
    if (el) el.classList.add("skeleton-pill");
  });
}

function renderStatus(data) {
  const store = data.store || {};

  const pillStore = $("pillStore");
  pillStore.classList.remove("skeleton-pill");
  pillStore.className = "status-pill " + (store.ready ? "ok" : "bad");
  pillStore.querySelector("span").textContent = store.ready
    ? "Kho dữ liệu sẵn sàng"
    : "Chưa tạo bảng Supabase";

  const pillPdfs = $("pillPdfs");
  pillPdfs.classList.remove("skeleton-pill");
  pillPdfs.querySelector("span").textContent = `${store.pdfs ?? 0} tài liệu`;

  const pillChunks = $("pillChunks");
  pillChunks.classList.remove("skeleton-pill");
  pillChunks.querySelector("span").textContent = `${store.chunks ?? 0} đoạn`;

  const storage = $("pillStorage");
  if (storage) {
    storage.classList.remove("skeleton-pill");
    storage.className = "status-pill " + (data.storage ? "ok" : "bad");
    storage.querySelector("span").textContent =
      "Lưu file: " + (data.storage ? "Supabase Storage" : "Chưa cấu hình");
  }

  const cloud = $("pillCloud");
  cloud.classList.remove("skeleton-pill");
  cloud.className = "status-pill " + (data.cloudinary ? "ok" : "");
  cloud.querySelector("span").textContent =
    "Cloudinary (tùy chọn): " + (data.cloudinary ? "Đã bật" : "Tắt");

  const emb = $("pillEmbed");
  emb.classList.remove("skeleton-pill");
  emb.className = "status-pill " + (data.embeddings ? "ok" : "");
  emb.querySelector("span").textContent = "Embeddings: " + (data.embeddings ? "Đã bật" : "Tắt (chỉ từ khóa)");
}

/* ---- load PDF list ---- */
async function loadPdfs() {
  const body = $("pdfsBody");
  const tableLoader = $("tableLoader");
  const tableWrap = $("tableWrap");

  // Show skeleton, hide actual table
  if (tableLoader) tableLoader.style.display = "block";
  if (tableWrap) tableWrap.style.display = "none";

  try {
    const res = await fetch(`${API}?action=list`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Không tải được danh sách");
    renderStatus(data);

    const pdfs = data.pdfs || [];
    if (!pdfs.length) {
      body.innerHTML = `<tr><td colspan="7" class="empty">Chưa có tài liệu nào. Hãy tải PDF lên.</td></tr>`;
    } else {
      body.innerHTML = pdfs
        .map((p) => {
const fileLink = p.download_url
  ? (() => {
      const baseName =
        (p.file_name || "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "_") || "document.pdf";
      const titleTxt =
        p.download_kind === "cloudinary" ? "Tải PDF (Cloudinary)" : "Tải PDF";
      return `
        <a
          class="btn-ghost"
          href="${p.download_url}"
          target="_blank"
          rel="noopener"
          download="${baseName}"
          title="${titleTxt}"
        >
          <i class="fa-solid fa-download"></i>
        </a>
      `;
    })()
  : '<span class="cross" title="Chưa có file gốc để tải">—</span>';
          const emb = p.embedding_count > 0
            ? `<span class="tick"><i class="fa-solid fa-check"></i> ${p.embedding_count}</span>`
            : '<span class="cross">—</span>';
          const errTitle = p.status === "error" && p.error_message ? ` title="${String(p.error_message).replace(/"/g, "&quot;")}"` : "";
          return `<tr>
            <td class="doc-name">${escapeHtml(p.file_name)}</td>
            <td>${fmtBytes(p.file_size)}</td>
            <td${errTitle}>${statusBadge(p.status)}</td>
            <td class="chip-count">${p.chunk_count ?? 0}</td>
            <td>${emb}</td>
            <td>${fileLink}</td>
            <td><button class="icon-btn" title="Xóa" data-id="${p.id}"><i class="fa-solid fa-trash"></i></button></td>
          </tr>`;
        })
        .join("");

      body.querySelectorAll("button[data-id]").forEach((btn) => {
        btn.onclick = () => deletePdf(btn.getAttribute("data-id"), btn);
      });
    }
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(err.message)}</td></tr>`;
  } finally {
    // Hide skeleton, show table
    if (tableLoader) {
      tableLoader.style.opacity = "0";
      setTimeout(() => {
        tableLoader.style.display = "none";
        tableLoader.style.opacity = "1";
        if (tableWrap) tableWrap.style.display = "block";
      }, 200);
    } else if (tableWrap) {
      tableWrap.style.display = "block";
    }
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

/* ---- upload ---- */
async function doUpload() {
  const input = $("fileInput");
  const file = input.files && input.files[0];
  if (!file) return toast("Hãy chọn một tệp PDF trước.", "error");
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    return toast("Chỉ chấp nhận tệp PDF.", "error");
  }

  const btn = $("uploadBtn");
  const prog = $("progress");
  btn.disabled = true;
  prog.style.display = "flex";
  $("progressMsg").textContent = "Đang tải lên & xử lý (có thể mất 10–30 giây)…";

  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API}?action=upload`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Tải lên thất bại");

    const d = data.document || {};
    toast(`Đã xử lý "${d.file_name}": ${d.chunk_count} đoạn${d.embedding_count ? `, ${d.embedding_count} embedding` : ""}.`, "success");
    if (data.warning) toast(data.warning, "error");

    input.value = "";
    $("fileLabel").textContent = "Bấm để chọn tệp PDF (≤ 20MB)";
    $("dropzone").classList.remove("has-file");
    await loadPdfs();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    prog.style.display = "none";
  }
}

/* ---- delete ---- */
async function deletePdf(id, btn) {
  if (!confirm("Xóa tài liệu này? Các đoạn văn bản và file trên Cloudinary sẽ bị xóa.")) return;
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${API}?action=delete&id=${encodeURIComponent(id)}`, {
      method: "POST",
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Xóa thất bại");
    toast("Đã xóa tài liệu.", "success");
    await loadPdfs();
  } catch (err) {
    toast(err.message, "error");
    if (btn) btn.disabled = false;
  }
}

/* ---- dropzone interactions ---- */
function wireDropzone() {
  const dz = $("dropzone");
  const input = $("fileInput");
  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    $("fileLabel").textContent = f ? f.name : "Bấm để chọn tệp PDF (≤ 20MB)";
    dz.classList.toggle("has-file", !!f);
  });
  ["dragover", "dragenter"].forEach((e) =>
    dz.addEventListener(e, (ev) => {
      ev.preventDefault();
      dz.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((e) =>
    dz.addEventListener(e, (ev) => {
      ev.preventDefault();
      dz.classList.remove("dragover");
    })
  );
  dz.addEventListener("drop", (ev) => {
    const f = ev.dataTransfer?.files?.[0];
    if (f) {
      input.files = ev.dataTransfer.files;
      $("fileLabel").textContent = f.name;
      dz.classList.add("has-file");
    }
  });
}

/* ---- init / auth guard ---- */
async function init() {
  if (!token) {
    window.location.href = "signin.html";
    return;
  }
  try {
    const res = await fetch(`${API}?action=whoami`, { headers: authHeaders() });
    if (res.status === 401) {
      window.location.href = "signin.html";
      return;
    }
    const data = await res.json();

    hidePageLoader();

    if (!data.isAdmin) {
      $("deniedMsg").textContent = `Tài khoản ${data.email || ""} chưa có quyền quản trị. Liên hệ quản trị viên để được cấp quyền (đặt is_admin = true).`;
      $("denied").style.display = "block";
      $("adminBody").style.display = "none";
      return;
    }
    $("denied").style.display = "none";
    $("adminBody").style.display = "block";
    renderStatus(data);
    wireDropzone();
    $("uploadBtn").onclick = doUpload;
    $("refreshBtn").onclick = loadPdfs;
    await loadPdfs();
  } catch (err) {
    hidePageLoader();
    toast("Lỗi kết nối: " + err.message, "error");
  }
}

init();