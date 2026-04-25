
document.addEventListener('DOMContentLoaded', async () => {
const authZone = document.getElementById('auth-zone');
const token = localStorage.getItem('calorie_ai_token');


authZone.innerHTML = `
    <div class="nav-loading" id="navLoading">
        <span></span>
        <span></span>
        <span></span>
    </div>
`;

function renderGuest() {
    authZone.innerHTML = `
        <a href="signin.html" class="nav-link nav-item">Đăng nhập</a>
        <a href="signup.html" class="btn-primary nav-item">
            <i class="fa-solid fa-user-plus"></i> Đăng ký
        </a>
    `;
    animateItems();
}

function renderUser() {
    authZone.innerHTML = `
        <div class="user-profile-nav nav-item"
                onclick="handleLogout()"
                style="cursor:pointer;"
                title="Nhấn để đăng xuất">
            <span class="user-name">
                <i class="fa-solid fa-circle-user"></i>
                Đăng xuất
            </span>
            <div class="btn-logout">
                <i class="fa-solid fa-right-from-bracket"></i>
            </div>
        </div>
    `;
    animateItems();
}

function animateItems() {
    const items = authZone.querySelectorAll('.nav-item');

    items.forEach(el => {
        el.style.opacity = "0";
        el.style.transform = "translateY(-6px)";
    });

    requestAnimationFrame(() => {
        items.forEach(el => {
            el.style.transition = "all .35s ease";
            el.style.opacity = "1";
            el.style.transform = "translateY(0)";
        });
    });
}

function finish(type) {
    const loading = document.getElementById('navLoading');

    if (loading) {
        loading.style.opacity = "0";
        loading.style.transform = "translateY(-4px)";
        loading.style.transition = "all .25s ease";
    }

    setTimeout(() => {
        if (type === 'user') renderUser();
        else renderGuest();
    }, 250);
}


if (!token) {
    setTimeout(() => finish('guest'), 500);
    return;
}

try {
    const res = await fetch('/api/status', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    const data = await res.json();

    if (res.ok && data.success) {
        finish('user');
    } else {
        localStorage.removeItem('calorie_ai_token');
        localStorage.removeItem('user_id');
        finish('guest');
    }

} catch (err) {
    console.error(err);
    finish('guest');
}
});

async function handleLogout() {
const token = localStorage.getItem('calorie_ai_token');

try {
    await fetch('/api/auth', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'logout' })
    });
} catch (e) {
    console.error('Lỗi gọi API logout:', e);
} finally {
    localStorage.removeItem('calorie_ai_token');
    localStorage.removeItem('user_id');

    showToast("Đã đăng xuất thành công!", "info");

    setTimeout(() => {
        window.location.reload();
    }, 1000);
}
}