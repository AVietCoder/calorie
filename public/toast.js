/**
 * Hiển thị thông báo thay thế alert()
 * @param {string} message - Nội dung thông báo
 * @param {string} type - Loại: 'success', 'error', 'info'
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Tạo phần tử toast
    const toast = document.createElement('div');
    toast.className = `toast-msg ${type}`;
    
    // Icon tương ứng
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Tự động xóa sau 4 giây
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}