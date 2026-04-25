
document.getElementById('signupForm').onsubmit = async (e) => {
    e.preventDefault();
    

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;


    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang đăng ký...`;

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const birthYear = document.getElementById('birthYear').value;
    const weight = document.getElementById('weight').value;
    const height = document.getElementById('height').value;

    try {
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'register',
                email: `${username}@gmail.com`,
                password,
                username,
                birthYear,
                weight,
                height
            })
        });

        const result = await response.json();

        if (response.ok) {
            showToast("Đăng ký thành công! Bạn có thể đăng nhập ngay.", "success");
            window.location.href = "signin.html";
        } else {
            showToast("Lỗi đăng ký: " + result.error, "error");

            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
        }
    } catch (err) {
        console.error("Lỗi kết nối:", err);
        showToast("Không thể kết nối tới máy chủ.", "error");

        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
    }
};