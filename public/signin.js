
document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    
    const loginBtn = e.target.querySelector('.btn-auth');
    const originalBtnText = loginBtn.innerHTML; 
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="fas fa-spinner"></i> Đang xác thực...';

    try {
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'login',
                email: username + "@gmail.com",
                password: password
            })
        });

        const result = await response.json();

        if (response.ok) {
            showToast("Đăng nhập thành công!", "success");
            localStorage.setItem('calorie_ai_token', result.token); 
            localStorage.setItem('user_id', result.user.id);
            
            setTimeout(() => {
                window.location.href = "guide.html";
            }, 800);
        } else {
            showToast(result.error, "error");
            loginBtn.disabled = false;
            loginBtn.innerHTML = originalBtnText;
        }
    } catch (err) {
        showToast("Lỗi kết nối hệ thống.", "error");
        loginBtn.disabled = false;
        loginBtn.innerHTML = originalBtnText;
    }
};