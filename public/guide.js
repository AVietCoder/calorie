/* guide.js — auth check + scroll spy cho trang hướng dẫn.
 * admin-link.js xử lý việc inject nav ADMIN + kiểm tra is_admin.
 * guide.js không làm trùng lặp — chỉ dùng kết quả từ admin-link cache. */

document.addEventListener('DOMContentLoaded', async () => {
  const sideNav = document.querySelector('.side-nav');
  const headerTools = document.querySelector('.header-tools');
  const logo = document.querySelector('.logo');

  /* ── Loading overlay ── */
  function showLoader() {
    const el = document.createElement('div');
    el.className = 'loading-overlay';
    el.id = 'page-loader';
    el.innerHTML = `
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    `;
    document.body.appendChild(el);
  }

  function hideLoader() {
    const el = document.getElementById('page-loader');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }

  /* ── Auth mode helpers ── */
  function applyGuestMode() {
    const loginNote = document.getElementById('login-note');
    const siu = document.getElementById('siu');
    if (loginNote) loginNote.style.display = 'block';
    document.body.classList.remove('has-auth');
    document.body.classList.add('no-auth');
    if (siu) siu.onclick = () => { location.href = 'index.html'; };
    if (logo) logo.href = 'index.html';
  }

  function applyUserMode() {
    document.body.classList.remove('no-auth');
    document.body.classList.add('has-auth');
    if (sideNav) sideNav.style.display = '';
    if (headerTools) headerTools.style.display = '';
    if (logo) logo.href = 'chat.html';
  }

  /* ── Hiện section + TOC link cho admin ── */
  function revealAdminSection() {
    const section = document.getElementById('admin-section');
    const tocLink = document.getElementById('toc-admin-link');
    const toc = document.getElementById('toc');
    if (section) section.style.display = '';
    if (tocLink) tocLink.style.display = '';
    // Thêm section vào danh sách scroll spy
    if (toc) rebuildScrollSpy();
  }

  showLoader();

  try {
    const token = localStorage.getItem('calorie_ai_token');

    if (!token) {
      applyGuestMode();
    } else {
      const res = await fetch('/api/status', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();

      if (res.ok && data.success) {
        applyUserMode();

        // Kiểm tra admin từ sessionStorage (đã được admin-link.js set trước)
        // hoặc fetch nếu chưa có
        const cached = sessionStorage.getItem('calorie_is_admin');
        if (cached === 'true') {
          revealAdminSection();
        } else if (!cached) {
          // Chờ admin-link.js chạy xong (nó async), poll 1 lần sau 500ms
          setTimeout(() => {
            if (sessionStorage.getItem('calorie_is_admin') === 'true') {
              revealAdminSection();
            }
          }, 600);
        }
      } else {
        localStorage.removeItem('calorie_ai_token');
        applyGuestMode();
      }
    }
  } catch (err) {
    console.error('Check auth failed:', err);
    applyGuestMode();
  } finally {
    hideLoader();
  }

  /* ── Scroll spy ── */
  function rebuildScrollSpy() {
    const links = document.querySelectorAll('.toc a');
    const sections = [...links].map(a => {
      const href = a.getAttribute('href');
      return href ? document.querySelector(href) : null;
    });

    const onScroll = () => {
      const y = window.scrollY + 140;
      let activeIdx = 0;
      sections.forEach((s, i) => {
        if (s && s.offsetTop <= y) activeIdx = i;
      });
      links.forEach((l, i) => l.classList.toggle('active', i === activeIdx));
    };

    // Remove old listener if exists
    document.removeEventListener('scroll', window._guideScrollSpy);
    window._guideScrollSpy = onScroll;
    document.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    links.forEach(a => {
      // Re-bind to avoid duplicate listeners
      const newA = a.cloneNode(true);
      a.parentNode.replaceChild(newA, a);
      newA.addEventListener('click', e => {
        e.preventDefault();
        const t = document.querySelector(newA.getAttribute('href'));
        if (t) window.scrollTo({ top: t.offsetTop - 90, behavior: 'smooth' });
      });
    });
  }

  rebuildScrollSpy();
});
