export const SURVEY_SECTIONS = [
  {
    id: 'plan',
    icon: 'fa-calendar-week',
    titleKey: 'review.sec_plan',
    title: 'Thực đơn, kế hoạch',
    questions: [
      { id: 'plan_1', key: 'review.plan_q1', text: 'Thực đơn 7 ngày phù hợp với khẩu vị của tôi' },
      { id: 'plan_2', key: 'review.plan_q2', text: 'Các bữa ăn trong kế hoạch là thực tế (có thể thực hiện)' },
      { id: 'plan_3', key: 'review.plan_q3', text: 'Tôi có thể dễ dàng thay đổi / tạo lại kế hoạch' },
      { id: 'plan_4', key: 'review.plan_q4', text: 'Kế hoạch phù hợp với lịch làm việc/sinh hoạt của tôi' },
      { id: 'plan_5', key: 'review.plan_q5', text: 'Áp dụng thực đơn từ ứng dụng giúp tôi tiến gần hơn tới mục tiêu' },
    ],
  },
  {
    id: 'tracking',
    icon: 'fa-chart-pie',
    titleKey: 'review.sec_tracking',
    title: 'Ghi nhận & Theo dõi',
    questions: [
      { id: 'track_1', key: 'review.track_q1', text: 'Ghi nhận bữa ăn vào ứng dụng dễ dàng' },
      { id: 'track_2', key: 'review.track_q2', text: 'Tôi dễ tìm thấy món ăn mình muốn ghi nhận' },
      { id: 'track_3', key: 'review.track_q3', text: 'Giá trị dinh dưỡng hiển thị chính xác' },
      { id: 'track_4', key: 'review.track_q4', text: 'Vòng tiến độ “Hôm nay đã nạp” giúp tôi kiểm soát lượng nạp' },
      { id: 'track_5', key: 'review.track_q5', text: 'Các biểu đồ (calo, macro, cân nặng) dễ hiểu' },
    ],
  },
  {
    id: 'ai',
    icon: 'fa-robot',
    titleKey: 'review.sec_ai',
    title: 'Trợ lý AI',
    questions: [
      { id: 'ai_1', key: 'review.ai_q1', text: 'Tính năng chat AI hữu ích cho tôi' },
      { id: 'ai_2', key: 'review.ai_q2', text: 'Câu trả lời từ AI hỗ trợ tôi đưa ra quyết định' },
      { id: 'ai_3', key: 'review.ai_q3', text: 'Ghi bữa ăn trực tiếp từ chat (nói “Tôi ăn...”) tiện lợi' },
    ],
  },
  {
    id: 'reminders',
    icon: 'fa-bell',
    titleKey: 'review.sec_reminders',
    title: 'Nhắc nhở & Thông báo',
    questions: [
      { id: 'remind_1', key: 'review.remind_q1', text: 'Tính năng nhắc nhở bữa ăn/uống thuốc hữu ích' },
      { id: 'remind_2', key: 'review.remind_q2', text: 'Nhắc nhở giúp tôi tuân thủ kế hoạch' },
    ],
  },
  {
    id: 'ux',
    icon: 'fa-mobile-screen',
    titleKey: 'review.sec_ux',
    title: 'Trải nghiệm sử dụng',
    questions: [
      { id: 'ux_1', key: 'review.ux_q1', text: 'Ứng dụng dễ sử dụng, dễ tìm các tính năng' },
      { id: 'ux_2', key: 'review.ux_q2', text: 'Giao diện rõ ràng và không rối' },
      { id: 'ux_3', key: 'review.ux_q3', text: 'Ứng dụng tải nhanh, không lag' },
      { id: 'ux_4', key: 'review.ux_q4', text: 'Tương tác với ứng dụng không gặp lỗi' },
    ],
  },
  {
    id: 'ui',
    icon: 'fa-palette',
    titleKey: 'review.sec_ui',
    title: 'Đánh giá giao diện',
    questions: [
      { id: 'ui_1', key: 'review.ui_q1', text: 'Giao diện có dễ sử dụng không?' },
    ],
  },
  {
    id: 'overall',
    icon: 'fa-heart',
    titleKey: 'review.sec_overall',
    title: 'Tổng thể',
    questions: [
      { id: 'all_1', key: 'review.all_q1', text: 'Tôi sẽ tiếp tục sử dụng ứng dụng' },
      { id: 'all_2', key: 'review.all_q2', text: 'Tôi sẽ giới thiệu ứng dụng cho bạn bè' },
    ],
  },
];

export const SURVEY_QUESTIONS = SURVEY_SECTIONS.flatMap((section) =>
  section.questions.map((question, index) => ({
    ...question,
    sectionId: section.id,
    sectionTitle: section.title,
    sortOrder: index + 1,
  }))
);

export const SURVEY_QUESTION_IDS = new Set(SURVEY_QUESTIONS.map((question) => question.id));

export const SURVEY_DEMOGRAPHIC_VALUES = {
  ageGroup: ['under_18', '18_24', '25_34', '35_44', '45_54', '55_plus', 'prefer_not'],
  gender: ['male', 'female', 'other', 'prefer_not'],
  occupation: ['student', 'office', 'manual', 'freelance', 'homemaker', 'retired', 'other'],
  usageDuration: ['under_week', '1_4_weeks', '1_3_months', 'over_3_months'],
  usageFrequency: ['daily', 'few_week', 'weekly', 'rarely'],
  primaryGoal: ['lose', 'maintain', 'gain', 'muscle', 'health', 'disease', 'other'],
};
