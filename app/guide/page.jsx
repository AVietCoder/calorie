'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import SideNav from '../../components/SideNav';
import LangSwitch from '../../components/LangSwitch';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/guide.css';

const TOC = [
  { href: '#intro', icon: 'fa-book-open', key: 'guide.toc_intro', fallback: 'Giới thiệu' },
  { href: '#start', icon: 'fa-rocket', key: 'guide.toc_start', fallback: 'Bắt đầu nhanh' },
  { href: '#setup', icon: 'fa-user-gear', key: 'guide.toc_setup', fallback: 'Thiết lập hồ sơ' },
  { href: '#dashboard', icon: 'fa-chart-pie', key: 'guide.toc_dashboard', fallback: 'Dashboard Diet' },
  { href: '#chat', icon: 'fa-comments', key: 'guide.toc_chat', fallback: 'Trò chuyện AI' },
  { href: '#plan', icon: 'fa-calendar-week', key: 'guide.toc_plan', fallback: 'Lịch 7 ngày' },
  { href: '#tips', icon: 'fa-lightbulb', key: 'guide.toc_tips', fallback: 'Mẹo & Lưu ý' },
  { href: '#faq', icon: 'fa-circle-question', key: 'guide.toc_faq', fallback: 'Câu hỏi thường gặp' },
];

