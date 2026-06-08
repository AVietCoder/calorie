/* =========================================================================
 * reminders.js — Nhắc uống thuốc / ăn đúng giờ  (Yêu cầu #2)
 *
 * - Tự chèn nút chuông vào header + một bảng quản lý nhắc nhở.
 * - Lưu danh sách nhắc nhở trong localStorage theo từng user.
 * - Dùng Notification API của trình duyệt + toast trong trang.
 * - Bộ đếm chạy mỗi 20s, bắn thông báo khi tới đúng giờ (khi tab đang mở).
 *
 * Phụ thuộc (không bắt buộc): t() từ i18n.js, showToast() từ toast.js.
 * ======================================================================= */
(function () {
  const tt = (k, fb) => (typeof window.t === "function" ? window.t(k, fb) : fb);
  const toast = (m, type) =>
    typeof window.showToast === "function" ? window.showToast(m, type) : console.log("[toast]", m);

  function userKey() {
    const uid = localStorage.getItem("user_id") || "anon";
    return `calorie_ai_reminders_${uid}`;
  }

  function load() {
    try {
      const raw = localStorage.getItem(userKey());
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  function save(list) {
    localStorage.setItem(userKey(), JSON.stringify(list));
    refreshDot();
  }

  function uid() {
    return "r_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------------- Notifications ---------------- */
  async function requestNotif() {
    if (!("Notification" in window)) {
      toast(tt("rem.notif_blocked", "Trình duyệt không hỗ trợ thông báo."), "error");
      return false;
    }
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
      toast(tt("rem.notif_blocked", "Thông báo đang bị chặn. Hãy bật lại trong cài đặt."), "error");
      return false;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      toast(tt("rem.notif_on", "Đã bật thông báo!"), "success");
      return true;
    }
    toast(tt("rem.notif_blocked", "Thông báo đang bị chặn."), "error");
    return false;
  }

  /* ---- Âm thanh chuông báo (WebAudio, không cần file) ---- */
  let _audioCtx = null;
  function getAudioCtx() {
    if (_audioCtx) return _audioCtx;
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      _audioCtx = null;
    }
    return _audioCtx;
  }
  // Trình duyệt chặn autoplay -> mở khoá audio sau tương tác đầu tiên của người dùng
  function unlockAudio() {
    const c = getAudioCtx();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  }
  document.addEventListener("pointerdown", unlockAudio);
  document.addEventListener("keydown", unlockAudio);

  function playAlarmSound() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      const notes = [880, 1175, 880]; // chuông 3 nốt nhẹ nhàng
      notes.forEach((freq, i) => {
        const t0 = now + i * 0.22;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.22);
      });
    } catch (e) {
      /* bỏ qua nếu trình duyệt chặn */
    }
  }

  /* ---- Chuông báo nổi GIỮA màn hình (Yêu cầu #2) ---- */
  function buildAlarmModal() {
    let ov = document.getElementById("rem-alarm-overlay");
    if (ov) return ov;
    ov = document.createElement("div");
    ov.className = "rem-alarm-overlay";
    ov.id = "rem-alarm-overlay";
    ov.innerHTML = `
      <div class="rem-alarm-card" role="dialog" aria-modal="true">
        <button class="rem-alarm-x" id="rem-alarm-x" aria-label="Close">&times;</button>
        <div class="rem-alarm-icon" id="rem-alarm-icon"><i class="fa-solid fa-bell"></i></div>
        <div class="rem-alarm-now" id="rem-alarm-now">${tt("rem.alarm_now", "BÂY GIỜ")}</div>
        <h2 class="rem-alarm-title" id="rem-alarm-title">—</h2>
        <div class="rem-alarm-body" id="rem-alarm-body">—</div>
        <div class="rem-alarm-time" id="rem-alarm-time">--:--</div>
        <button class="rem-alarm-dismiss" id="rem-alarm-dismiss">${tt("rem.alarm_dismiss", "Đã hiểu")}</button>
      </div>`;
    document.body.appendChild(ov);
    const close = () => closeAlarm();
    ov.querySelector("#rem-alarm-x").onclick = close;
    ov.querySelector("#rem-alarm-dismiss").onclick = close;
    ov.addEventListener("click", (e) => {
      if (e.target === ov) close();
    });
    return ov;
  }
  function closeAlarm() {
    const ov = document.getElementById("rem-alarm-overlay");
    if (ov) ov.classList.remove("open");
  }
  function showAlarm(rem) {
    const ov = buildAlarmModal();
    const isMed = rem.type === "med";
    ov.classList.toggle("med", isMed);
    ov.querySelector("#rem-alarm-icon").innerHTML = isMed
      ? '<i class="fa-solid fa-pills"></i>'
      : '<i class="fa-solid fa-utensils"></i>';
    ov.querySelector("#rem-alarm-now").textContent = tt("rem.alarm_now", "BÂY GIỜ");
    ov.querySelector("#rem-alarm-title").textContent = isMed
      ? tt("rem.fire_med", "💊 Đến giờ uống thuốc")
      : tt("rem.fire_meal", "🍽️ Đến giờ ăn");
    ov.querySelector("#rem-alarm-body").textContent =
      rem.label ||
      (isMed
        ? tt("rem.alarm_default_med", "Đã đến giờ uống thuốc của bạn.")
        : tt("rem.alarm_default_meal", "Đã đến giờ ăn của bạn."));
    ov.querySelector("#rem-alarm-time").textContent = rem.time || "";
    ov.querySelector("#rem-alarm-dismiss").textContent = tt("rem.alarm_dismiss", "Đã hiểu");
    ov.classList.add("open");
    playAlarmSound();
  }

  function fire(rem) {
    const isMed = rem.type === "med";
    const title = isMed
      ? tt("rem.fire_med", "💊 Đến giờ uống thuốc")
      : tt("rem.fire_meal", "🍽️ Đến giờ ăn");
    const body =
      rem.label ||
      (isMed
        ? tt("rem.alarm_default_med", "Đã đến giờ uống thuốc của bạn.")
        : tt("rem.alarm_default_meal", "Đã đến giờ ăn của bạn."));

    // 1) Thông báo trình duyệt (nếu đã được cấp quyền)
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        const n = new Notification(title, { body, icon: "logo.png", tag: rem.id });
        n.onclick = () => {
          window.focus();
          closeAlarm();
          n.close();
        };
      } catch (e) {
        /* một số trình duyệt cần service worker */
      }
    }

    // 2) Chuông báo NỔI GIỮA màn hình + làm mờ nền + âm thanh (Yêu cầu #2)
    showAlarm(rem);
  }

  /* ---------------- Scheduler ---------------- */
  const firedToday = {}; // { 'YYYY-MM-DD_HH:MM_id': true }
  function tick() {
    const list = load();
    if (!list.length) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const cur = `${hh}:${mm}`;
    const dateKey = now.toISOString().slice(0, 10);

    list.forEach((r) => {
      if (!r.time) return;
      if (r.time !== cur) return;
      const fkey = `${dateKey}_${cur}_${r.id}`;
      if (firedToday[fkey]) return;
      firedToday[fkey] = true;
      fire(r);
      // Nếu không lặp lại -> xóa sau khi đã nhắc
      if (!r.repeat) {
        save(load().filter((x) => x.id !== r.id));
        renderList();
      }
    });
  }

  /* ---------------- UI ---------------- */
  let activeTab = "meal";

  function injectStyles() {
    if (document.getElementById("rem-style")) return;
    const s = document.createElement("style");
    s.id = "rem-style";
    s.textContent = `
      .rem-bell{position:relative;width:42px;height:42px;border-radius:12px;border:1px solid var(--border-soft,rgba(0,0,0,.07));
        background:var(--surface,#fff);color:var(--primary-deep,#3d7353);cursor:pointer;display:inline-flex;
        align-items:center;justify-content:center;font-size:16px;transition:all .2s;}
      .rem-bell:hover{background:var(--sage-50,#eaf3ee);transform:translateY(-1px);}
      .rem-bell .rem-dot{position:absolute;top:8px;right:9px;width:8px;height:8px;border-radius:50%;
        background:var(--gold,#b8975a);border:2px solid var(--surface,#fff);display:none;}
      .rem-bell.has-rem .rem-dot{display:block;}

      .rem-overlay{position:fixed;inset:0;z-index:10000;background:rgba(45,52,54,.45);backdrop-filter:blur(4px);
        display:none;align-items:flex-start;justify-content:center;padding:60px 16px;overflow:auto;}
      .rem-overlay.open{display:flex;animation:remFade .2s ease;}
      @keyframes remFade{from{opacity:0}to{opacity:1}}
      .rem-panel{width:100%;max-width:440px;background:var(--surface,#fff);border-radius:var(--radius-xl,24px);
        box-shadow:var(--shadow-lg,0 20px 50px rgba(0,0,0,.15));overflow:hidden;}
      .rem-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
        padding:20px 22px 14px;background:var(--gradient-soft,linear-gradient(180deg,#fff,#eaf3ee));}
      .rem-head h2{margin:0;font-size:18px;color:var(--primary-deep,#3d7353);}
      .rem-head p{margin:2px 0 0;font-size:12.5px;color:var(--text-sub,#636e72);}
      .rem-x{border:none;background:transparent;font-size:20px;color:var(--text-sub,#636e72);cursor:pointer;line-height:1;}
      .rem-body{padding:16px 22px 22px;}
      .rem-tabs{display:flex;gap:8px;margin-bottom:14px;}
      .rem-tab{flex:1;border:1px solid var(--border-soft,rgba(0,0,0,.07));background:var(--surface-2,#f9fbf9);
        border-radius:12px;padding:9px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;
        color:var(--text-sub,#636e72);transition:all .2s;}
      .rem-tab.active{background:var(--sage-50,#eaf3ee);color:var(--primary-deep,#3d7353);border-color:var(--primary,#58a677);}
      .rem-list{display:flex;flex-direction:column;gap:8px;margin-bottom:14px;min-height:20px;}
      .rem-empty{font-size:13px;color:var(--text-dim,#9aa39e);text-align:center;padding:14px 0;}
      .rem-item{display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:12px;
        background:var(--surface-2,#f9fbf9);border:1px solid var(--border-soft,rgba(0,0,0,.07));}
      .rem-item .rem-time{font-weight:800;color:var(--primary-deep,#3d7353);font-size:15px;min-width:52px;}
      .rem-item .rem-meta{flex:1;}
      .rem-item .rem-meta .rem-lab{font-weight:600;font-size:13.5px;}
      .rem-item .rem-meta .rem-rep{font-size:11px;color:var(--text-dim,#9aa39e);}
      .rem-item .rem-del{border:none;background:transparent;color:var(--danger,#e74c3c);cursor:pointer;font-size:15px;}
      .rem-form{display:grid;grid-template-columns:1fr 110px;gap:10px;}
      .rem-form .full{grid-column:1 / -1;}
      .rem-form label{display:block;font-size:12px;font-weight:600;color:var(--text-sub,#636e72);margin-bottom:4px;}
      .rem-form input[type=text],.rem-form input[type=time]{width:100%;padding:10px 12px;border-radius:10px;
        border:1px solid var(--border-soft,rgba(0,0,0,.12));font-family:inherit;font-size:14px;background:#fff;}
      .rem-rep-row{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-sub,#636e72);}
      .rem-add{width:100%;border:none;border-radius:12px;padding:12px;font-family:inherit;font-weight:700;
        font-size:14px;cursor:pointer;color:#fff;background:var(--gradient-primary,linear-gradient(135deg,#58a677,#3d7353));
        box-shadow:0 6px 16px -6px rgba(88,166,119,.6);transition:transform .15s;}
      .rem-add:hover{transform:translateY(-1px);}
      .rem-notif-btn{width:100%;margin-top:10px;border:1px dashed var(--primary,#58a677);background:transparent;
        color:var(--primary-deep,#3d7353);border-radius:12px;padding:10px;font-family:inherit;font-weight:600;
        font-size:13px;cursor:pointer;}
      .rem-notif-btn.ok{border-style:solid;background:var(--sage-50,#eaf3ee);}

      /* ---- Chuông báo nổi giữa màn hình (Yêu cầu #2) ---- */
      .rem-alarm-overlay{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;
        background:rgba(45,52,54,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:20px;animation:remFade .25s ease;}
      .rem-alarm-overlay.open{display:flex;}
      .rem-alarm-card{position:relative;width:100%;max-width:380px;background:var(--surface,#fff);border-radius:24px;
        box-shadow:0 30px 70px rgba(0,0,0,.3);padding:34px 26px 26px;text-align:center;
        animation:remAlarmPop .35s cubic-bezier(.2,.9,.3,1.3);}
      @keyframes remAlarmPop{0%{transform:scale(.8);opacity:0}100%{transform:scale(1);opacity:1}}
      .rem-alarm-x{position:absolute;top:12px;right:14px;border:none;background:transparent;font-size:24px;line-height:1;
        color:var(--text-sub,#636e72);cursor:pointer;width:34px;height:34px;border-radius:50%;transition:background .2s;}
      .rem-alarm-x:hover{background:var(--sage-50,#eaf3ee);}
      .rem-alarm-icon{width:84px;height:84px;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;
        font-size:38px;color:#fff;background:var(--gradient-primary,linear-gradient(135deg,#58a677,#3d7353));
        box-shadow:0 10px 26px -8px rgba(88,166,119,.8);animation:remBell 1s ease-in-out infinite;transform-origin:50% 10%;}
      .rem-alarm-overlay.med .rem-alarm-icon{background:linear-gradient(135deg,#e0a458,#b8975a);box-shadow:0 10px 26px -8px rgba(184,151,90,.8);}
      @keyframes remBell{0%,100%{transform:rotate(0)}20%{transform:rotate(14deg)}40%{transform:rotate(-12deg)}60%{transform:rotate(8deg)}80%{transform:rotate(-5deg)}}
      .rem-alarm-now{display:inline-block;font-size:11px;font-weight:800;letter-spacing:1.5px;color:var(--primary-deep,#3d7353);
        background:var(--sage-50,#eaf3ee);padding:4px 12px;border-radius:999px;margin-bottom:10px;}
      .rem-alarm-title{font-size:21px;font-weight:800;color:var(--text-main,#2d3436);margin:0 0 6px;}
      .rem-alarm-body{font-size:14.5px;color:var(--text-sub,#636e72);margin:0 0 12px;line-height:1.5;}
      .rem-alarm-time{font-size:30px;font-weight:800;color:var(--primary-deep,#3d7353);margin-bottom:18px;font-variant-numeric:tabular-nums;}
      .rem-alarm-dismiss{width:100%;border:none;border-radius:14px;padding:14px;font-family:inherit;font-weight:800;font-size:15px;cursor:pointer;
        color:#fff;background:var(--gradient-primary,linear-gradient(135deg,#58a677,#3d7353));box-shadow:0 8px 18px -6px rgba(88,166,119,.7);transition:transform .15s;}
      .rem-alarm-dismiss:hover{transform:translateY(-1px);}
    `;
    document.head.appendChild(s);
  }

  function refreshDot() {
    const bell = document.querySelector(".rem-bell");
    if (bell) bell.classList.toggle("has-rem", load().length > 0);
  }

  function renderList() {
    const wrap = document.getElementById("rem-list");
    if (!wrap) return;
    const items = load()
      .filter((r) => r.type === activeTab)
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    if (!items.length) {
      wrap.innerHTML = `<div class="rem-empty">${tt("rem.none", "Chưa có nhắc nhở nào.")}</div>`;
      return;
    }
    wrap.innerHTML = items
      .map(
        (r) => `
      <div class="rem-item" data-id="${r.id}">
        <div class="rem-time">${r.time}</div>
        <div class="rem-meta">
          <div class="rem-lab">${escapeHtml(r.label || "")}</div>
          <div class="rem-rep">${
            r.repeat
              ? '<i class="fa-solid fa-rotate"></i> ' + tt("rem.repeat", "Lặp lại hằng ngày")
              : tt("common.today", "Hôm nay")
          }</div>
        </div>
        <button class="rem-del" title="${tt("common.delete", "Xóa")}"><i class="fa-solid fa-trash-can"></i></button>
      </div>`
      )
      .join("");

    wrap.querySelectorAll(".rem-del").forEach((b) => {
      b.onclick = () => {
        const id = b.closest(".rem-item").dataset.id;
        save(load().filter((x) => x.id !== id));
        renderList();
        toast(tt("rem.deleted", "Đã xóa nhắc nhở"), "info");
      };
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function syncFormLabels() {
    const isMed = activeTab === "med";
    const labInput = document.getElementById("rem-label");
    if (labInput)
      labInput.placeholder = isMed
        ? tt("rem.label_med_ph", "VD: Uống vitamin D")
        : tt("rem.label_meal_ph", "VD: Ăn sáng");
  }

  function buildPanel() {
    const overlay = document.createElement("div");
    overlay.className = "rem-overlay";
    overlay.id = "rem-overlay";
    overlay.innerHTML = `
      <div class="rem-panel" role="dialog" aria-modal="true">
        <div class="rem-head">
          <div>
            <h2 data-i18n="rem.title">Nhắc nhở</h2>
            <p data-i18n="rem.subtitle">Nhắc uống thuốc &amp; ăn đúng giờ</p>
          </div>
          <button class="rem-x" id="rem-close">&times;</button>
        </div>
        <div class="rem-body">
          <div class="rem-tabs">
            <button class="rem-tab active" data-tab="meal" data-i18n="rem.tab_meal">Bữa ăn</button>
            <button class="rem-tab" data-tab="med" data-i18n="rem.tab_med">Uống thuốc</button>
          </div>
          <div class="rem-list" id="rem-list"></div>
          <div class="rem-form">
            <div class="full">
              <label data-i18n="rem.label">Nội dung nhắc</label>
              <input type="text" id="rem-label" placeholder="VD: Ăn sáng">
            </div>
            <div>
              <label data-i18n="rem.time">Giờ nhắc</label>
              <input type="time" id="rem-time">
            </div>
            <div style="display:flex;align-items:flex-end;">
              <label class="rem-rep-row" style="margin:0 0 8px;">
                <input type="checkbox" id="rem-repeat" checked>
                <span data-i18n="rem.repeat">Lặp lại hằng ngày</span>
              </label>
            </div>
            <button class="rem-add full" id="rem-add" data-i18n="rem.add">Thêm nhắc nhở</button>
          </div>
          <button class="rem-notif-btn" id="rem-notif"><i class="fa-regular fa-bell"></i>
            <span data-i18n="rem.enable_notif">Bật thông báo trình duyệt</span></button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closePanel();
    });
    overlay.querySelector("#rem-close").onclick = closePanel;

    overlay.querySelectorAll(".rem-tab").forEach((b) => {
      b.onclick = () => {
        activeTab = b.dataset.tab;
        overlay.querySelectorAll(".rem-tab").forEach((x) => x.classList.toggle("active", x === b));
        renderList();
        syncFormLabels();
      };
    });

    overlay.querySelector("#rem-add").onclick = () => {
      const label = document.getElementById("rem-label").value.trim();
      const time = document.getElementById("rem-time").value;
      const repeat = document.getElementById("rem-repeat").checked;
      if (!time) {
        toast(tt("rem.need_time", "Vui lòng chọn giờ nhắc"), "error");
        return;
      }
      const list = load();
      list.push({
        id: uid(),
        type: activeTab,
        label: label || (activeTab === "med" ? tt("rem.tab_med", "Uống thuốc") : tt("rem.tab_meal", "Bữa ăn")),
        time,
        repeat,
      });
      save(list);
      renderList();
      document.getElementById("rem-label").value = "";
      toast(tt("rem.saved", "Đã lưu nhắc nhở"), "success");
      requestNotif();
    };

    const notifBtn = overlay.querySelector("#rem-notif");
    notifBtn.onclick = async () => {
      const ok = await requestNotif();
      notifBtn.classList.toggle("ok", ok);
    };
    if ("Notification" in window && Notification.permission === "granted") notifBtn.classList.add("ok");
  }

  function openPanel() {
    if (!document.getElementById("rem-overlay")) buildPanel();
    if (window.i18n) window.i18n.applyTranslations(document.getElementById("rem-overlay"));
    renderList();
    syncFormLabels();
    document.getElementById("rem-overlay").classList.add("open");
  }
  function closePanel() {
    document.getElementById("rem-overlay")?.classList.remove("open");
  }

  function injectBell() {
    if (document.querySelector(".rem-bell")) return;
    const host =
      document.querySelector(".header-tools") || document.querySelector(".nav-auth");
    if (!host) return;
    const bell = document.createElement("button");
    bell.type = "button";
    bell.className = "rem-bell";
    bell.title = tt("rem.open", "Nhắc nhở");
    bell.innerHTML = `<i class="fa-regular fa-bell"></i><span class="rem-dot"></span>`;
    bell.onclick = openPanel;
    // chèn ngay trước khối user-profile để nằm cạnh nút đăng xuất
    const profile = host.querySelector(".user-profile-nav");
    if (profile) host.insertBefore(bell, profile);
    else host.appendChild(bell);
    refreshDot();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAlarm();
      closePanel();
    }
  });

  document.addEventListener("langchange", () => {
    if (document.getElementById("rem-overlay")) {
      window.i18n && window.i18n.applyTranslations(document.getElementById("rem-overlay"));
      renderList();
      syncFormLabels();
    }
  });

  function boot() {
    // Chỉ chạy khi đã đăng nhập (có token)
    if (!localStorage.getItem("calorie_ai_token")) return;
    injectStyles();
    injectBell();
    tick();
    setInterval(tick, 20000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.reminders = { open: openPanel, load, save };
})();
