
  window.currentConvId = null;
  let isAnalyzing = false;
  let isLoadingHistory = false;
  let flag = false;
  let pendingMealData = null;
  let selectedMealTime = "";
  let selectedDayMode = "today";
  const sessionPhotos = [];

  function handleLogout() {
    localStorage.removeItem('calorie_ai_token');
    localStorage.removeItem('user_id');
    if (typeof showToast === 'function') showToast('Đang đăng xuất...', 'info');
    setTimeout(() => { window.location.href = 'signin.html'; }, 1000);
  }

  function toggleInputState(disabled, placeholder = 'Hỏi tôi liên quan về dinh dưỡng...') {
    const input = document.getElementById('user-input');
    const btn = document.querySelector('.send-btn');
    const uploadBtn = document.querySelector('.input-tools');
    if (input) input.disabled = disabled;
    if (btn) btn.disabled = disabled;
    if (uploadBtn) uploadBtn.style.pointerEvents = disabled ? 'none' : 'auto';
    if (input) input.placeholder = placeholder;
  }

  function showTypingIndicator() {
    const chatWindow = document.getElementById('chat-window');
    if (!chatWindow) return;
    document.getElementById('typing-indicator-box')?.remove();
    const typingDiv = document.createElement('div');
    typingDiv.id = 'typing-indicator-box';
    typingDiv.className = 'typing-indicator';
    typingDiv.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    chatWindow.appendChild(typingDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function renderMessage(role, text) {
    const chatWindow = document.getElementById('chat-window');
    if (!chatWindow) return;
    let displayContent = String(text ?? '').trim();
    if (displayContent.includes('<deleted please>')) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'msg-container ' + (role === 'user' ? 'msg-user' : 'msg-bot');
    msgDiv.style.whiteSpace = 'pre-line';

    displayContent = displayContent.replace(/<message>[\s\S]*?<\/message>/g, '');
    displayContent = displayContent.replace(/<data>[\s\S]*?<\/data>/g, '');
    displayContent = displayContent.replace(/<image>[\s\S]*?<\/image>/g, '');
    displayContent = displayContent.replace(/<error>[\s\S]*?<\/error>/g, '');
    displayContent = displayContent.replace(/<deleted>[\s\S]*?<deleted>/gi, '');
    const urlIndex = displayContent.indexOf('có url:');
    if (urlIndex !== -1) displayContent = displayContent.substring(0, urlIndex).trim();
    if (displayContent.includes('Nội dung cụ thể:')) {
      const parts = displayContent.split('Nội dung cụ thể:');
      const prefix = parts[0].trim();
      const suffix = parts[1].trim();
      displayContent = (prefix === suffix || suffix === '') ? prefix : suffix;
    }
    displayContent = displayContent.replace(/\n{3,}/g, '\n\n').trim();
    msgDiv.innerText = displayContent || 'Đang phân tích dữ liệu...';

    chatWindow.appendChild(msgDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function updateSidebar(jsonText) {
    try {
      const data = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
      document.getElementById('val-calories').innerText = data.calories || 0;
      document.getElementById('val-desc').innerText = data.description || '';
      document.getElementById('val-protein').innerText = data.protein || '--';
      document.getElementById('val-fat').innerText = data.fat || '--';
      document.getElementById('val-carbs').innerText = data.carbs || '--';
      document.getElementById('val-fiber').innerText = data.fiber || '--';
      document.getElementById('val-sugar').innerText = data.sugar || '--';
      document.getElementById('val-sodium').innerText = data.sodium || '--';
    } catch (e) { console.error('Lỗi cập nhật Sidebar:', e); }
  }

  function extractDataBlock(text = '') {
    const match = String(text).match(/<data>([\s\S]*?)<\/data>/i);
    if (!match) return null;
    try { return JSON.parse(match[1]); } catch { return null; }
  }

  function openMealModal(nutritionData) {
    pendingMealData = nutritionData;
    const chatWindow = document.getElementById('chat-window');
    const template = document.getElementById('meal-selection-template');
    if (!template || !chatWindow) return;
    const container = document.createElement('div');
    container.className = 'meal-inline-container';
    container.appendChild(template.content.cloneNode(true));
    chatWindow.appendChild(container);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function closeMealModal() {
    const modal = document.getElementById('meal-modal');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('modal-lock');
  }

  function wireMealModalEvents() {
    const chatWindow = document.getElementById('chat-window');
    if (!chatWindow) return;
    chatWindow.onclick = async (e) => {
      const target = e.target;
      const container = target.closest('.meal-inline-container');
      if (!container) return;

      if (target.classList.contains('meal-choice-btn') && target.hasAttribute('data-meal-time')) {
        container.querySelectorAll('.meal-choice-btn[data-meal-time]').forEach(b => b.classList.remove('active'));
        target.classList.add('active');
      }

      if (target.classList.contains('day-btn')) {
        container.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
        target.classList.add('active');
        const inputWrap = container.querySelector('.other-day-wrap');
        if (target.dataset.dayMode === 'other') {
          inputWrap.classList.remove('hidden');
          const dateInp = container.querySelector('.other-day-input');
          if (!dateInp.value) dateInp.value = new Date().toISOString().split('T')[0];
        } else {
          inputWrap.classList.add('hidden');
        }
      }

      if (target.classList.contains('btn-cancel-meal')) {
        container.remove();
        renderMessage('bot', 'Đã hủy. Bạn có thể nhập món khác.');
        pendingMealData = null;
      }

      if (target.classList.contains('btn-confirm-meal')) {
        const activeTime = container.querySelector('.meal-choice-btn[data-meal-time].active');
        const activeDay = container.querySelector('.day-btn.active');
        if (!activeTime) return showToast('Hãy chọn buổi ăn', 'info');
        const time = activeTime.dataset.mealTime;
        const mode = activeDay.dataset.dayMode;
        const dateVal = mode === 'today' ? 'today' : container.querySelector('.other-day-input').value;
        container.remove();
        submitMealUpdate(time, mode, dateVal);
      }
    };
  }

  async function submitMealUpdate(mealTime, dayMode, dayValue) {
    const displayDate = dayValue === 'today' ? 'hôm nay' : dayValue;
    const confirmMessage = `Xác nhận: Ăn vào buổi ${mealTime}, ${displayDate}`;
    renderMessage('user', confirmMessage);
    showTypingIndicator();
    toggleInputState(true, 'Đang cập nhật thực đơn...');

    const token = localStorage.getItem('calorie_ai_token');
    const formData = new FormData();
    formData.append('message', confirmMessage);
    formData.append('followupType', 'meal_time_update');
    formData.append('mealData', JSON.stringify(pendingMealData));
    formData.append('mealTime', mealTime);
    formData.append('mealDayText', displayDate);
    formData.append('mealDayValue', dayValue);
    try {
      const res = await fetch('/api/chat', { method:'POST', body:formData, headers:{ 'Authorization':`Bearer ${token}` } });
      const result = await res.json();
      document.getElementById('typing-indicator-box')?.remove();
      if (result.success) {
        renderMessage('bot', result.reply || 'Đã ghi lại bữa ăn của bạn!');
        if (result.newPlan) console.log("Thực đơn mới:", result.newPlan);
      }
    } catch (err) {
      document.getElementById('typing-indicator-box')?.remove();
      showToast('Lỗi kết nối server', 'error');
    } finally {
      toggleInputState(false);
      pendingMealData = null;
    }
  }

  function resetSidebar() {
    document.getElementById('val-calories').innerText = 0;
    document.getElementById('val-desc').innerText = 'Thông tin sẽ cập nhật sau khi phân tích.';
    document.getElementById('val-protein').innerText = '--';
    document.getElementById('val-fat').innerText = '--';
    document.getElementById('val-carbs').innerText = '--';
    document.getElementById('val-fiber').innerText = '--';
    document.getElementById('val-sugar').innerText = '--';
    document.getElementById('val-sodium').innerText = '--';
    document.getElementById('display-food-img').src = 'https://i.pinimg.com/736x/9d/51/c3/9d51c32cccb77dcf89cc2fb11aa20a17.jpg';
  }

  async function loadChatHistory() {
    const token = localStorage.getItem('calorie_ai_token');
    if (!token || isLoadingHistory) return;
    isLoadingHistory = true;
    toggleInputState(true, 'Đang tải lịch sử...');

    const chatSection = document.querySelector('.chat-section');
    const loader = document.createElement('div');
    loader.className = 'loading-overlay';
    loader.id = 'history-loader';
    loader.innerHTML = '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
    if (chatSection) chatSection.appendChild(loader);

    try {
      const res = await fetch('/api/chat-history', { method:'GET', headers:{ Authorization:`Bearer ${token}` } });
      const data = await res.json();
      if (res.ok === false) {
        if (typeof showToast === 'function') showToast('Vui lòng đăng nhập!', 'info');
        setTimeout(() => { window.location.href = 'signin.html'; }, 1369);
        return;
      }
      if (data.history && Array.isArray(data.history)) {
        data.history.forEach(msg => renderMessage(msg.role, msg.content));
      }
    } catch (e) {
      console.error(e);
      if (typeof showToast === 'function') showToast('Vui lòng đăng nhập!', 'info');
      setTimeout(() => { window.location.href = 'signin.html'; }, 1369);
    } finally {
      isLoadingHistory = false;
      document.getElementById('history-loader')?.remove();
      toggleInputState(false);
    }
  }

  async function handleFileSelect() {
    const file = document.getElementById('file-upload')?.files?.[0];
    const input = document.getElementById('user-input');
    if (!file || !input) return;
    if (!file.name.toLowerCase().endsWith('.jpg') && !file.name.toLowerCase().endsWith('.jpeg')) {
      if (typeof showToast === 'function') showToast('Chỉ được upload ảnh JPG!', 'error');
      document.getElementById('file-upload').value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
      const base64Data = e.target.result;
      document.getElementById('display-food-img').src = base64Data;
      input.value = 'Phân tích hình ảnh này';
    };
    reader.readAsDataURL(file);
  }

  async function sendMessage() {
    if (isAnalyzing || isLoadingHistory) return;
    const token = localStorage.getItem('calorie_ai_token');
    if (!token) {
      if (typeof showToast === 'function') showToast('Vui lòng đăng nhập!', 'info');
      window.location.href = 'signin.html';
      return;
    }
    const input = document.getElementById('user-input');
    const fileInput = document.getElementById('file-upload');
    const text = input ? input.value.trim() : '';
    const file = fileInput?.files?.[0];
    flag = false;
    if (!text && !file) return;
    if (file && !file.name.toLowerCase().endsWith('.jpg') && !file.name.toLowerCase().endsWith('.jpeg')) {
      if (typeof showToast === 'function') showToast('Chỉ được gửi ảnh JPG!', 'error');
      return;
    }
    let currentFileBase64 = null;
    if (file) {
      currentFileBase64 = await new Promise(resolve => {
        const r = new FileReader();
        r.onload = (e) => resolve(e.target.result);
        r.readAsDataURL(file);
      });
    }
    isAnalyzing = true;
    toggleInputState(true, 'AI đang phân tích...');
    renderMessage('user', text || (file ? '[Người dùng đã gửi ảnh]' : ''));
    showTypingIndicator();

    const formData = new FormData();
    if (file && sessionPhotos.includes(currentFileBase64)) {
      formData.append('message', 'Bạn hãy phân tích món ăn gần nhất tui vừa mới hỏi bạn ấy');
    } else {
      formData.append('message', text);
      if (file) formData.append('image', file);
    }

    try {
      const res = await fetch('/api/chat', { method:'POST', body:formData, headers:{ Authorization:`Bearer ${token}` } });
      const result = await res.json();
      document.getElementById('typing-indicator-box')?.remove();
      if (result.reply) {
        if (result.reply.includes('<error>')) {
          const errorMatch = result.reply.match(/<error>([\s\S]*?)<\/error>/);
          const errorMsg = errorMatch ? errorMatch[1] : 'Không phải thức ăn';
          if (typeof showToast === 'function') showToast(errorMsg, 'error');
          flag = true;
          renderMessage('bot', result.reply);
          resetSidebar();
          return;
        }
        renderMessage('bot', result.reply);
        const dataMatch = result.reply.match(/<data>([\s\S]*?)<\/data>/);
        if (dataMatch && dataMatch[1]) {
          updateSidebar(dataMatch[1]);
          try {
            const nutritionData = JSON.parse(dataMatch[1]);
            openMealModal(nutritionData);
          } catch (e) { console.error('Không parse được data dinh dưỡng:', e); }
          if (file && !sessionPhotos.includes(currentFileBase64)) sessionPhotos.push(currentFileBase64);
        }
      }
    } catch (e) {
      console.error(e);
      if (!flag && typeof showToast === 'function') showToast('Có lỗi đang xảy ra!', 'error');
    } finally {
      isAnalyzing = false;
      toggleInputState(false);
      if (input) input.value = '';
      if (fileInput) fileInput.value = '';
    }
  }

  function initNavigation() {
    document.getElementById('nav-diet').onclick = () => window.location.href = 'diet-details.html';
    document.getElementById('nav-plan').onclick = () => window.location.href = 'schedule.html';
    document.getElementById('nav-profile').onclick = () => window.location.href = 'setup.html';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const dateInput = document.getElementById('meal-date-input');
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
                dateInput.setAttribute('max', today);
                dateInput.value = today;
    }
    wireMealModalEvents();
    initNavigation();
    const token = localStorage.getItem('calorie_ai_token');
    if (!token) {
      if (typeof showToast === 'function') showToast('Vui lòng đăng nhập!', 'info');
      setTimeout(() => { window.location.href = 'signin.html'; }, 1369);
      return;
    }
    loadChatHistory();
    const input = document.getElementById('user-input');
    if (input) input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
  });