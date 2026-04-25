
document.addEventListener('DOMContentLoaded', async () => {
  const sideNav = document.querySelector('.side-nav');
  const headerTools = document.querySelector('.header-tools');
  const logo = document.querySelector('.logo');
  const content = document.querySelector('.content');

  let loader = null;

  function showLoader() {
    loader = document.createElement('div');
    loader.className = 'loading-overlay';
    loader.id = 'page-loader';
    loader.innerHTML = `
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    `;
    document.body.appendChild(loader);
  }

  function hideLoader() {
    const el = document.getElementById('page-loader');
    if (!el) return;

    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }

  showLoader();
  function applyGuestMode() {
    document.body.classList.remove('has-auth');
    document.body.classList.add('no-auth');
    const siu = document.getElementById('siu');
    siu.onclick = () => {
      location.href='index.html';
    };
    if (logo) logo.href = 'index.html';
  }

  function applyUserMode() {
    document.body.classList.remove('no-auth');
    document.body.classList.add('has-auth');

    if (sideNav) sideNav.style.display = '';
    if (headerTools) headerTools.style.display = '';
    if (logo) logo.href = 'chat.html';
  }

  try {
    const token = localStorage.getItem('calorie_ai_token');

    if (!token) {
      applyGuestMode();
    } else {
      const res = await fetch('/api/status', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await res.json();

      if (res.ok && data.success) {
        applyUserMode();
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

  const links = document.querySelectorAll('.toc a');
  const sections = [...links].map(a =>
    document.querySelector(a.getAttribute('href'))
  );

  const onScroll = () => {
    const y = window.scrollY + 140;
    let activeIdx = 0;

    sections.forEach((s, i) => {
      if (s && s.offsetTop <= y) activeIdx = i;
    });

    links.forEach((l, i) =>
      l.classList.toggle('active', i === activeIdx)
    );
  };

  document.addEventListener('scroll', onScroll, { passive: true });

  links.forEach(a =>
    a.addEventListener('click', e => {
      e.preventDefault();

      const t = document.querySelector(a.getAttribute('href'));
      if (t) {
        window.scrollTo({
          top: t.offsetTop - 90,
          behavior: 'smooth'
        });
      }
    })
  );
});