export default function GuidePage() {
  const [authState, setAuthState] = useState('loading'); // loading | guest | user
  const [activeToc, setActiveToc] = useState('#intro');
  const router = useRouter();
  const { t } = useTranslation();
  const sectionRefs = useRef({});

  useEffect(() => {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) { setAuthState('guest'); return; }
    (async () => {
      try {
        const res = await fetch('/api/status', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (res.ok && data.success) setAuthState('user');
        else { window.localStorage.removeItem('calorie_ai_token'); setAuthState('guest'); }
      } catch {
        setAuthState('guest');
      }
    })();
  }, []);

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

  const isGuest = authState === 'guest';

  return (
    <div className={isGuest ? '' : 'app-shell'}>
      {!isGuest && <SideNav />}
      <div className="main-wrapper">
        <header className="header">
          <Link href={isGuest ? '/' : '/chat'} className="logo"><i className="fa-solid fa-leaf" /> Calorie AI</Link>
          <div className="header-tools">
            <LangSwitch />
            {!isGuest ? (
              <div className="user-profile-nav" onClick={() => router.push('/diet-details')} title="Quay lại Dashboard">
                <span className="user-name"><i className="fa-solid fa-arrow-left" /><strong>{t('guide.back_dashboard', 'Về Dashboard')}</strong></span>
              </div>
            ) : (
              <div className="user-profile-nav" onClick={() => router.push('/signin')} title="Đăng nhập">
                <span className="user-name"><i className="fa-solid fa-right-to-bracket" /><strong>{t('guide.login_to_continue', 'Đăng nhập để tiếp tục')}</strong></span>
              </div>
            )}
          </div>
        </header>

        <main className="content content--guide">
          <div className="guide-shell">
            <nav className="toc">
              <h4>{t('guide.toc_title', 'Mục lục')}</h4>
              {TOC.map((item) => (
                <a key={item.href} href={item.href} className={activeToc === item.href ? 'active' : ''} onClick={(e) => scrollToSection(e, item.href)}>
                  <i className={`fa-solid ${item.icon}`} /> <span>{t(item.key, item.fallback)}</span>
                </a>
              ))}
            </nav>

            <div>
              <div className="guide-hero" id="intro">
                <span className="eyebrow"><i className="fa-solid fa-book-open" /> {t('guide.toc_intro', 'Giới thiệu')}</span>
                <h1>{t('guide.intro_title', 'Calorie AI là gì?')}</h1>
                <p dangerouslySetInnerHTML={{ __html: t('guide.intro_desc') }} />
                <div className="hero-meta">
                  <span className="chip"><i className="fa-solid fa-clock" /> {t('guide.chip_read5', 'Đọc trong 5 phút')}</span>
                  <span className="chip"><i className="fa-solid fa-leaf" /> {t('guide.chip_beginner', 'Phù hợp người mới')}</span>
                  <span className="chip"><i className="fa-solid fa-shield-halved" /> {t('guide.chip_updated', 'Cập nhật liên tục')}</span>
                </div>
                <div className="feature-list">
                  {[
                    ['fa-bolt', 'guide.feat_auto_t', 'Tính toán tự động', 'guide.feat_auto_d', 'BMR, TDEE, mục tiêu calo & macro theo công thức chuẩn.'],
                    ['fa-comment-dots', 'guide.feat_coach_t', 'HLV AI 24/7', 'guide.feat_coach_d', 'Hỏi đáp về món ăn, thay thế nguyên liệu, ghi nhận bữa ăn.'],
                    ['fa-calendar-week', 'guide.feat_plan_t', 'Lịch 7 ngày', 'guide.feat_plan_d', 'Thực đơn xoay vòng, có thể yêu cầu AI sinh lại theo sở thích.'],
                    ['fa-chart-line', 'guide.feat_progress_t', 'Tiến độ trực quan', 'guide.feat_progress_d', 'Biểu đồ cân nặng, calo và macro theo thời gian thực.'],
                  ].map(([icon, tk, tf, dk, df]) => (
                    <div className="feature-row" key={tk}>
                      <i className={`fa-solid ${icon}`} />
                      <div><strong>{t(tk, tf)}</strong><span>{t(dk, df)}</span></div>
                    </div>
                  ))}
                </div>
              </div>

              <section className="guide-section" id="start">
                <h2><span className="num">1</span> {t('guide.start_title', 'Bắt đầu trong 4 bước')}</h2>
                <p className="lead">{t('guide.start_lead', 'Quy trình từ lúc đăng ký đến khi nhận thực đơn cá nhân hoá.')}</p>
                <div className="step-grid">
                  {[
                    ['fa-user-plus', 'guide.start_s1_t', '1. Đăng ký tài khoản', 'guide.start_s1_d', 'Tạo tài khoản để bắt đầu lưu dữ liệu dinh dưỡng cá nhân.'],
                    ['fa-clipboard-list', 'guide.start_s2_t', '2. Khai báo hồ sơ', 'guide.start_s2_d', 'Nhập thông tin cơ thể, mức vận động, mục tiêu (giảm cân / tăng cơ / duy trì) hoặc tình trạng sức khỏe.'],
                    ['fa-wand-magic-sparkles', 'guide.start_s3_t', '3. Nhận đề xuất', 'guide.start_s3_d', 'Hệ thống tự động tính BMR, TDEE và xây dựng chế độ ăn phù hợp với thể trạng.'],
                    ['fa-utensils', 'guide.start_s4_t', '4. Theo dõi mỗi ngày', 'guide.start_s4_d', 'Ghi nhận bữa ăn hằng ngày qua chat, theo dõi lượng calo và macro đã nạp.'],
                  ].map(([icon, tk, tf, dk, df]) => (
                    <div className="step-card" key={tk}>
                      <div className="step-icon"><i className={`fa-solid ${icon}`} /></div>
                      <h4>{t(tk, tf)}</h4>
                      <p>{t(dk, df)}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="guide-section" id="setup">
                <h2><span className="num">2</span> {t('guide.setup_title', 'Thiết lập hồ sơ (Setup)')}</h2>
                <p className="lead">{t('guide.setup_lead', 'Tại đây trang chia làm 4 bước — biểu tượng tiến độ ở trên cùng cho biết bạn đang ở đâu.')}</p>
                <h3>{t('guide.setup_fields_h', 'Các trường thông tin')}</h3>
                <ul>
                  <li dangerouslySetInnerHTML={{ __html: t('guide.setup_li1') }} />
                  <li dangerouslySetInnerHTML={{ __html: t('guide.setup_li2') }} />
                  <li dangerouslySetInnerHTML={{ __html: t('guide.setup_li3') }} />
                  <li dangerouslySetInnerHTML={{ __html: t('guide.setup_li4') }} />
                </ul>
                <div className="tip"><strong><i className="fa-solid fa-lightbulb" /> {t('guide.label_tip', 'Mẹo:')}</strong> {t('guide.setup_tip_body', 'Cập nhật cân nặng mỗi tuần để biểu đồ tiến độ phản ánh đúng thực tế.')}</div>
              </section>

              <section className="guide-section" id="dashboard">
                <h2><span className="num">3</span> {t('guide.dash_title', 'Dashboard Diet')}</h2>
                <p className="lead">{t('guide.dash_lead', 'Tại đây trang tổng hợp toàn bộ chỉ số quan trọng dưới dạng biểu đồ trực quan.')}</p>
                <div className="feature-list">
                  {[
                    ['fa-chart-pie', 'guide.dash_macro_t', 'Macro Donut', 'guide.dash_macro_d', 'Tỉ lệ Protein / Carbs / Fat đề xuất.'],
                    ['fa-route', 'guide.dash_weight_t', 'Tiến độ cân nặng', 'guide.dash_weight_d', 'Đường biểu diễn cân theo tuần.'],
                    ['fa-chart-column', 'guide.dash_cal_t', 'Calo theo ngày', 'guide.dash_cal_d', 'Cột calo nạp 7 ngày gần nhất.'],
                    ['fa-gauge-high', 'guide.dash_bmr_t', 'BMR vs TDEE', 'guide.dash_bmr_d', 'So sánh năng lượng cơ bản và tiêu hao.'],
                  ].map(([icon, tk, tf, dk, df]) => (
                    <div className="feature-row" key={tk}>
                      <i className={`fa-solid ${icon}`} />
                      <div><strong>{t(tk, tf)}</strong><span>{t(dk, df)}</span></div>
                    </div>
                  ))}
                </div>
                <div className="tip warn"><strong><i className="fa-solid fa-triangle-exclamation" /> {t('guide.label_note', 'Lưu ý:')}</strong> {t('guide.dash_warn_body', 'Nếu các chip BMR/TDEE hiển thị "--", bạn cần hoàn tất Setup trước.')}</div>
              </section>

              <section className="guide-section" id="chat">
                <h2><span className="num">4</span> {t('guide.chat_title', 'Trò chuyện với HLV AI')}</h2>
                <p className="lead">{t('guide.chat_lead', 'Đây là nơi bạn ghi nhận bữa ăn và nhận tư vấn theo ngữ cảnh.')}</p>
                <h3>{t('guide.chat_ask_h', 'Bạn có thể hỏi gì?')}</h3>
                <ul>
                  <li>{t('guide.chat_q1', '"Tôi vừa ăn 1 bát phở bò, ghi nhận giúp tôi."')}</li>
                  <li>{t('guide.chat_q2', '"Bữa tối hôm nay nên ăn gì để đủ Protein?"')}</li>
                  <li>{t('guide.chat_q3', '"Có thể thay thịt bò bằng món chay nào?"')}</li>
                  <li>{t('guide.chat_q4', '"Hôm nay tôi còn bao nhiêu calo?"')}</li>
                </ul>
                <div className="tip"><strong><i className="fa-solid fa-circle-info" /> {t('guide.label_note', 'Lưu ý:')}</strong> {t('guide.chat_note_body', 'Khi AI nhận diện món ăn, sẽ hiện hộp xác nhận trước khi lưu vào nhật ký để đảm bảo dữ liệu chính xác.')}</div>
              </section>

              <section className="guide-section" id="plan">
                <h2><span className="num">5</span> {t('guide.plan_title', 'Lịch ăn 7 ngày')}</h2>
                <p className="lead">{t('guide.plan_lead', 'Đây là nơi hiển thị thực đơn dạng bảng theo ngày × bữa.')}</p>
                <ul>
                  <li>{t('guide.plan_li1', 'Mỗi ô là một bữa được AI gợi ý phù hợp với mục tiêu calo & macro.')}</li>
                  <li dangerouslySetInnerHTML={{ __html: t('guide.plan_li2') }} />
                  <li>{t('guide.plan_li3', 'Kéo thanh bên dưới để xem các phản hồi/giải thích từ AI về kế hoạch.')}</li>
                </ul>
              </section>

              <section className="guide-section" id="tips">
                <h2><span className="num">6</span> {t('guide.tips_title', 'Mẹo dùng hiệu quả')}</h2>
                <div className="page-cards">
                  {[
                    ['/diet-details', 'fa-fire-flame-curved', 'guide.tips_dash_t', 'Vào Dashboard', 'guide.tips_dash_d', 'Kiểm tra chỉ số mỗi sáng để có kế hoạch ăn phù hợp trong ngày.', 'guide.tips_dash_go', 'Mở Diet'],
                    ['/chat', 'fa-comments', 'guide.tips_chat_t', 'Ghi nhận bữa ăn', 'guide.tips_chat_d', 'Nhập càng sớm càng tốt sau khi ăn để dữ liệu được chính xác.', 'guide.tips_chat_go', 'Mở Chat'],
                    ['/schedule', 'fa-calendar-week', 'guide.tips_plan_t', 'Lên kế hoạch tuần', 'guide.tips_plan_d', 'Sinh lịch vào đầu tuần để chuẩn bị nguyên liệu trước.', 'guide.tips_plan_go', 'Mở Plan'],
                    ['/setup', 'fa-user-gear', 'guide.tips_setup_t', 'Cập nhật hồ sơ', 'guide.tips_setup_d', 'Thay đổi cân nặng/mục tiêu định kỳ để AI tính lại chỉ số.', 'guide.tips_setup_go', 'Mở Setup'],
                  ].map(([href, icon, tk, tf, dk, df, gk, gf]) => (
                    <Link className="page-card" href={href} key={href}>
                      <div className="pc-head"><div className="pc-icon"><i className={`fa-solid ${icon}`} /></div><h4>{t(tk, tf)}</h4></div>
                      <p>{t(dk, df)}</p>
                      <span className="go">{t(gk, gf)} <i className="fa-solid fa-arrow-right" /></span>
                    </Link>
                  ))}
                </div>
              </section>

              <section className="guide-section faq" id="faq">
                <h2><span className="num">7</span> {t('guide.faq_title', 'Câu hỏi thường gặp')}</h2>
                {[
                  ['guide.faq_q1', 'Dữ liệu của tôi có được bảo mật?', 'guide.faq_a1', 'Toàn bộ dữ liệu cá nhân được lưu trên tài khoản riêng và chỉ bạn truy cập được sau khi đăng nhập.', true],
                  ['guide.faq_q2', 'Tại sao calo tôi nhập không khớp với AI tính?', 'guide.faq_a2', 'AI ước lượng theo khẩu phần trung bình. Nếu món của bạn lớn/nhỏ hơn, hãy nói rõ trong chat.', false],
                  ['guide.faq_q3', 'Tôi có thể đổi mục tiêu sau khi setup?', 'guide.faq_a3', 'Có. Vào trang Setup → chọn mục tiêu mới → AI sẽ tính lại calo và macro mục tiêu.', false],
                  ['guide.faq_q4', 'Lịch 7 ngày có thay đổi mỗi tuần không?', 'guide.faq_a4', 'Bạn có thể bấm "Sinh lại" bất kỳ lúc nào để có thực đơn mới phù hợp khẩu vị/mùa.', false],
                ].map(([qk, qf, ak, af, open]) => (
                  <details key={qk} open={open || undefined}>
                    <summary><i className="fa-solid fa-circle-question" /> <span>{t(qk, qf)}</span><i className="fa-solid fa-chevron-down chev" /></summary>
                    <p>{t(ak, af)}</p>
                  </details>
                ))}
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
