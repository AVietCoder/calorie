/* Shared admin helpers */
window.AdminUtils = (function () {
  const TOKEN_KEY = "calorie_ai_token";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function api(path, opts = {}) {
    const token = getToken();
    const headers = { ...(opts.headers || {}) };
    if (token) headers["Authorization"] = "Bearer " + token;
    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string") {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, { ...opts, headers }).then(async (r) => {
      const ct = r.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? await r.json() : await r.text();
      if (!r.ok) {
        const err = new Error(
          (data && data.error) || (typeof data === "string" ? data : "Lỗi không xác định")
        );
        err.status = r.status;
        err.data = data;
        throw err;
      }
      return data;
    });
  }

  function toast(msg, type = "") {
    let stack = document.querySelector(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function fmtBytes(b) {
    if (b == null) return "—";
    const k = 1024;
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let n = Number(b);
    while (n >= k && i < units.length - 1) {
      n /= k;
      i++;
    }
    return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function fmtDate(s) {
    if (!s) return "—";
    const d = new Date(s);
    if (isNaN(d)) return "—";
    return d.toLocaleString("vi-VN", { hour12: false });
  }

  function timeAgo(s) {
    if (!s) return "—";
    const diff = (Date.now() - new Date(s).getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s trước`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m trước`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h trước`;
    return `${Math.floor(diff / 86400)} ngày trước`;
  }

  function renderSidebar(active) {
    const items = [
      { href: "admin.html", icon: "fa-chart-line", label: "Dashboard", key: "dashboard" },
      { href: "admin-pdfs.html", icon: "fa-file-pdf", label: "PDF Knowledge", key: "pdfs" },
      { href: "admin-users.html", icon: "fa-users", label: "Users & Chats", key: "users" },
      { href: "chat.html", icon: "fa-arrow-right-from-bracket", label: "Quay lại app", key: "back" },
    ];
    return `
      <aside class="admin-side">
        <div class="brand"><i class="fa-solid fa-leaf"></i> Calorie AI · Admin</div>
        <nav>
          ${items
            .map(
              (i) =>
                `<a href="${i.href}" class="${i.key === active ? "active" : ""}">
                   <i class="fa-solid ${i.icon}"></i> ${i.label}
                 </a>`
            )
            .join("")}
        </nav>
        <div class="side-bottom">v1.0 · ${new Date().getFullYear()}</div>
      </aside>`;
  }

  async function ensureAdmin() {
    if (!getToken()) {
      location.href = "signin.html";
      return false;
    }
    try {
      // Hit stats endpoint as auth probe
      await api("/api/admin/stats");
      return true;
    } catch (e) {
      if (e.status === 403) {
        document.body.innerHTML = `
          <div style="padding:60px;text-align:center;font-family:Inter">
            <h2>🚫 Bạn không có quyền admin</h2>
            <p>Hãy yêu cầu admin gán quyền cho tài khoản này.</p>
            <a href="chat.html" class="btn primary" style="margin-top:14px;display:inline-block">Về app</a>
          </div>`;
        return false;
      }
      if (e.status === 401) {
        location.href = "signin.html";
        return false;
      }
      toast(e.message, "error");
      return false;
    }
  }

  return { api, toast, fmtBytes, fmtDate, timeAgo, renderSidebar, ensureAdmin, getToken };
})();
