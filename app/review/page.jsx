'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import LangSwitch from '../../components/LangSwitch';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/review.css'; // Bạn có thể tạo thêm file survey.css nếu cần style riêng cho form

// Cấu trúc dữ liệu khảo sát
const SURVEY_SECTIONS = [
  {
    id: 'plan',
    icon: 'fa-calendar-week',
    titleKey: 'review.sec_plan',
    titleFallback: 'Thực đơn, kế hoạch',
    questions: [
      { id: 'plan_1', key: 'review.plan_q1', fallback: 'Thực đơn 7 ngày phù hợp với khẩu vị của tôi' },
      { id: 'plan_2', key: 'review.plan_q2', fallback: 'Các bữa ăn trong kế hoạch là thực tế (có thể thực hiện)' },
      { id: 'plan_3', key: 'review.plan_q3', fallback: 'Tôi có thể dễ dàng thay đổi / regenerate kế hoạch' },
      { id: 'plan_4', key: 'review.plan_q4', fallback: 'Kế hoạch phù hợp với lịch làm việc/sinh hoạt của tôi' },
      { id: 'plan_5', key: 'review.plan_q5', fallback: 'Áp dụng menu từ ứng dụng, tôi thấy hiệu quả với mục tiêu' },
    ]
  },
  {
    id: 'tracking',
    icon: 'fa-chart-pie',
    titleKey: 'review.sec_tracking',
    titleFallback: 'Ghi Nhận & Theo Dõi',
    questions: [
      { id: 'track_1', key: 'review.track_q1', fallback: 'Ghi nhận bữa ăn vào ứng dụng dễ dàng' },
      { id: 'track_2', key: 'review.track_q2', fallback: 'Tôi dễ tìm thấy món ăn mình muốn ghi nhận' },
      { id: 'track_3', key: 'review.track_q3', fallback: 'Giá trị dinh dưỡng hiển thị chính xác' },
      { id: 'track_4', key: 'review.track_q4', fallback: 'Vòng tiến độ "Hôm nay đã nạp" giúp tôi kiểm soát lượng nạp' },
      { id: 'track_5', key: 'review.track_q5', fallback: 'Các biểu đồ (calo, macro, cân nặng) dễ hiểu' },
    ]
  },
  {
    id: 'ai',
    icon: 'fa-robot',
    titleKey: 'review.sec_ai',
    titleFallback: 'AI',
    questions: [
      { id: 'ai_1', key: 'review.ai_q1', fallback: 'Tính năng chat AI hữu ích cho tôi' },
      { id: 'ai_2', key: 'review.ai_q2', fallback: 'Câu trả lời từ AI hỗ trợ tôi đưa ra quyết định' },
      { id: 'ai_3', key: 'review.ai_q3', fallback: 'Ghi bữa ăn trực tiếp từ chat (nói "Tôi ăn...") tiện lợi' },
    ]
  },
  {
    id: 'reminders',
    icon: 'fa-bell',
    titleKey: 'review.sec_reminders',
    titleFallback: 'Nhắc Nhở & Thông Báo',
    questions: [
      { id: 'remind_1', key: 'review.remind_q1', fallback: 'Tính năng nhắc nhở bữa ăn/uống thuốc hữu ích' },
      { id: 'remind_2', key: 'review.remind_q2', fallback: 'Nhắc nhở giúp tôi tuân thủ kế hoạch' },
    ]
  },
  {
    id: 'ux',
    icon: 'fa-mobile-screen',
    titleKey: 'review.sec_ux',
    titleFallback: 'Trải Nghiệm Sử Dụng',
    questions: [
      { id: 'ux_1', key: 'review.ux_q1', fallback: 'Ứng dụng dễ sử dụng, dễ tìm các tính năng' },
      { id: 'ux_2', key: 'review.ux_q2', fallback: 'Giao diện rõ ràng và không rối' },
      { id: 'ux_3', key: 'review.ux_q3', fallback: 'Ứng dụng tải nhanh, không lag' },
      { id: 'ux_4', key: 'review.ux_q4', fallback: 'Tương tác với ứng dụng không gặp lỗi' },
    ]
  },
  {
    id: 'ui',
    icon: 'fa-palette',
    titleKey: 'review.sec_ui',
    titleFallback: 'Đánh giá giao diện',
    questions: [
      { id: 'ui_1', key: 'review.ui_q1', fallback: 'Giao diện có dễ sử dụng không?' },
    ]
  },
  {
    id: 'overall',
    icon: 'fa-heart',
    titleKey: 'review.sec_overall',
    titleFallback: 'Tổng Thể',
    questions: [
      { id: 'all_1', key: 'review.all_q1', fallback: 'Tôi sẽ tiếp tục sử dụng ứng dụng' },
      { id: 'all_2', key: 'review.all_q2', fallback: 'Tôi sẽ giới thiệu ứng dụng cho bạn bè' },
    ]
  }
];

// Mục lục dính (Sticky TOC)
const TOC = [
  { href: '#intro', icon: 'fa-book-open', key: 'review.toc_intro', fallback: 'Giới thiệu' },
  ...SURVEY_SECTIONS.map(sec => ({
    href: `#${sec.id}`,
    icon: sec.icon,
    key: sec.titleKey,
    fallback: sec.titleFallback
  }))
];

