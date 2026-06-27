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

      /* ----- diet: thẻ bệnh lý + nhãn động (bổ sung) ----- */
      "diet.personalized": "Cá nhân hoá",
      "diet.kcal_per_day": "kcal / ngày",
      "diet.disease_eyebrow": "Bệnh lý cần lưu ý",
      "diet.disease_loading": "Đang tải thông tin sức khoẻ...",
      "diet.disease_loading_desc": "Hệ thống sẽ cá nhân hoá thực đơn dựa trên tình trạng sức khoẻ của bạn.",
      "diet.disease_none_title": "Không có bệnh nền",
      "diet.disease_none_desc": "Bạn chưa khai báo bệnh lý nào. Thực đơn sẽ tối ưu cho mục tiêu cân nặng & năng lượng.",
      "diet.disease_one_title": "Lưu ý chế độ ăn cho tình trạng sức khoẻ",
      "diet.disease_many_title": "Bạn đang có {n} tình trạng cần lưu ý",
      "diet.disease_warn_desc": "Vui lòng chú ý lựa chọn thực phẩm phù hợp. Hệ thống sẽ ưu tiên cảnh báo món ăn không tốt cho các bệnh lý dưới đây.",

      /* nhãn biểu đồ trong Diet */
      "chart.protein": "Protein",
      "chart.carbs": "Carbs",
      "chart.fats": "Chất béo",
      "chart.weight_kg": "Cân nặng (kg)",
      "chart.target": "Mục tiêu",
      "chart.start": "Bắt đầu",
      "chart.current": "Hiện tại",
      "chart.week_n": "Tuần {n}",
      "chart.cal_intake_est": "Calo nạp (ước tính)",
      "chart.bmr_basal": "BMR (cơ bản)",
      "chart.activity": "Vận động",
      "chart.bmr": "BMR",
      "chart.tdee": "TDEE",
      "chart.mon": "T2", "chart.tue": "T3", "chart.wed": "T4", "chart.thu": "T5",
      "chart.fri": "T6", "chart.sat": "T7", "chart.sun": "CN",

      /* tên các loại bệnh (mục chọn bệnh ở profile) */
      "disease.gout": "Gout",
      "disease.diabetes": "Tiểu đường",
      "disease.hypertension": "Huyết áp cao",
      "disease.high_cholesterol": "Mỡ máu cao",
      "disease.fatty_liver": "Gan nhiễm mỡ",
      "disease.stomach": "Bệnh dạ dày",
      "disease.kidney": "Bệnh thận",
      "disease.other": "Khác",

      /* nhắc nhở: chuông báo nổi giữa màn hình */
      "rem.alarm_now": "BÂY GIỜ",
      "rem.alarm_dismiss": "Đã hiểu",
      "rem.alarm_default_med": "Đã đến giờ uống thuốc của bạn.",
      "rem.alarm_default_meal": "Đã đến giờ ăn của bạn.",

      /* thêm món ngoài thực đơn: tải ảnh */
      "extra.upload_photo": "Tải ảnh món ăn",
      "extra.analyzing_photo": "AI đang phân tích ảnh...",
      "extra.photo_done": "Đã phân tích ảnh! Kiểm tra lại số liệu nhé.",
      "extra.photo_fail": "Không phân tích được ảnh",
      "extra.not_food": "Ảnh không giống món ăn. Hãy thử ảnh khác.",
      "extra.photo_hint": "hoặc chụp/tải ảnh để AI tự nhận diện",

      /* modal bữa ăn: lựa chọn hành động */
      "sch.opt_eat": "Tôi sẽ ăn món này",
      "sch.opt_change": "Đổi sang món khác",
      "sch.opt_skip": "Tôi sẽ không ăn bữa này",
      "sch.skipped_badge": "Đã bỏ bữa",
      "sch.skip_saved": "Đã đánh dấu bỏ bữa này",
      "sch.skip_undo": "Đã bỏ đánh dấu bữa này",

      /* toast dùng chung (schedule / diet) */
      "toast.logging_out": "Đang đăng xuất...",
      "toast.diet_load_fail": "Không thể tải dữ liệu lộ trình",
      "toast.menu_updated": "Đã cập nhật thực đơn mới từ AI!",
      "toast.no_change": "Bạn chưa thay đổi món nào",
      "toast.recalc": "Đang tính lại dinh dưỡng món bạn đổi...",
      "toast.reload_plan": "Đang tải lại lộ trình mới...",
      "toast.update_ok": "Đã cập nhật & tính lại dinh dưỡng!",
      "toast.save_net_err": "Lỗi kết nối khi lưu",
      "toast.coach_net_err": "Lỗi kết nối HLV AI",

      /* ----- guide header ----- */
      "guide.back_dashboard": "Về Dashboard",
      "guide.login_to_continue": "Đăng nhập để tiếp tục",

      /* ----- guide TOC & section titles ----- */
      "guide.toc_title": "Mục lục",
      "guide.toc_intro": "Giới thiệu",
      "guide.toc_start": "Bắt đầu nhanh",
      "guide.toc_setup": "Thiết lập hồ sơ",
      "guide.toc_dashboard": "Dashboard Diet",
      "guide.toc_chat": "Trò chuyện AI",
      "guide.toc_plan": "Lịch 7 ngày",
      "guide.toc_tips": "Mẹo & Lưu ý",
      "guide.toc_faq": "Câu hỏi thường gặp",

      /* ----- guide: shared labels ----- */
      "guide.label_tip": "Mẹo:",
      "guide.label_note": "Lưu ý:",

      /* ----- guide: hero ----- */
      "guide.intro_title": "Calorie AI là gì?",
      "guide.intro_desc": "Calorie AI là trợ lý dinh dưỡng AI hỗ trợ người dùng, đặc biệt là người có bệnh nền, theo dõi và kiểm soát chế độ ăn uống hằng ngày nhằm góp phần hỗ trợ quá trình cải thiện và điều trị bệnh thông qua dinh dưỡng.<br><br>Người dùng chỉ cần nhập thông tin cơ thể và mục tiêu, hệ thống sẽ tự động phân tích, tính toán dinh dưỡng và gợi ý thực đơn phù hợp theo từng tình trạng sức khỏe.",
      "guide.chip_read5": "Đọc trong 5 phút",
      "guide.chip_beginner": "Phù hợp người mới",
      "guide.chip_updated": "Cập nhật liên tục",
      "guide.feat_auto_t": "Tính toán tự động",
      "guide.feat_auto_d": "BMR, TDEE, mục tiêu calo & macro theo công thức chuẩn.",
      "guide.feat_coach_t": "HLV AI 24/7",
      "guide.feat_coach_d": "Hỏi đáp về món ăn, thay thế nguyên liệu, ghi nhận bữa ăn.",
      "guide.feat_plan_t": "Lịch 7 ngày",
      "guide.feat_plan_d": "Thực đơn xoay vòng, có thể yêu cầu AI sinh lại theo sở thích.",
      "guide.feat_progress_t": "Tiến độ trực quan",
      "guide.feat_progress_d": "Biểu đồ cân nặng, calo và macro theo thời gian thực.",

      /* ----- guide: start ----- */
      "guide.start_title": "Bắt đầu trong 4 bước",
      "guide.start_lead": "Quy trình từ lúc đăng ký đến khi nhận thực đơn cá nhân hoá.",
      "guide.start_s1_t": "1. Đăng ký tài khoản",
      "guide.start_s1_d": "Tạo tài khoản để bắt đầu lưu dữ liệu dinh dưỡng cá nhân.",
      "guide.start_s2_t": "2. Khai báo hồ sơ",
      "guide.start_s2_d": "Nhập thông tin cơ thể, mức vận động, mục tiêu (giảm cân / tăng cơ / duy trì) hoặc tình trạng sức khỏe.",
      "guide.start_s3_t": "3. Nhận đề xuất",
      "guide.start_s3_d": "Hệ thống tự động tính BMR, TDEE và xây dựng chế độ ăn phù hợp với thể trạng.",
      "guide.start_s4_t": "4. Theo dõi mỗi ngày",
      "guide.start_s4_d": "Ghi nhận bữa ăn hằng ngày qua chat, theo dõi lượng calo và macro đã nạp, đồng thời kiểm soát tiến độ so với mục tiêu. Thực đơn được tự động điều chỉnh linh hoạt dựa trên dữ liệu ăn uống thực tế của người dùng.",

      /* ----- guide: setup ----- */
      "guide.setup_title": "Thiết lập hồ sơ (Setup)",
      "guide.setup_lead": "Tại đây trang chia làm 4 bước — biểu tượng tiến độ ở trên cùng cho biết bạn đang ở đâu.",
      "guide.setup_fields_h": "Các trường thông tin",
      "guide.setup_li1": "<strong>Thông tin cơ bản:</strong> tên, tuổi, giới tính.",
      "guide.setup_li2": "<strong>Chỉ số cơ thể:</strong> chiều cao (cm), cân nặng hiện tại (kg).",
      "guide.setup_li3": "<strong>Mức vận động:</strong> ít vận động → vận động nặng (ảnh hưởng TDEE).",
      "guide.setup_li4": "<strong>Mục tiêu:</strong> Giảm cân · Duy trì · Tăng cơ — chọn 1 trong các thẻ Goal.",
      "guide.setup_tip_body": "Cập nhật cân nặng mỗi tuần để biểu đồ tiến độ phản ánh đúng thực tế.",

      /* ----- guide: dashboard ----- */
      "guide.dash_title": "Dashboard Diet",
      "guide.dash_lead": "Tại đây trang tổng hợp toàn bộ chỉ số quan trọng dưới dạng biểu đồ trực quan.",
      "guide.dash_macro_t": "Macro Donut",
      "guide.dash_macro_d": "Tỉ lệ Protein / Carbs / Fat đề xuất.",
      "guide.dash_weight_t": "Tiến độ cân nặng",
      "guide.dash_weight_d": "Đường biểu diễn cân theo tuần.",
      "guide.dash_cal_t": "Calo theo ngày",
      "guide.dash_cal_d": "Cột calo nạp 7 ngày gần nhất.",
      "guide.dash_bmr_t": "BMR vs TDEE",
      "guide.dash_bmr_d": "So sánh năng lượng cơ bản và tiêu hao.",
      "guide.dash_warn_body": "Nếu các chip BMR/TDEE hiển thị \"--\", bạn cần hoàn tất Setup trước.",

      /* ----- guide: chat ----- */
      "guide.chat_title": "Trò chuyện với HLV AI",
      "guide.chat_lead": "Đây là nơi bạn ghi nhận bữa ăn và nhận tư vấn theo ngữ cảnh.",
      "guide.chat_ask_h": "Bạn có thể hỏi gì?",
      "guide.chat_q1": "\"Tôi vừa ăn 1 bát phở bò, ghi nhận giúp tôi.\"",
      "guide.chat_q2": "\"Bữa tối hôm nay nên ăn gì để đủ Protein?\"",
      "guide.chat_q3": "\"Có thể thay thịt bò bằng món chay nào?\"",
      "guide.chat_q4": "\"Hôm nay tôi còn bao nhiêu calo?\"",
      "guide.chat_note_body": "Khi AI nhận diện món ăn, sẽ hiện hộp xác nhận trước khi lưu vào nhật ký để đảm bảo dữ liệu chính xác.",

      /* ----- guide: plan ----- */
      "guide.plan_title": "Lịch ăn 7 ngày",
      "guide.plan_lead": "Đây là nơi hiển thị thực đơn dạng bảng theo ngày × bữa.",
      "guide.plan_li1": "Mỗi ô là một bữa được AI gợi ý phù hợp với mục tiêu calo & macro.",
      "guide.plan_li2": "Bấm <strong>\"Sinh lại lịch\"</strong> để AI tạo phương án mới.",
      "guide.plan_li3": "Kéo thanh bên dưới để xem các phản hồi/giải thích từ AI về kế hoạch.",

      /* ----- guide: tips ----- */
      "guide.tips_title": "Mẹo dùng hiệu quả",
      "guide.tips_dash_t": "Vào Dashboard",
      "guide.tips_dash_d": "Kiểm tra chỉ số mỗi sáng để có kế hoạch ăn phù hợp trong ngày.",
      "guide.tips_dash_go": "Mở Diet",
      "guide.tips_chat_t": "Ghi nhận bữa ăn",
      "guide.tips_chat_d": "Nhập càng sớm càng tốt sau khi ăn để dữ liệu được chính xác.",
      "guide.tips_chat_go": "Mở Chat",
      "guide.tips_plan_t": "Lên kế hoạch tuần",
      "guide.tips_plan_d": "Sinh lịch vào đầu tuần để chuẩn bị nguyên liệu trước.",
      "guide.tips_plan_go": "Mở Plan",
      "guide.tips_setup_t": "Cập nhật hồ sơ",
      "guide.tips_setup_d": "Thay đổi cân nặng/mục tiêu định kỳ để AI tính lại chỉ số.",
      "guide.tips_setup_go": "Mở Setup",

      /* ----- guide: faq ----- */
      "guide.faq_title": "Câu hỏi thường gặp",
      "guide.faq_q1": "Dữ liệu của tôi có được bảo mật?",
      "guide.faq_a1": "Toàn bộ dữ liệu cá nhân được lưu trên tài khoản riêng và chỉ bạn truy cập được sau khi đăng nhập.",
      "guide.faq_q2": "Tại sao calo tôi nhập không khớp với AI tính?",
      "guide.faq_a2": "AI ước lượng theo khẩu phần trung bình. Nếu món của bạn lớn/nhỏ hơn, hãy nói rõ trong chat (ví dụ: \"1 bát phở lớn 500ml\").",
      "guide.faq_q3": "Tôi có thể đổi mục tiêu sau khi setup?",
      "guide.faq_a3": "Có. Vào trang Setup → chọn mục tiêu mới → AI sẽ tính lại calo và macro mục tiêu.",
      "guide.faq_q4": "Lịch 7 ngày có thay đổi mỗi tuần không?",
      "guide.faq_a4": "Bạn có thể bấm \"Sinh lại\" bất kỳ lúc nào để có thực đơn mới phù hợp khẩu vị/mùa.",

      /* ----- plan completion overlay ----- */
      "plan.congrat_title": "Chúc mừng bạn!",
      "plan.congrat_body": "Bạn đã hoàn thành xuất sắc chặng đường dinh dưỡng. Hãy cập nhật lại chỉ số mới để AI thiết kế lộ trình tiếp theo nhé!",
      "plan.congrat_btn": "Tiếp tục chặng đường mới",
      "toast.login_required": "Vui lòng đăng nhập!",
      "toast.estimate_fail": "Không ước tính được",
      "toast.estimate_net_err": "Lỗi kết nối khi ước tính",
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

      /* ----- diet: condition card + dynamic labels ----- */
      "diet.personalized": "Personalized",
      "diet.kcal_per_day": "kcal / day",
      "diet.disease_eyebrow": "Conditions to watch",
      "diet.disease_loading": "Loading your health info...",
      "diet.disease_loading_desc": "We'll personalize your menu based on your health conditions.",
      "diet.disease_none_title": "No underlying conditions",
      "diet.disease_none_desc": "You haven't reported any condition. Your menu is optimized for weight & energy goals.",
      "diet.disease_one_title": "Dietary notes for your condition",
      "diet.disease_many_title": "You have {n} conditions to watch",
      "diet.disease_warn_desc": "Please choose suitable foods. The system will flag foods that aren't good for the conditions below.",

      /* chart labels in Diet */
      "chart.protein": "Protein",
      "chart.carbs": "Carbs",
      "chart.fats": "Fats",
      "chart.weight_kg": "Weight (kg)",
      "chart.target": "Target",
      "chart.start": "Start",
      "chart.current": "Now",
      "chart.week_n": "Week {n}",
      "chart.cal_intake_est": "Calories (est.)",
      "chart.bmr_basal": "BMR (basal)",
      "chart.activity": "Activity",
      "chart.bmr": "BMR",
      "chart.tdee": "TDEE",
      "chart.mon": "Mon", "chart.tue": "Tue", "chart.wed": "Wed", "chart.thu": "Thu",
      "chart.fri": "Fri", "chart.sat": "Sat", "chart.sun": "Sun",

      /* disease names (profile condition picker) */
      "disease.gout": "Gout",
      "disease.diabetes": "Diabetes",
      "disease.hypertension": "High blood pressure",
      "disease.high_cholesterol": "High cholesterol",
      "disease.fatty_liver": "Fatty liver",
      "disease.stomach": "Stomach problems",
      "disease.kidney": "Kidney disease",
      "disease.other": "Other",

      /* reminders: center-screen alarm */
      "rem.alarm_now": "NOW",
      "rem.alarm_dismiss": "Got it",
      "rem.alarm_default_med": "It's time to take your medication.",
      "rem.alarm_default_meal": "It's time to eat.",

      /* extra food: photo upload */
      "extra.upload_photo": "Upload a food photo",
      "extra.analyzing_photo": "AI is analyzing the photo...",
      "extra.photo_done": "Photo analyzed! Please double-check the numbers.",
      "extra.photo_fail": "Couldn't analyze the photo",
      "extra.not_food": "That photo doesn't look like food. Try another one.",
      "extra.photo_hint": "or snap/upload a photo for AI to detect",

      /* meal modal: action choices */
      "sch.opt_eat": "I'll eat this dish",
      "sch.opt_change": "Change to another dish",
      "sch.opt_skip": "I'll skip this meal",
      "sch.skipped_badge": "Skipped",
      "sch.skip_saved": "Marked this meal as skipped",
      "sch.skip_undo": "Unmarked this meal",

      /* shared toasts (schedule / diet) */
      "toast.logging_out": "Logging out...",
      "toast.diet_load_fail": "Couldn't load your plan data",
      "toast.menu_updated": "Menu updated from AI!",
      "toast.no_change": "You haven't changed any dish",
      "toast.recalc": "Recalculating nutrition for your new dish...",
      "toast.reload_plan": "Reloading your new plan...",
      "toast.update_ok": "Updated & recalculated nutrition!",
      "toast.save_net_err": "Network error while saving",
      "toast.coach_net_err": "AI Coach connection error",

      /* ----- guide header ----- */
      "guide.back_dashboard": "Back to Dashboard",
      "guide.login_to_continue": "Sign in to continue",

      /* ----- guide TOC & section titles ----- */
      "guide.toc_title": "Contents",
      "guide.toc_intro": "Introduction",
      "guide.toc_start": "Quick start",
      "guide.toc_setup": "Set up profile",
      "guide.toc_dashboard": "Diet Dashboard",
      "guide.toc_chat": "AI Chat",
      "guide.toc_plan": "7-day plan",
      "guide.toc_tips": "Tips & Notes",
      "guide.toc_faq": "FAQ",

      /* ----- guide: shared labels ----- */
      "guide.label_tip": "Tip:",
      "guide.label_note": "Note:",

      /* ----- guide: hero ----- */
      "guide.intro_title": "What is Calorie AI?",
      "guide.intro_desc": "Calorie AI is an AI nutrition assistant that helps users — especially those with underlying conditions — track and manage their daily diet to support recovery and treatment through nutrition.<br><br>Just enter your body metrics and goals, and the system automatically analyzes, calculates nutrition and suggests menus tailored to each health condition.",
      "guide.chip_read5": "5-minute read",
      "guide.chip_beginner": "Beginner friendly",
      "guide.chip_updated": "Continuously updated",
      "guide.feat_auto_t": "Automatic calculation",
      "guide.feat_auto_d": "BMR, TDEE, calorie & macro targets using standard formulas.",
      "guide.feat_coach_t": "AI Coach 24/7",
      "guide.feat_coach_d": "Ask about dishes, swap ingredients, and log meals.",
      "guide.feat_plan_t": "7-day plan",
      "guide.feat_plan_d": "A rotating menu; ask AI to regenerate it to your taste.",
      "guide.feat_progress_t": "Visual progress",
      "guide.feat_progress_d": "Real-time charts for weight, calories and macros.",

      /* ----- guide: start ----- */
      "guide.start_title": "Get started in 4 steps",
      "guide.start_lead": "The journey from sign-up to receiving your personalized menu.",
      "guide.start_s1_t": "1. Create an account",
      "guide.start_s1_d": "Create an account to start saving your personal nutrition data.",
      "guide.start_s2_t": "2. Fill in your profile",
      "guide.start_s2_d": "Enter your body metrics, activity level, goals (lose weight / build muscle / maintain) or health conditions.",
      "guide.start_s3_t": "3. Get recommendations",
      "guide.start_s3_d": "The system automatically computes BMR, TDEE and builds a diet suited to your body.",
      "guide.start_s4_t": "4. Track every day",
      "guide.start_s4_d": "Log daily meals via chat, track the calories and macros you've consumed, and monitor progress toward your goal. The menu adapts flexibly based on your actual eating data.",

      /* ----- guide: setup ----- */
      "guide.setup_title": "Set up your profile (Setup)",
      "guide.setup_lead": "This setup guide has 4 steps — the progress icons at the top show where you are.",
      "guide.setup_fields_h": "Information fields",
      "guide.setup_li1": "<strong>Basic info:</strong> name, age, gender.",
      "guide.setup_li2": "<strong>Body metrics:</strong> height (cm), current weight (kg).",
      "guide.setup_li3": "<strong>Activity level:</strong> sedentary → very active (affects TDEE).",
      "guide.setup_li4": "<strong>Goal:</strong> Lose weight · Maintain · Build muscle — pick one of the Goal cards.",
      "guide.setup_tip_body": "Update your weight weekly so the progress chart reflects reality.",

      /* ----- guide: dashboard ----- */
      "guide.dash_title": "Diet Dashboard",
      "guide.dash_lead": "This dashboard brings together all key metrics through visual charts.",
      "guide.dash_macro_t": "Macro Donut",
      "guide.dash_macro_d": "Recommended Protein / Carbs / Fat ratio.",
      "guide.dash_weight_t": "Weight progress",
      "guide.dash_weight_d": "Weight trend line by week.",
      "guide.dash_cal_t": "Calories by day",
      "guide.dash_cal_d": "Calorie bars for the last 7 days.",
      "guide.dash_bmr_t": "BMR vs TDEE",
      "guide.dash_bmr_d": "Compare basal and total energy expenditure.",
      "guide.dash_warn_body": "If the BMR/TDEE chips show \"--\", you need to complete Setup first.",

      /* ----- guide: chat ----- */
      "guide.chat_title": "Chat with the AI Coach",
      "guide.chat_lead": "This is where you log meals and get contextual advice.",
      "guide.chat_ask_h": "What can you ask?",
      "guide.chat_q1": "\"I just ate a bowl of beef pho, please log it.\"",
      "guide.chat_q2": "\"What should I eat for dinner to get enough protein?\"",
      "guide.chat_q3": "\"What vegetarian dish can replace beef?\"",
      "guide.chat_q4": "\"How many calories do I have left today?\"",
      "guide.chat_note_body": "When AI recognizes a dish, a confirmation box appears before saving to your log to keep the data accurate.",

      /* ----- guide: plan ----- */
      "guide.plan_title": "7-day meal plan",
      "guide.plan_lead": "This is where the meal plan is displayed as a table of day × meal.",
      "guide.plan_li1": "Each cell is a meal suggested by AI to fit your calorie & macro targets.",
      "guide.plan_li2": "Tap <strong>\"Regenerate plan\"</strong> for AI to create a new option.",
      "guide.plan_li3": "Drag the bar below to see AI feedback/explanations about the plan.",

      /* ----- guide: tips ----- */
      "guide.tips_title": "Tips for effective use",
      "guide.tips_dash_t": "Open Dashboard",
      "guide.tips_dash_d": "Check your metrics each morning to plan suitable meals for the day.",
      "guide.tips_dash_go": "Open Diet",
      "guide.tips_chat_t": "Log meals",
      "guide.tips_chat_d": "Enter meals as soon as possible after eating for accurate data.",
      "guide.tips_chat_go": "Open Chat",
      "guide.tips_plan_t": "Plan your week",
      "guide.tips_plan_d": "Generate the plan at the start of the week to prep ingredients ahead.",
      "guide.tips_plan_go": "Open Plan",
      "guide.tips_setup_t": "Update profile",
      "guide.tips_setup_d": "Change your weight/goals periodically so AI recalculates your metrics.",
      "guide.tips_setup_go": "Open Setup",

      /* ----- guide: faq ----- */
      "guide.faq_title": "Frequently asked questions",
      "guide.faq_q1": "Is my data secure?",
      "guide.faq_a1": "All personal data is stored on your own account and only you can access it after signing in.",
      "guide.faq_q2": "Why don't my entered calories match the AI's calculation?",
      "guide.faq_a2": "AI estimates based on average portions. If your dish is larger/smaller, say so in chat (e.g. \"a large 500ml bowl of pho\").",
      "guide.faq_q3": "Can I change my goal after setup?",
      "guide.faq_a3": "Yes. Go to Setup → choose a new goal → AI will recalculate your target calories and macros.",
      "guide.faq_q4": "Does the 7-day plan change each week?",
      "guide.faq_a4": "You can tap \"Regenerate\" anytime to get a new menu suited to your taste/season.",

      /* ----- plan completion overlay ----- */
      "plan.congrat_title": "Congratulations!",
      "plan.congrat_body": "You've successfully completed your nutrition journey. Update your new stats so AI can design your next plan!",
      "plan.congrat_btn": "Start a new journey",
      "toast.login_required": "Please sign in!",
      "toast.estimate_fail": "Couldn't estimate",
      "toast.estimate_net_err": "Network error while estimating",
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

  /* t() có hỗ trợ thay thế biến dạng {n}: tn('diet.disease_many_title', {n: 3}) */
  function tn(key, vars, fallback) {
    let s = t(key, fallback);
    if (vars && typeof s === "string") {
      Object.keys(vars).forEach((k) => {
        s = s.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
      });
    }
    return s;
  }

  /* ---------------------------------------------------------------------------
   * Bản đồ TÊN BỆNH: giá trị lưu trong DB (thường tiếng Việt) -> khoá i18n.
   * Giúp thẻ "Bệnh lý cần lưu ý" hiển thị đúng ngôn ngữ. Bệnh tự nhập -> giữ nguyên.
   * ------------------------------------------------------------------------- */
  const DISEASE_KEY_BY_VALUE = {
    "gout": "disease.gout",
    "tiểu đường": "disease.diabetes", "tieu duong": "disease.diabetes", "diabetes": "disease.diabetes",
    "huyết áp cao": "disease.hypertension", "cao huyết áp": "disease.hypertension",
    "huyet ap cao": "disease.hypertension", "high blood pressure": "disease.hypertension", "hypertension": "disease.hypertension",
    "mỡ máu cao": "disease.high_cholesterol", "mo mau cao": "disease.high_cholesterol", "high cholesterol": "disease.high_cholesterol",
    "gan nhiễm mỡ": "disease.fatty_liver", "gan nhiem mo": "disease.fatty_liver", "fatty liver": "disease.fatty_liver",
    "bệnh dạ dày": "disease.stomach", "đau dạ dày": "disease.stomach", "benh da day": "disease.stomach", "stomach": "disease.stomach", "stomach problems": "disease.stomach",
    "bệnh thận": "disease.kidney", "benh than": "disease.kidney", "kidney": "disease.kidney", "kidney disease": "disease.kidney",
    "khác": "disease.other", "khac": "disease.other", "other": "disease.other",
  };
  function localizeDisease(value) {
    const raw = String(value || "").trim();
    if (!raw) return raw;
    const k = DISEASE_KEY_BY_VALUE[raw.toLowerCase()];
    return k ? t(k, raw) : raw; // tên bệnh tự nhập -> giữ nguyên
  }

  /* ---------------------------------------------------------------------------
   * Bản đồ TÊN MÓN ĂN (best-effort): chỉ dịch sang EN khi đang ở tiếng Anh,
   * khớp chính xác mới dịch, không khớp thì giữ nguyên tên tiếng Việt.
   * ------------------------------------------------------------------------- */
  const FOOD_EN = {
    "phở": "Pho", "phở bò": "Beef pho", "phở gà": "Chicken pho",
    "bún bò": "Beef noodle soup (bun bo)", "bún bò huế": "Hue beef noodle soup",
    "bún chả": "Grilled pork & noodles (bun cha)", "bún riêu": "Crab noodle soup (bun rieu)",
    "bún thịt nướng": "Grilled pork vermicelli", "bún": "Rice vermicelli",
    "cơm": "Rice", "cơm trắng": "Steamed white rice", "cơm tấm": "Broken rice with grilled pork",
    "cơm gà": "Chicken rice", "cơm sườn": "Rice with pork chop",
    "bánh mì": "Banh mi (Vietnamese baguette)", "bánh mì trứng": "Egg banh mi",
    "gỏi cuốn": "Fresh spring rolls", "chả giò": "Fried spring rolls", "nem rán": "Fried spring rolls",
    "hủ tiếu": "Hu tieu noodle soup", "mì": "Noodles", "mì xào": "Stir-fried noodles", "miến": "Glass noodles",
    "cháo": "Rice porridge", "cháo gà": "Chicken congee", "cháo trắng": "Plain rice porridge",
    "canh": "Soup", "canh chua": "Sour soup", "canh rau": "Vegetable soup",
    "rau luộc": "Boiled vegetables", "rau muống xào": "Stir-fried water spinach", "rau xào": "Stir-fried vegetables",
    "trứng": "Eggs", "trứng luộc": "Boiled eggs", "trứng chiên": "Fried eggs", "trứng ốp la": "Fried eggs (sunny-side up)",
    "ức gà": "Chicken breast", "thịt gà": "Chicken", "gà luộc": "Boiled chicken",
    "thịt bò": "Beef", "bò xào": "Stir-fried beef", "thịt heo": "Pork", "thịt lợn": "Pork",
    "cá": "Fish", "cá hấp": "Steamed fish", "cá kho": "Braised fish", "cá chiên": "Fried fish",
    "tôm": "Shrimp", "tôm hấp": "Steamed shrimp",
    "đậu hũ": "Tofu", "đậu phụ": "Tofu", "đậu hũ sốt cà": "Tofu in tomato sauce",
    "sữa chua": "Yogurt", "sữa chua không đường": "Unsweetened yogurt",
    "sinh tố": "Smoothie", "yến mạch": "Oatmeal", "salad": "Salad",
    "trái cây": "Fruit", "chuối": "Banana", "táo": "Apple", "cam": "Orange", "ổi": "Guava",
    "trà sữa": "Bubble milk tea", "nước ép": "Juice",
  };
  function localizeFood(name) {
    const raw = String(name || "").trim();
    if (!raw || getLang() !== "en") return raw;
    const key = raw.toLowerCase().replace(/\s+/g, " ");
    if (FOOD_EN[key]) return FOOD_EN[key];
    const base = key.replace(/\(.*?\)/g, "").trim(); // bỏ phần mô tả trong ngoặc
    if (FOOD_EN[base]) return FOOD_EN[base];
    return raw; // không có trong từ điển -> giữ tên gốc
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
  window.tn = tn;
  window.i18n = { t, tn, setLang, getLang, applyTranslations, localizeDisease, localizeFood, DICT };

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
