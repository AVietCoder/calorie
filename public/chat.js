window.currentConvId = null;
  let isAnalyzing = false;
  let isLoadingHistory = false;
  let flag = false;
  let pendingMealData = null;
  let selectedMealTime = "";
  let selectedDayMode = "today";
  const sessionPhotos = [];
  let pastedImageFile = null;

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

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  // Markdown nội dòng: **đậm**, *nghiêng*, `code`
  function inlineMd(s) {
    return s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  // Chuyển markdown của model (###, **, gạch đầu dòng) thành HTML an toàn.
  function renderMarkdown(text) {
    const lines = escapeHtml(text).split('\n');
    const out = [];
    let inList = false;
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    for (const line of lines) {
      const h = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
      const li = line.match(/^\s*[-*•]\s+(.+?)\s*$/);
      if (h) {
        closeList();
        const lvl = h[1].length;
        out.push(`<h${lvl} class="md-h">${inlineMd(h[2])}</h${lvl}>`);
      } else if (li) {
        if (!inList) { out.push('<ul class="md-ul">'); inList = true; }
        out.push(`<li>${inlineMd(li[1])}</li>`);
      } else if (line.trim() === '') {
        closeList();
      } else {
        closeList();
        out.push(`<div class="md-p">${inlineMd(line)}</div>`);
      }
    }
    closeList();
    return out.join('');
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
    // Ẩn phần "YÊU CẦU BẮT BUỘC" trở xuống trong tin nhắn xác nhận bữa ăn (chỉ ẩn hiển thị, không ảnh hưởng dữ liệu)
    if (displayContent.includes('[XÁC NHẬN BỮA ĂN THỰC TẾ')) {
      const cutKeywords = ['YÊU CẦU BẮT BUỘC', 'Nếu không thể update'];
      for (const kw of cutKeywords) {
        const idx = displayContent.indexOf(kw);
        if (idx !== -1) {
          displayContent = displayContent.substring(0, idx).trim();
          break;
        }
      }
    }
    displayContent = displayContent.replace(/\n{3,}/g, '\n\n').trim();
    msgDiv.style.whiteSpace = 'normal';
    msgDiv.innerHTML = renderMarkdown(displayContent || 'Đang phân tích dữ liệu...');

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

      const codeBlock = document.getElementById('nutrition-code');
      if (codeBlock) {
        const payload = {
          description: data.description || '',
          calories: data.calories ?? 0,
          protein: data.protein || '0g',
          fat: data.fat || '0g',
          carbs: data.carbs || '0g',
          fiber: data.fiber || '0g',
          sugar: data.sugar || '0g',
          sodium: data.sodium || '0mg',
        };
        codeBlock.textContent = JSON.stringify(payload, null, 2);
      }
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
        // ĐỒNG BỘ: lưu thực đơn mới + phát tín hiệu để Lịch/Dashboard/Thống kê cập nhật ngay.
        try {
          if (result.newPlan) {
            localStorage.setItem('calorie_weekly_plan_cache', JSON.stringify(result.newPlan));
          }
          localStorage.setItem('calorie_plan_dirty', String(Date.now()));
          window.dispatchEvent(new CustomEvent('calorie:plan-updated', { detail: { at: Date.now() } }));
        } catch (_) {}
        if (typeof showToast === 'function') showToast('Đã cập nhật thời khóa biểu & thống kê!', 'success');
      } else {
        renderMessage('bot', result.reply || result.error || 'Mình chưa cập nhật được, bạn thử lại nhé.');
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
    const codeBlock = document.getElementById('nutrition-code');
    if (codeBlock) codeBlock.textContent = '{}';
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

  function handlePastedImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    // Chuyển file sang jpeg nếu cần (để tương thích với backend chỉ nhận jpg)
    const reader = new FileReader();
    reader.onload = function(e) {
      const base64Data = e.target.result;
      // Hiển thị preview ảnh lên sidebar
      document.getElementById('display-food-img').src = base64Data;

      // Tạo File object từ blob để dùng như file upload bình thường
      const mime = file.type || 'image/jpeg';
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpeg';
      // Convert sang jpeg để backend không bị lỗi
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function(blob) {
          pastedImageFile = new File([blob], 'pasted-image.jpg', { type: 'image/jpeg' });
          // Hiển thị preview trong input area
          showPastePreview(base64Data);
          // Tự động điền placeholder text nếu input trống
          const input = document.getElementById('user-input');
          if (input && !input.value.trim()) {
            input.value = 'Phân tích hình ảnh này';
          }
          if (typeof showToast === 'function') showToast('Đã dán ảnh! Nhấn Gửi để phân tích.', 'info');
        }, 'image/jpeg', 0.92);
      };
      img.src = base64Data;
    };
    reader.readAsDataURL(file);
  }

  function showPastePreview(base64Data) {
    // Xoá preview cũ nếu có
    const oldPreview = document.getElementById('paste-preview-container');
    if (oldPreview) oldPreview.remove();

    const inputWrapper = document.querySelector('.input-wrapper');
    if (!inputWrapper) return;

    const previewContainer = document.createElement('div');
    previewContainer.id = 'paste-preview-container';
    previewContainer.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-card,#f5f5f5);border-radius:10px;margin-bottom:6px;';

    const thumb = document.createElement('img');
    thumb.src = base64Data;
    thumb.style.cssText = 'width:48px;height:48px;object-fit:cover;border-radius:6px;border:1.5px solid var(--border,#ddd);';

    const label = document.createElement('span');
    label.style.cssText = 'font-size:13px;color:var(--text-sub,#888);flex:1;';
    label.textContent = 'Ảnh vừa dán (Ctrl+V)';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.title = 'Xoá ảnh';
    removeBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:#e74c3c;font-size:16px;padding:2px 6px;';
    removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    removeBtn.onclick = function() {
      previewContainer.remove();
      pastedImageFile = null;
      document.getElementById('display-food-img').src = 'https://i.pinimg.com/736x/9d/51/c3/9d51c32cccb77dcf89cc2fb11aa20a17.jpg';
      const input = document.getElementById('user-input');
      if (input && input.value === 'Phân tích hình ảnh này') input.value = '';
    };

    previewContainer.appendChild(thumb);
    previewContainer.appendChild(label);
    previewContainer.appendChild(removeBtn);

    // Chèn preview phía trên input-wrapper
    inputWrapper.parentNode.insertBefore(previewContainer, inputWrapper);
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

  // Tối ưu ảnh trước khi gửi: scale về ~1 triệu pixel (giữ tỷ lệ), JPEG chất lượng cao.
  // ~1MP là "điểm ngọt" cho Qwen2.5-VL (nét + nhanh). Không phóng to ảnh nhỏ.
  async function optimizeImageFile(file, targetPixels = 1048576, quality = 0.9) {
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = (e) => res(e.target.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = dataUrl;
      });
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) return file;
      const scale = Math.min(1, Math.sqrt(targetPixels / (w * h)));
      const nw = Math.max(1, Math.round(w * scale));
      const nh = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = nw;
      canvas.height = nh;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, nw, nh);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
      if (!blob) return file;
      const base = (file.name || 'image').replace(/\.[^.]+$/, '');
      return new File([blob], base + '.jpg', { type: 'image/jpeg' });
    } catch {
      return file;
    }
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
    // Ưu tiên file từ input, nếu không có thì dùng ảnh paste
    let file = fileInput?.files?.[0] || pastedImageFile;
    flag = false;
    if (!text && !file) return;
    if (file && fileInput?.files?.[0] && !file.name.toLowerCase().endsWith('.jpg') && !file.name.toLowerCase().endsWith('.jpeg')) {
      if (typeof showToast === 'function') showToast('Chỉ được gửi ảnh JPG!', 'error');
      return;
    }
    // Tối ưu ảnh (giảm ~1MP, giữ tỷ lệ) trước khi gửi -> nhanh + nét vừa đủ cho model
    if (file) file = await optimizeImageFile(file);
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
      // Xoá paste preview và reset pastedImageFile sau khi gửi
      document.getElementById('paste-preview-container')?.remove();
      pastedImageFile = null;
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

    // Lắng nghe sự kiện paste ảnh (Ctrl+V) trên toàn trang
    document.addEventListener('paste', function(e) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handlePastedImage(file);
          }
          break;
        }
      }
    });
  });