export default function SurveyPage() {
  const [activeToc, setActiveToc] = useState('#intro');
  const [answers, setAnswers] = useState({}); // Lưu state các câu trả lời { questionId: 5 }
  const { t } = useTranslation();

  // Xử lý scroll để active mục lục
  useEffect(() => {
    function onScroll() {
      const y = window.scrollY + 140;
      let active = TOC[0].href;
      for (const item of TOC) {
        const el = document.querySelector(item.href);
        if (el && el.offsetTop <= y) active = item.href;
      }
      setActiveToc(active);
    }
    document.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => document.removeEventListener('scroll', onScroll);
  }, []);

  function scrollToSection(e, href) {
    e.preventDefault();
    const el = document.querySelector(href);
    if (el) window.scrollTo({ top: el.offsetTop - 90, behavior: 'smooth' });
  }

  // Handle lưu điểm đánh giá (1-5)
  const handleRating = (questionId, score) => {
    setAnswers(prev => ({ ...prev, [questionId]: score }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log("Survey Answers Data:", answers);
    // Gọi API submit form tại đây
    alert(t('review.submit_success', 'Cảm ơn bạn đã tham gia khảo sát!'));
  };

  return (
    <div className="app-shell">
      <div className="main-wrapper">
        <header className="header">
          <Link href='/' className="logo">
            <img src="white.jpg" alt="Logo" style={{ height: 67, width: 'auto' }} />
          </Link>
          <div className="header-tools">
            <LangSwitch />
            <div className="user-profile-nav">
              <span className="user-name">
                <i className="fa-solid fa-clipboard-list" />
                <strong>{t('review.header_title', 'Khảo sát')}</strong>
              </span>
            </div>
          </div>
        </header>

        <main className="content content--guide">
          <div className="guide-shell">
            
            {/* Sidebar TOC */}
            <nav className="toc">
              <h4>{t('review.toc_title', 'Nội dung khảo sát')}</h4>
              {TOC.map((item) => (
                <a 
                  key={item.href} 
                  href={item.href} 
                  className={activeToc === item.href ? 'active' : ''} 
                  onClick={(e) => scrollToSection(e, item.href)}
                >
                  <i className={`fa-solid ${item.icon}`} /> <span>{t(item.key, item.fallback)}</span>
                </a>
              ))}
            </nav>

            {/* Nội dung chính */}
            <form onSubmit={handleSubmit} className="survey-container">
              
              {/* Intro */}
              <div className="guide-hero" id="intro">
                <span className="eyebrow"><i className="fa-solid fa-comment-dots" /> {t('review.eyebrow_intro', 'Phản hồi')}</span>
                <h1>{t('review.intro_title', 'Khảo sát trải nghiệm người dùng')}</h1>
                <p>{t('review.intro_desc', 'Ý kiến đóng góp của bạn sẽ giúp chúng tôi cải thiện ứng dụng ngày một tốt hơn. Vui lòng đánh giá mức độ đồng ý của bạn với các nhận định dưới đây (1 = Rất không đồng ý, 5 = Rất đồng ý).')}</p>
                <div className="hero-meta">
                  <span className="chip"><i className="fa-solid fa-clock" /> {t('review.chip_time', 'Chỉ mất 3 phút')}</span>
                  <span className="chip"><i className="fa-solid fa-gift" /> {t('review.chip_gift', 'Nhận huy hiệu sau khi hoàn thành')}</span>
                </div>
              </div>

              {/* Render danh sách câu hỏi */}
              {SURVEY_SECTIONS.map((section, index) => (
                <section className="guide-section" id={section.id} key={section.id}>
                  <h2><span className="num">{index + 1}</span> {t(section.titleKey, section.titleFallback)}</h2>
                  
                  <div className="survey-questions-list">
                    {section.questions.map((q) => (
                      <div className="survey-question-card" key={q.id} style={{ marginBottom: '24px', padding: '16px', background: 'var(--surface-color, #f9fafb)', borderRadius: '12px' }}>
                        <p style={{ fontWeight: '600', marginBottom: '12px' }}>{t(q.key, q.fallback)}</p>
                        
                        {/* Rating Group 1-5 */}
                        <div className="rating-group" style={{ display: 'flex', gap: '8px' }}>
                          {[1, 2, 3, 4, 5].map(score => (
                            <button
                              type="button"
                              key={score}
                              onClick={() => handleRating(q.id, score)}
                              style={{
                                width: '40px', height: '40px', borderRadius: '50%', border: '1px solid #d1d5db',
                                cursor: 'pointer', transition: 'all 0.2s',
                                background: answers[q.id] === score ? 'var(--primary-color, #0ea5e9)' : '#fff',
                                color: answers[q.id] === score ? '#fff' : '#374151',
                                fontWeight: answers[q.id] === score ? 'bold' : 'normal'
                              }}
                            >
                              {score}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              {/* Submit Button */}
              <section className="guide-section" style={{ textAlign: 'center', paddingBottom: '40px' }}>
                <button 
                  type="submit" 
                  style={{
                    padding: '12px 32px', fontSize: '16px', fontWeight: 'bold', 
                    borderRadius: '8px', border: 'none', background: 'var(--primary-color, #0ea5e9)', 
                    color: 'white', cursor: 'pointer'
                  }}
                >
                  <i className="fa-solid fa-paper-plane" style={{ marginRight: '8px' }}/>
                  {t('review.btn_submit', 'Gửi Đánh Giá')}
                </button>
              </section>

            </form>
          </div>
        </main>
      </div>
    </div>
  );
}