/* =========================================================================
 * i18n.js — Đa ngôn ngữ (Tiếng Việt / English)
 * Dùng chung cho toàn bộ trang. Tải file này TRƯỚC các script khác của trang.
 *
 * Cách dùng trong HTML:
 *   <span data-i18n="nav.diet">DIET</span>            -> đổi textContent
 *   <input data-i18n-ph="chat.placeholder">           -> đổi placeholder
 *   <h2 data-i18n-html="setup.step1.title">...</h2>   -> đổi innerHTML
 *
 * Cách dùng trong JS:
 *   t('toast.saved')                  -> trả về chuỗi theo ngôn ngữ hiện tại
 *   t('toast.saved', 'Đã lưu!')       -> kèm fallback nếu thiếu key
 * ======================================================================= */
(function () {
  const LS_KEY = "calorie_ai_lang";
  const DEFAULT_LANG = "vi";

  const DICT = {
    vi: {
      /* ----- chung ----- */
      "common.lang": "Ngôn ngữ",
      "common.save": "Lưu thay đổi",
      "common.cancel": "Hủy",
      "common.close": "Đóng",
      "common.add": "Thêm",
      "common.delete": "Xóa",
      "common.loading": "Đang tải...",
      "common.logout": "Đăng xuất",
      "common.logout_hint": "Nhấn để đăng xuất",
      "common.kcal": "kcal",
      "common.today": "Hôm nay",

      /* ----- điều hướng ----- */
      "nav.ai": "AI",
      "nav.diet": "DIET",
      "nav.plan": "PLAN",
      "nav.profile": "PROFILE",
      "nav.guide": "GUIDE",

      /* ----- landing ----- */
      "land.signin": "Đăng nhập",
      "land.signup": "Đăng ký",
      "land.badge": "Trí tuệ nhân tạo thế hệ mới",
      "land.title1": "Kiểm soát Calorie",
      "land.title2": "Dễ dàng hơn bao giờ hết.",
      "land.desc": "Chỉ cần gửi ảnh hoặc mô tả món ăn, hệ thống sẽ phân tích dinh dưỡng và đưa ra gợi ý phù hợp, đồng thời điều chỉnh kế hoạch ăn uống theo mục tiêu và thói quen thực tế của bạn.",
      "land.cta": "Bắt đầu ngay",
      "land.footer": "© 2026 Calorie AI. Phân tích dinh dưỡng thông minh.",

      /* ----- chat ----- */
      "chat.greeting": "Chào bạn! Hãy gửi tin nhắn hoặc ảnh món ăn, tôi sẽ phân tích giúp bạn.",
      "chat.placeholder": "Hỏi tôi liên quan về dinh dưỡng...",
      "chat.total_energy": "Tổng năng lượng",
      "chat.info_update": "Thông tin sẽ cập nhật sau khi phân tích.",
      "chat.protein": "Protein",
      "chat.fat": "Chất béo",
      "chat.carbs": "Carbs",
      "chat.fiber": "Chất xơ",
      "chat.sugar": "Đường",
      "chat.sodium": "Natri",
      "chat.upload_hint": "Tải ảnh món ăn",
      "chat.send": "Gửi",

      /* ----- schedule / thực đơn ----- */
      "sch.hero_title": "Lộ trình thực đơn của bạn",
      "sch.hero_desc": "AI lên lịch 7 ngày dựa trên mục tiêu, khẩu vị và cường độ vận động",
      "sch.coach_title": "HLV Dinh Dưỡng AI",
      "sch.coach_desc": "Trao đổi với AI để cập nhật thực đơn và theo dõi bữa ăn.",
      "sch.week_title": "Lộ trình thực đơn 7 ngày",
      "sch.meal": "Bữa",
      "sch.breakfast": "Sáng",
      "sch.lunch": "Trưa",
      "sch.dinner": "Tối",
      "sch.snack": "Phụ",
      "sch.eaten": "Đã ăn",
      "sch.eaten_q": "Đã ăn bữa này chưa?",
      "sch.mark_eaten": "Đánh dấu đã ăn",
      "sch.will_eat": "Tôi sẽ ăn món này",
      "sch.alt_ph": "Bạn muốn ăn món gì khác?",
      "sch.find_near": "Tìm quán gần đây",
      "sch.ask_ai": "Hỏi HLV AI",
      "sch.nutrition_struct": "Cơ cấu dinh dưỡng",

      /* ----- bảng tổng hợp hôm nay ----- */
      "today.title": "Hôm nay bạn đã nạp",
      "today.subtitle": "Tổng năng lượng & dinh dưỡng đã ăn trong ngày",
      "today.consumed": "Đã nạp",
      "today.target": "Mục tiêu",
      "today.remaining": "Còn lại",
      "today.over": "Vượt mức",
      "today.no_meal": "Bạn chưa đánh dấu bữa nào hôm nay. Tick \"Đã ăn\" ở từng bữa để theo dõi.",

      /* ----- thêm món ngoài thực đơn ----- */
      "extra.add_btn": "Thêm món ăn ngoài thực đơn",
      "extra.title": "Thêm món ăn thêm",
      "extra.desc": "Ăn vặt, trái cây, đồ uống… ngoài thực đơn? Thêm vào đây để tính vào tổng hôm nay.",
      "extra.name": "Tên món",
      "extra.name_ph": "VD: Táo, sữa chua, trà sữa...",
      "extra.kcal": "Năng lượng (kcal)",
      "extra.kcal_ph": "VD: 95",
      "extra.estimate": "Tự động tính bằng AI",
      "extra.estimating": "AI đang ước tính...",
      "extra.added": "Đã thêm vào hôm nay!",
      "extra.list_title": "Món thêm hôm nay",
      "extra.need_name": "Vui lòng nhập tên món",
      "extra.optional_macro": "Dinh dưỡng (tùy chọn)",

      /* ----- nhắc nhở ----- */
      "rem.title": "Nhắc nhở",
      "rem.subtitle": "Nhắc uống thuốc & ăn đúng giờ",
      "rem.tab_meal": "Bữa ăn",
      "rem.tab_med": "Uống thuốc",
      "rem.add": "Thêm nhắc nhở",
      "rem.label": "Nội dung nhắc",
      "rem.label_meal_ph": "VD: Ăn sáng",
      "rem.label_med_ph": "VD: Uống vitamin D",
      "rem.time": "Giờ nhắc",
      "rem.repeat": "Lặp lại hằng ngày",
      "rem.none": "Chưa có nhắc nhở nào.",
      "rem.enable_notif": "Bật thông báo trình duyệt",
      "rem.notif_blocked": "Trình duyệt đã chặn thông báo. Hãy bật lại trong cài đặt.",
      "rem.notif_on": "Đã bật thông báo!",
      "rem.saved": "Đã lưu nhắc nhở",
      "rem.deleted": "Đã xóa nhắc nhở",
      "rem.fire_meal": "🍽️ Đến giờ ăn",
      "rem.fire_med": "💊 Đến giờ uống thuốc",
      "rem.need_time": "Vui lòng chọn giờ nhắc",
      "rem.open": "Nhắc nhở",

      /* ----- setup ----- */
      "setup.body_title": "Chỉ số cơ thể",
      "setup.body_desc": "Để tính toán BMR và TDEE chính xác cho bạn.",
      "setup.gender": "Giới tính",
      "setup.male": "Nam",
      "setup.female": "Nữ",
      "setup.birth": "Năm sinh",
      "setup.height": "Chiều cao (cm)",
      "setup.weight": "Cân nặng (kg)",
      "setup.goal_title": "Mục tiêu của bạn",
      "setup.goal_desc": "Bạn có thể chọn nhiều mục tiêu cùng lúc.",
      "setup.goal_lose": "Giảm cân",
      "setup.goal_maintain": "Giữ cân",
      "setup.goal_gain": "Tăng cân",
      "setup.goal_muscle": "Tăng cơ",
      "setup.goal_disease": "Cải thiện / hỗ trợ điều trị bệnh",
      "setup.disease_label": "Bệnh / tình trạng sức khỏe",
      "setup.disease_pick": "-- Chọn bệnh --",
      "setup.disease_other_ph": "Nhập tên bệnh...",
      "setup.target_weight": "Cân nặng mục tiêu",
      "setup.deadline": "Deadline",
      "setup.speed": "Tốc độ mong muốn",
      "setup.speed_safe": "An toàn (0.5kg/tuần)",
      "setup.speed_normal": "Vừa phải (0.7kg/tuần)",
      "setup.speed_fast": "Nhanh (1kg/tuần)",
      "setup.habit_title": "Thói quen & Linh hoạt",
      "setup.habit_desc": "Tối ưu hóa calo theo lịch trình của bạn.",
      "setup.activity": "Tần suất vận động",
      "setup.act_1": "Ít vận động (Văn phòng)",
      "setup.act_2": "Nhẹ (1-2 buổi tập/tuần)",
      "setup.act_3": "Vừa (3-5 buổi tập/tuần)",
      "setup.act_4": "Nặng (6-7 buổi tập/tuần)",
      "setup.cheat": "Ngày ăn nhiều (Cheat day)?",
      "setup.cheat_ph": "Ví dụ: Thứ 7 và Chủ Nhật",
      "setup.snack_q": "Bạn có hay ăn vặt không?",
      "setup.snack_no": "Không bao giờ",
      "setup.snack_sometimes": "Thỉnh thoảng",
      "setup.snack_often": "Thường xuyên",
      "setup.deep_title": "Cá nhân hóa sâu",
      "setup.deep_desc": "Bước cuối cùng để hoàn tất lộ trình.",
      "setup.allergies": "Dị ứng / Thực phẩm không ăn được",
      "setup.allergies_ph": "Ví dụ: Không ăn hành, dị ứng hải sản...",
      "setup.focus_q": "Bạn muốn tập trung vào chất nào?",
      "setup.focus_balanced": "Cân bằng",
      "setup.focus_protein": "Nhiều Đạm (Protein)",
      "setup.focus_lowcarb": "Ít Tinh bột (Low carb)",
      "setup.reason": "Lý do bắt đầu?",
      "setup.reason_ph": "Cải thiện sức khỏe...",
      "setup.prev": "Quay lại",
      "setup.next": "Tiếp tục",
      "setup.finish": "Hoàn tất lộ trình",
      "setup.extend_banner": "Chặng đường cũ đã hoàn thành. Hãy cập nhật cân nặng mới và đặt deadline mới nhé!",
      "setup.pick_goal": "Vui lòng chọn ít nhất một mục tiêu.",

      /* ----- diet dashboard ----- */
      "diet.today_route": "Lộ trình hôm nay",
      "diet.daily_target": "Mục tiêu nạp mỗi ngày",
      "diet.weight_now": "Cân nặng hiện tại",
      "diet.target_to": "Mục tiêu hướng đến",
      "diet.deadline": "Thời hạn (Deadline)",
      "diet.nutri_title": "Phân tích dinh dưỡng",
      "diet.nutri_sub": "Tỉ lệ macro & tiến độ cân nặng theo lộ trình",
      "diet.macro_ratio": "Tỉ lệ Macro đề xuất",
      "diet.weight_progress": "Tiến độ cân nặng",
      "diet.cal_per_day": "Calo theo từng ngày trong tuần",

      /* ----- đăng nhập / đăng ký ----- */
      "auth.signin_title": "Chào mừng trở lại",
      "auth.signin_sub": "Tiếp tục theo dõi sức khỏe của bạn",
      "auth.username": "Tên đăng nhập",
      "auth.username_ph_signin": "Nhập username",
      "auth.password": "Mật khẩu",
      "auth.signin_btn": "Đăng nhập",
      "auth.no_account": "Chưa có tài khoản?",
      "auth.signup_now": "Đăng ký ngay",
      "auth.signup_title": "Tạo tài khoản mới",
      "auth.signup_sub": "Bắt đầu hành trình dinh dưỡng của bạn",
      "auth.username_ph_signup": "Ví dụ: nva123",
      "auth.birth": "Năm sinh",
      "auth.weight": "Cân nặng (kg)",
      "auth.height": "Chiều cao (cm)",
      "auth.signup_btn": "Đăng ký ngay",
      "auth.have_account": "Đã có tài khoản?",
      "auth.signin_link": "Đăng nhập",
    },

    en: {
      /* ----- common ----- */
      "common.lang": "Language",
      "common.save": "Save changes",
      "common.cancel": "Cancel",
      "common.close": "Close",
      "common.add": "Add",
      "common.delete": "Delete",
      "common.loading": "Loading...",
      "common.logout": "Log out",
      "common.logout_hint": "Click to log out",
      "common.kcal": "kcal",
      "common.today": "Today",

      "nav.ai": "AI",
      "nav.diet": "DIET",
      "nav.plan": "PLAN",
      "nav.profile": "PROFILE",
      "nav.guide": "GUIDE",

      "land.signin": "Sign in",
      "land.signup": "Sign up",
      "land.badge": "Next-generation artificial intelligence",
      "land.title1": "Calorie tracking",
      "land.title2": "Easier than ever before.",
      "land.desc": "Just send a photo or describe your meal — the system analyzes its nutrition, gives tailored suggestions, and adapts your eating plan to your goals and real habits.",
      "land.cta": "Get started",
      "land.footer": "© 2026 Calorie AI. Smart nutrition analysis.",

      "chat.greeting": "Hi there! Send a message or a photo of your food and I'll analyze it for you.",
      "chat.placeholder": "Ask me anything about nutrition...",
      "chat.total_energy": "Total energy",
      "chat.info_update": "Details will appear after analysis.",
      "chat.protein": "Protein",
      "chat.fat": "Fat",
      "chat.carbs": "Carbs",
      "chat.fiber": "Fiber",
      "chat.sugar": "Sugar",
      "chat.sodium": "Sodium",
      "chat.upload_hint": "Upload a food photo",
      "chat.send": "Send",

      "sch.hero_title": "Your meal plan",
      "sch.hero_desc": "AI builds a 7-day schedule based on your goals, taste and activity level",
      "sch.coach_title": "AI Nutrition Coach",
      "sch.coach_desc": "Chat with the AI to update your menu and track your meals.",
      "sch.week_title": "7-day meal plan",
      "sch.meal": "Meal",
      "sch.breakfast": "Breakfast",
      "sch.lunch": "Lunch",
      "sch.dinner": "Dinner",
      "sch.snack": "Snack",
      "sch.eaten": "Eaten",
      "sch.eaten_q": "Have you eaten this meal?",
      "sch.mark_eaten": "Mark as eaten",
      "sch.will_eat": "I'll eat this dish",
      "sch.alt_ph": "What would you like to eat instead?",
      "sch.find_near": "Find nearby places",
      "sch.ask_ai": "Ask the AI Coach",
      "sch.nutrition_struct": "Nutrition breakdown",

      "today.title": "What you've eaten today",
      "today.subtitle": "Total energy & nutrition consumed today",
      "today.consumed": "Consumed",
      "today.target": "Target",
      "today.remaining": "Remaining",
      "today.over": "Over",
      "today.no_meal": "You haven't marked any meal today. Tick \"Eaten\" on each meal to track it.",

      "extra.add_btn": "Add food outside the plan",
      "extra.title": "Add an extra food",
      "extra.desc": "Snacks, fruit, drinks… outside the plan? Add them here to count toward today's total.",
      "extra.name": "Food name",
      "extra.name_ph": "e.g. Apple, yogurt, milk tea...",
      "extra.kcal": "Energy (kcal)",
      "extra.kcal_ph": "e.g. 95",
      "extra.estimate": "Auto-estimate with AI",
      "extra.estimating": "AI is estimating...",
      "extra.added": "Added to today!",
      "extra.list_title": "Today's extra foods",
      "extra.need_name": "Please enter a food name",
      "extra.optional_macro": "Nutrition (optional)",

      "rem.title": "Reminders",
      "rem.subtitle": "Medication & meal-time reminders",
      "rem.tab_meal": "Meals",
      "rem.tab_med": "Medication",
      "rem.add": "Add reminder",
      "rem.label": "Reminder text",
      "rem.label_meal_ph": "e.g. Breakfast",
      "rem.label_med_ph": "e.g. Take vitamin D",
      "rem.time": "Time",
      "rem.repeat": "Repeat daily",
      "rem.none": "No reminders yet.",
      "rem.enable_notif": "Enable browser notifications",
      "rem.notif_blocked": "Notifications are blocked. Please re-enable them in settings.",
      "rem.notif_on": "Notifications enabled!",
      "rem.saved": "Reminder saved",
      "rem.deleted": "Reminder deleted",
      "rem.fire_meal": "🍽️ Time to eat",
      "rem.fire_med": "💊 Time for your medication",
      "rem.need_time": "Please choose a time",
      "rem.open": "Reminders",

      "setup.body_title": "Body metrics",
      "setup.body_desc": "To calculate your BMR and TDEE accurately.",
      "setup.gender": "Gender",
      "setup.male": "Male",
      "setup.female": "Female",
      "setup.birth": "Year of birth",
      "setup.height": "Height (cm)",
      "setup.weight": "Weight (kg)",
      "setup.goal_title": "Your goals",
      "setup.goal_desc": "You can select more than one goal.",
      "setup.goal_lose": "Lose weight",
      "setup.goal_maintain": "Maintain weight",
      "setup.goal_gain": "Gain weight",
      "setup.goal_muscle": "Build muscle",
      "setup.goal_disease": "Improve / support a health condition",
      "setup.disease_label": "Disease / health condition",
      "setup.disease_pick": "-- Select a condition --",
      "setup.disease_other_ph": "Enter condition name...",
      "setup.target_weight": "Target weight",
      "setup.deadline": "Deadline",
      "setup.speed": "Desired pace",
      "setup.speed_safe": "Safe (0.5kg/week)",
      "setup.speed_normal": "Moderate (0.7kg/week)",
      "setup.speed_fast": "Fast (1kg/week)",
      "setup.habit_title": "Habits & flexibility",
      "setup.habit_desc": "Optimize calories around your schedule.",
      "setup.activity": "Activity level",
      "setup.act_1": "Sedentary (office)",
      "setup.act_2": "Light (1-2 workouts/week)",
      "setup.act_3": "Moderate (3-5 workouts/week)",
      "setup.act_4": "Heavy (6-7 workouts/week)",
      "setup.cheat": "High-calorie days (cheat days)?",
      "setup.cheat_ph": "e.g. Saturday and Sunday",
      "setup.snack_q": "Do you snack often?",
      "setup.snack_no": "Never",
      "setup.snack_sometimes": "Sometimes",
      "setup.snack_often": "Often",
      "setup.deep_title": "Deep personalization",
      "setup.deep_desc": "The final step to complete your plan.",
      "setup.allergies": "Allergies / foods you avoid",
      "setup.allergies_ph": "e.g. No onion, seafood allergy...",
      "setup.focus_q": "Which macro do you want to focus on?",
      "setup.focus_balanced": "Balanced",
      "setup.focus_protein": "High protein",
      "setup.focus_lowcarb": "Low carb",
      "setup.reason": "Why are you starting?",
      "setup.reason_ph": "Improve my health...",
      "setup.prev": "Back",
      "setup.next": "Continue",
      "setup.finish": "Finish setup",
      "setup.extend_banner": "Your previous journey is complete. Update your new weight and set a new deadline!",
      "setup.pick_goal": "Please select at least one goal.",

      "diet.today_route": "Today's plan",
      "diet.daily_target": "Daily intake target",
      "diet.weight_now": "Current weight",
      "diet.target_to": "Target weight",
      "diet.deadline": "Deadline",
      "diet.nutri_title": "Nutrition analysis",
      "diet.nutri_sub": "Macro ratio & weight progress along your plan",
      "diet.macro_ratio": "Recommended macro ratio",
      "diet.weight_progress": "Weight progress",
      "diet.cal_per_day": "Calories per day of the week",

      "auth.signin_title": "Welcome back",
      "auth.signin_sub": "Keep tracking your health",
      "auth.username": "Username",
      "auth.username_ph_signin": "Enter your username",
      "auth.password": "Password",
      "auth.signin_btn": "Sign in",
      "auth.no_account": "Don't have an account?",
      "auth.signup_now": "Sign up now",
      "auth.signup_title": "Create a new account",
      "auth.signup_sub": "Start your nutrition journey",
      "auth.username_ph_signup": "e.g. johndoe",
      "auth.birth": "Year of birth",
      "auth.weight": "Weight (kg)",
      "auth.height": "Height (cm)",
      "auth.signup_btn": "Sign up",
      "auth.have_account": "Already have an account?",
      "auth.signin_link": "Sign in",
    },
  };

  function getLang() {
    const l = localStorage.getItem(LS_KEY);
    return l === "en" || l === "vi" ? l : DEFAULT_LANG;
  }

  function t(key, fallback) {
    const lang = getLang();
    const table = DICT[lang] || DICT[DEFAULT_LANG];
    if (table && key in table) return table[key];
    if (DICT[DEFAULT_LANG] && key in DICT[DEFAULT_LANG]) return DICT[DEFAULT_LANG][key];
    return fallback != null ? fallback : key;
  }

  function applyTranslations(root) {
    const scope = root || document;

    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const val = t(key, null);
      if (val != null) el.textContent = val;
    });

    scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      const val = t(key, null);
      if (val != null) el.innerHTML = val;
    });

    scope.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      const key = el.getAttribute("data-i18n-ph");
      const val = t(key, null);
      if (val != null) el.setAttribute("placeholder", val);
    });

    scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      const val = t(key, null);
      if (val != null) el.setAttribute("title", val);
    });

    document.documentElement.setAttribute("lang", getLang());
  }

  function setLang(lang) {
    if (lang !== "vi" && lang !== "en") lang = DEFAULT_LANG;
    localStorage.setItem(LS_KEY, lang);
    applyTranslations();
    syncSwitchUI();
    // Cho các trang muốn render lại nội dung động (toast, biểu đồ...) khi đổi ngôn ngữ
    document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
  }

  function syncSwitchUI() {
    const cur = getLang();
    document.querySelectorAll(".lang-switch .lang-opt").forEach((b) => {
      b.classList.toggle("active", b.dataset.lang === cur);
    });
  }

  function buildSwitch() {
    const wrap = document.createElement("div");
    wrap.className = "lang-switch";
    wrap.setAttribute("title", t("common.lang"));
    wrap.innerHTML = `
      <button type="button" class="lang-opt" data-lang="vi">VI</button>
      <button type="button" class="lang-opt" data-lang="en">EN</button>
    `;
    wrap.querySelectorAll(".lang-opt").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        setLang(b.dataset.lang);
      });
    });
    return wrap;
  }

  function injectStyles() {
    if (document.getElementById("i18n-style")) return;
    const s = document.createElement("style");
    s.id = "i18n-style";
    s.textContent = `
      .lang-switch{display:inline-flex;align-items:center;gap:2px;background:var(--sage-50,#eaf3ee);
        border:1px solid var(--border-soft,rgba(0,0,0,.07));border-radius:999px;padding:3px;}
      .lang-switch .lang-opt{border:none;background:transparent;cursor:pointer;font-family:inherit;
        font-size:12px;font-weight:700;letter-spacing:.5px;color:var(--text-sub,#636e72);
        padding:5px 10px;border-radius:999px;transition:all .2s;line-height:1;}
      .lang-switch .lang-opt:hover{color:var(--primary-deep,#3d7353);}
      .lang-switch .lang-opt.active{background:var(--primary,#58a677);color:#fff;
        box-shadow:0 2px 6px rgba(88,166,119,.4);}
    `;
    document.head.appendChild(s);
  }

  function injectSwitch() {
    if (document.querySelector(".lang-switch")) return;
    // Ưu tiên các vùng chứa trên header của từng trang
    const host =
      document.querySelector(".header-tools") ||
      document.querySelector(".navbar") ||
      document.querySelector(".nav-auth") ||
      document.querySelector(".auth-header") ||
      document.querySelector("header .header-tools") ||
      document.querySelector("header");
    if (!host) return;
    const sw = buildSwitch();
    host.insertBefore(sw, host.firstChild);
    syncSwitchUI();
  }

  // Expose
  window.t = t;
  window.i18n = { t, setLang, getLang, applyTranslations, DICT };

  function boot() {
    injectStyles();
    injectSwitch();
    applyTranslations();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
