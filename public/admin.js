const API = "/api/admin";
const token = localStorage.getItem("calorie_ai_token");

const $ = (id) => document.getElementById(id);
const toast = (msg, type) => (window.showToast ? showToast(msg, type) : console.log(type, msg));

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

async function loadPdfs() {
  const body = $("pdfsBody");
  const tableLoader = $("tableLoader");
  const tableWrap = $("tableWrap");

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
          const fullName = escapeHtml(p.file_name || "");
          const shortName = p.file_name && p.file_name.length > 48
            ? escapeHtml(p.file_name.slice(0, 44) + "…" + (p.file_name.lastIndexOf(".") > 44 ? p.file_name.slice(p.file_name.lastIndexOf(".")) : ""))
            : fullName;
          return `<tr>
            <td class="doc-name" title="${fullName}">${shortName}</td>
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

/* ---- upload (multi-file sequential) ---- */
async function doUpload() {
  const input = $("fileInput");
  const files = input.files ? Array.from(input.files) : [];
  if (!files.length) return toast("Hãy chọn một hoặc nhiều tệp PDF trước.", "error");

  const invalid = files.filter(f => !/\.pdf$/i.test(f.name) && f.type !== "application/pdf");
  if (invalid.length) return toast(`File "${invalid[0].name}" không phải PDF.`, "error");

  const btn = $("uploadBtn");
  const prog = $("progress");
  btn.disabled = true;
  prog.style.display = "flex";

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    $("progressMsg").textContent = `Đang xử lý file ${i + 1}/${files.length}: "${file.name}"…`;
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
      toast(`✓ "${d.file_name}": ${d.chunk_count} đoạn${d.embedding_count ? `, ${d.embedding_count} embed` : ""}.`, "success");
      if (data.warning) toast(data.warning, "error");
      successCount++;
    } catch (err) {
      toast(`✗ "${file.name}": ${err.message}`, "error");
      failCount++;
    }
  }

  input.value = "";
  $("fileLabel").textContent = "Bấm để chọn một hoặc nhiều tệp PDF";
  $("fileLabel").style.display = "";
  const _chips = $("fileChips"); if (_chips) _chips.innerHTML = "";
  $("dropzone").classList.remove("has-file");

  if (files.length > 1) {
    toast(`Hoàn tất: ${successCount} thành công, ${failCount} thất bại.`, successCount ? "success" : "error");
  }

  btn.disabled = false;
  prog.style.display = "none";
  await loadPdfs();
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
  function truncateName(name, maxLen) {
    if (!maxLen) maxLen = 42;
    if (name.length <= maxLen) return name;
    const dotIdx = name.lastIndexOf(".");
    const ext = dotIdx !== -1 ? name.slice(dotIdx) : "";
    return name.slice(0, maxLen - ext.length - 3) + "..." + ext;
  }

  function updateLabel() {
    const files = input.files ? Array.from(input.files) : [];
    const labelEl = $("fileLabel");
    const chipWrap = $("fileChips");
    if (!files.length) {
      labelEl.textContent = "Bấm để chọn một hoặc nhiều tệp PDF";
      labelEl.style.display = "";
      if (chipWrap) chipWrap.innerHTML = "";
      dz.classList.remove("has-file");
    } else if (files.length <= 3) {
      labelEl.style.display = "none";
      if (chipWrap) {
        chipWrap.innerHTML = files.map(function(f) {
          return '<span class="file-chip"><i class="fa-solid fa-file-pdf"></i> ' + escapeHtml(truncateName(f.name)) + '</span>';
        }).join("");
      }
      dz.classList.add("has-file");
    } else {
      labelEl.textContent = "Đã chọn " + files.length + " file";
      labelEl.style.display = "";
      if (chipWrap) chipWrap.innerHTML = "";
      dz.classList.add("has-file");
    }
  }
  input.addEventListener("change", updateLabel);
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
    const dt = ev.dataTransfer;
    if (dt && dt.files && dt.files.length) {
      input.files = dt.files;
      updateLabel();
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
      $("deniedMsg").textContent = `Tài khoản ${data.email || ""} chưa có quyền quản trị. Liên hệ quản trị viên để được cấp quyền.`;
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