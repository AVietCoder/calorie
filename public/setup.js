 document.getElementById('disease').addEventListener('change', function () {
  const custom = document.getElementById('customDisease');
  const finalDisease = document.getElementById('finalDisease');

  if (this.value === 'Khác') {
    custom.style.display = 'block';
    finalDisease.value = '';
  } else {
    custom.style.display = 'none';
    custom.value = '';
    finalDisease.value = this.value;
  }
});

document.getElementById('customDisease').addEventListener('input', function () {
  document.getElementById('finalDisease').value = this.value.trim();
});
  /* Backend logic preserved verbatim */
  document.querySelector('.nav-item:nth-child(1)').onclick = () => window.location.href = 'chat.html';
  document.querySelector('.nav-item:nth-child(2)').onclick = () => window.location.href = 'diet-details.html';
  document.querySelector('.nav-item:nth-child(3)').onclick = () => window.location.href = 'schedule.html';

  function handleLogout() {
    localStorage.removeItem('calorie_ai_token');
    window.location.href = "signin.html";
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof loadCurrentData === "function") {
      const token = localStorage.getItem('calorie_ai_token');
      if (token) {
        loadCurrentData(token);
      }
    }
  });

  let currentStep = 0;
  const steps = document.getElementsByClassName("step");
  const progressSteps = document.getElementsByClassName("progress-step");

  function nextPrev(n) {
    if (n == 1 && !validateForm()) return false;
    steps[currentStep].classList.remove("active");
    currentStep = currentStep + n;
    if (currentStep >= steps.length) { submitForm(); return false; }
    showStep(currentStep);
  }

  function showStep(n) {
    steps[n].classList.add("active");
    document.getElementById("prevBtn").style.display = n == 0 ? "none" : "inline-flex";
    document.getElementById("nextBtn").innerHTML = n == (steps.length - 1)
      ? 'Hoàn tất lộ trình <i class="fa-solid fa-check"></i>'
      : 'Tiếp tục <i class="fa-solid fa-arrow-right"></i>';
    updateProgress(n);
  }

  function updateProgress(n) {
    for (let i = 0; i < progressSteps.length; i++) {
      progressSteps[i].classList.toggle("active", i <= n);
    }
  }

function selectGoal(el, val) {
  document.querySelectorAll('.goal-item').forEach(item => item.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('main_goal').value = val;

  const diseaseGroup = document.getElementById('disease-group');
  const diseaseSelect = document.getElementById('disease');

  if (val === 'disease') {
    diseaseGroup.style.display = 'block';
  } else {
    diseaseGroup.style.display = 'none';
    diseaseSelect.value = '';
  }
}

  function validateForm() {}

  async function submitForm() {
    const btn = document.getElementById("nextBtn");
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tính toán...';
    btn.disabled = true;

    const formData = new FormData(document.getElementById("planForm"));
    const data = Object.fromEntries(formData.entries());
    data.goal = document.getElementById('main_goal').value;
    data.disease = document.getElementById('main_goal').value === 'disease'
      ? document.getElementById('disease').value
      : '';
    const token = localStorage.getItem('calorie_ai_token');

    try {
      const res = await fetch('/api/setup', {
        method:'POST',
        headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json' },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      if (res.ok && result.success) {
        btn.innerHTML = '<i class="fas fa-check"></i> Hoàn tất!';
        showToast("Hoàn tất!", "success");
        window.location.href = "diet-details.html";
      } else {
        throw new Error(result.message || "Lỗi khi lưu dữ liệu");
      }
    } catch (error) {
      console.error("Lỗi:", error);
      showToast("Có lỗi xảy ra: " + error.message, "error");
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  function showLoader() {
    const card = document.querySelector('.setup-card');
    if (document.getElementById('setup-loader')) return;
    const loader = document.createElement('div');
    loader.className = 'loading-overlay';
    loader.id = 'setup-loader';
    loader.style.position = 'absolute';
    loader.style.borderRadius = 'var(--radius-xl)';
    loader.innerHTML = '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
    card.appendChild(loader);
  }

  function hideLoader() {
    const loader = document.getElementById('setup-loader');
    if (loader) loader.remove();
  }
async function loadCurrentData(token) {
    showLoader();
    try {
      const res = await fetch('/api/diet-info', { headers: { 'Authorization': `Bearer ${token}` } });
      const result = await res.json();
      if (result.success && result.data && result.data.profile) {
        const p = result.data.profile;
        console.log("Dữ liệu cũ đã được tải:", p);
        if (p.deadline) {
          const deadlineDate = new Date(p.deadline);
          deadlineDate.setHours(23, 59, 59, 999);
          const isDeadlinePassed = new Date() > deadlineDate;
          console.log("Deadline cũ:", deadlineDate, "Đã qua deadline?", isDeadlinePassed);
          if (!isDeadlinePassed) {
            document.getElementById('extend-banner').style = "display: none";
          }
        } else {
          document.getElementById('extend-banner').style = "display: none";
        }

      const fieldMap = {
        'gender': p.gender, 'birth_year': p.birth_year, 'height': p.height, 'weight': p.weight,
        'target_weight': p.target_weight, 'deadline': p.deadline, 'speed': p.speed,
        'activity': p.activity_level, 'cheat_days': p.high_cal_days, 'snacking': p.snacking,
        'allergies': p.allergies, 'focus_macro': p.focus_macro, 'reason': p.reason,
        'disease': p.disease
      };
        const form = document.getElementById("planForm");
        Object.keys(fieldMap).forEach(fieldName => {
          const value = fieldMap[fieldName];
          if (form[fieldName] && value !== undefined && value !== null) form[fieldName].value = value;
        });
        if (p.goal) {
  document.getElementById('main_goal').value = p.goal;

  document.querySelectorAll('.goal-item').forEach(item => {
    item.classList.remove('selected');

    if (item.getAttribute('onclick').includes(`'${p.goal}'`)) {
      item.classList.add('selected');
    }
  });

  
  if (p.goal === 'disease') {
    const diseaseGroup = document.getElementById('disease-group');
    const diseaseSelect = document.getElementById('disease');
    const customDisease = document.getElementById('customDisease');
    const finalDisease = document.getElementById('finalDisease');

    diseaseGroup.style.display = 'block';

    const options = Array.from(diseaseSelect.options).map(opt => opt.value);
    const diseaseValue = (p.disease || '').trim();

    
    if (options.includes(diseaseValue)) {
      diseaseSelect.value = diseaseValue;
      customDisease.style.display = 'none';
      customDisease.value = '';
      finalDisease.value = diseaseValue;
    } 
    
    else if (diseaseValue) {
      diseaseSelect.value = 'Khác';
      customDisease.style.display = 'block';
      customDisease.value = diseaseValue;
      finalDisease.value = diseaseValue;
    }
  }
}
      }
    } catch (err) {
      console.warn("Chưa có dữ liệu cũ để khôi phục:", err);
    } finally {
      hideLoader();
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    showLoader()
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'extend') {
      document.getElementById('extend-banner').classList.remove('hidden');
      
      const titleObj = document.querySelector('.setup-header h1');
      if (titleObj) titleObj.innerText = 'Bắt đầu lộ trình mới';
      
      const btnObj = document.querySelector('.btn-submit span');
      if (btnObj) btnObj.innerText = 'Lưu & Khởi tạo thực đơn';
    }
    const token = localStorage.getItem('calorie_ai_token');
    if (!token) {
      showToast("Vui lòng đăng nhập!", "info");
      setTimeout(() => { window.location.href = "signin.html"; }, 1369);
    } else {
      if (typeof loadChatHistory === 'function') loadChatHistory();
    }
  });