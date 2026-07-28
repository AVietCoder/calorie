'use client';

import { useEffect, useMemo, useState } from 'react';
import PageShell from '../../components/PageShell';
import { useApi } from '../../lib-client/useApi';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import { SURVEY_QUESTIONS, SURVEY_SECTIONS } from '../../lib/survey';
import '../../styles/review.css';

const SCORE_LABELS = [
  { score: 1, label: 'Rất không đồng ý' },
  { score: 2, label: 'Không đồng ý' },
  { score: 3, label: 'Trung lập' },
  { score: 4, label: 'Đồng ý' },
  { score: 5, label: 'Rất đồng ý' },
];

const SELECT_OPTIONS = {
  ageGroup: [
    ['', 'Chọn nhóm tuổi'],
    ['under_18', 'Dưới 18 tuổi'],
    ['18_24', '18 – 24 tuổi'],
    ['25_34', '25 – 34 tuổi'],
    ['35_44', '35 – 44 tuổi'],
    ['45_54', '45 – 54 tuổi'],
    ['55_plus', 'Từ 55 tuổi'],
    ['prefer_not', 'Không muốn tiết lộ'],
  ],
  gender: [
    ['', 'Chọn giới tính'],
    ['male', 'Nam'],
    ['female', 'Nữ'],
    ['other', 'Khác'],
    ['prefer_not', 'Không muốn tiết lộ'],
  ],
  occupation: [
    ['', 'Chọn nghề nghiệp'],
    ['student', 'Học sinh / Sinh viên'],
    ['office', 'Nhân viên văn phòng'],
    ['manual', 'Lao động thể chất'],
    ['freelance', 'Tự do / Kinh doanh'],
    ['homemaker', 'Nội trợ'],
    ['retired', 'Đã nghỉ hưu'],
    ['other', 'Khác'],
  ],
  usageDuration: [
    ['', 'Chọn thời gian sử dụng'],
    ['under_week', 'Dưới 1 tuần'],
    ['1_4_weeks', '1 – 4 tuần'],
    ['1_3_months', '1 – 3 tháng'],
    ['over_3_months', 'Trên 3 tháng'],
  ],
  usageFrequency: [
    ['', 'Chọn tần suất'],
    ['daily', 'Hằng ngày'],
    ['few_week', 'Vài lần mỗi tuần'],
    ['weekly', 'Khoảng 1 lần mỗi tuần'],
    ['rarely', 'Ít hơn 1 lần mỗi tuần'],
  ],
  primaryGoal: [
    ['', 'Chọn mục tiêu chính'],
    ['lose', 'Giảm cân'],
    ['maintain', 'Giữ cân'],
    ['gain', 'Tăng cân'],
    ['muscle', 'Tăng cơ'],
    ['health', 'Cải thiện sức khỏe'],
    ['disease', 'Hỗ trợ kiểm soát bệnh lý'],
    ['other', 'Khác'],
  ],
};

const EMPTY_PROFILE = {
  ageGroup: '',
  gender: '',
  occupation: '',
  usageDuration: '',
  usageFrequency: '',
  primaryGoal: '',
};

function ageGroupFromBirthYear(birthYear) {
  const year = Number(birthYear);
  if (!year) return '';
  const age = new Date().getFullYear() - year;
  if (age < 18) return 'under_18';
  if (age <= 24) return '18_24';
  if (age <= 34) return '25_34';
  if (age <= 44) return '35_44';
  if (age <= 54) return '45_54';
  return '55_plus';
}

export default function SurveyPage() {
  const [activeToc, setActiveToc] = useState('#intro');
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [answers, setAnswers] = useState({});
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { get, post } = useApi();
  const showToast = useToast();
  const { t } = useTranslation();

  const toc = useMemo(
    () => [
      { href: '#intro', icon: 'fa-sparkles', label: 'Giới thiệu' },
      { href: '#profile', icon: 'fa-user-group', label: 'Thông tin chung' },
      ...SURVEY_SECTIONS.map((section) => ({
        href: `#${section.id}`,
        icon: section.icon,
        label: t(section.titleKey, section.title),
      })),
      { href: '#comment', icon: 'fa-message', label: 'Góp ý thêm' },
    ],
    [t]
  );

  const answeredCount = Object.keys(answers).length;
  const progress = Math.round((answeredCount / SURVEY_QUESTIONS.length) * 100);

  useEffect(() => {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) return;

    get('/api/diet-info')
      .then((data) => {
        const savedProfile = data?.profile;
        if (!savedProfile) return;
        setProfile((current) => ({
          ...current,
          ageGroup: ageGroupFromBirthYear(savedProfile.birth_year),
          gender: ['male', 'female'].includes(savedProfile.gender) ? savedProfile.gender : current.gender,
          primaryGoal: String(savedProfile.goal || '').split(',').find((goal) =>
            SELECT_OPTIONS.primaryGoal.some(([value]) => value === goal)
          ) || current.primaryGoal,
        }));
      })
      .catch(() => {});
    // Chỉ khôi phục dữ liệu hồ sơ một lần khi mở trang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY + 160;
      let active = toc[0].href;
      for (const item of toc) {
        const element = document.querySelector(item.href);
        if (element && element.offsetTop <= y) active = item.href;
      }
      setActiveToc(active);
    }

    document.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => document.removeEventListener('scroll', onScroll);
  }, [toc]);

  function scrollToSection(event, href) {
    event.preventDefault();
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setProfileField(field, value) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  function handleRating(questionId, score) {
    setAnswers((current) => ({ ...current, [questionId]: score }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const missingProfileField = Object.entries(profile).find(([, value]) => !value);
    if (missingProfileField) {
      document.querySelector('#profile')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast('Vui lòng hoàn thành phần thông tin chung.', 'error');
      return;
    }

    const missingQuestion = SURVEY_QUESTIONS.find((question) => !answers[question.id]);
    if (missingQuestion) {
      document.querySelector(`#${missingQuestion.sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast('Bạn còn một số câu hỏi chưa đánh giá.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      await post('/api/survey', { ...profile, answers, comment });
      setSubmitted(true);
      showToast(t('review.submit_success', 'Cảm ơn bạn đã tham gia khảo sát!'), 'success');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      showToast(error.message || 'Không thể gửi khảo sát. Vui lòng thử lại.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell variant="review" showSideNav={false}>
      <div className="review-layout">
        <aside className="review-toc" aria-label="Nội dung khảo sát">
          <div className="review-toc__head">
            <span className="review-toc__kicker">Tiến độ của bạn</span>
            <strong>{answeredCount}/{SURVEY_QUESTIONS.length} câu</strong>
          </div>
          <div className="review-progress" aria-label={`Đã hoàn thành ${progress}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <nav>
            {toc.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={activeToc === item.href ? 'active' : ''}
                onClick={(event) => scrollToSection(event, item.href)}
              >
                <i className={`fa-solid ${item.icon}`} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
          <p><i className="fa-solid fa-shield-heart" /> Phản hồi được bảo mật và chỉ dùng để cải thiện sản phẩm.</p>
        </aside>

        <form className="review-form" onSubmit={handleSubmit}>
          <section className="review-hero" id="intro">
            <div className="review-hero__content">
              <span className="review-eyebrow"><i className="fa-solid fa-comment-dots" /> Tiếng nói của bạn</span>
              <h1>Giúp Dr.Fit tốt hơn<br />sau mỗi trải nghiệm.</h1>
              <p>
                Những đánh giá chân thực sẽ giúp đội ngũ ưu tiên đúng tính năng và tạo ra
                một hành trình dinh dưỡng phù hợp hơn với bạn.
              </p>
              <div className="review-hero__meta">
                <span><i className="fa-regular fa-clock" /> Khoảng 3 phút</span>
                <span><i className="fa-solid fa-lock" /> Dữ liệu bảo mật</span>
                <span><i className="fa-solid fa-chart-line" /> Tạo tác động thực tế</span>
              </div>
            </div>
            <div className="review-hero__score" aria-hidden="true">
              <div className="score-orbit score-orbit--one" />
              <div className="score-orbit score-orbit--two" />
              <strong>5.0</strong>
              <span>Trải nghiệm<br />tuyệt vời</span>
            </div>
          </section>

          {submitted ? (
            <section className="review-success" role="status">
              <span className="review-success__icon"><i className="fa-solid fa-check" /></span>
              <div>
                <span className="review-eyebrow">Đã ghi nhận phản hồi</span>
                <h2>Cảm ơn bạn đã dành thời gian.</h2>
                <p>Mọi câu trả lời đã được lưu thành công và sẽ xuất hiện trong báo cáo khảo sát của quản trị viên.</p>
              </div>
            </section>
          ) : (
            <>
              <section className="review-section review-profile" id="profile">
                <div className="review-section__head">
                  <span className="review-section__number">01</span>
                  <div>
                    <span className="review-section__kicker">Về bạn</span>
                    <h2>Thông tin chung</h2>
                    <p>Giúp chúng tôi hiểu phản hồi đến từ nhóm người dùng nào.</p>
                  </div>
                </div>
                <div className="review-profile__grid">
                  {[
                    ['ageGroup', 'fa-cake-candles', 'Lứa tuổi'],
                    ['gender', 'fa-venus-mars', 'Giới tính'],
                    ['occupation', 'fa-briefcase', 'Nghề nghiệp'],
                    ['usageDuration', 'fa-hourglass-half', 'Thời gian đã sử dụng'],
                    ['usageFrequency', 'fa-calendar-check', 'Tần suất sử dụng'],
                    ['primaryGoal', 'fa-bullseye', 'Mục tiêu chính'],
                  ].map(([field, icon, label]) => (
                    <label className="review-field" key={field}>
                      <span><i className={`fa-solid ${icon}`} /> {label}<em>*</em></span>
                      <select
                        value={profile[field]}
                        onChange={(event) => setProfileField(field, event.target.value)}
                        required
                      >
                        {SELECT_OPTIONS[field].map(([value, optionLabel]) => (
                          <option value={value} key={value || 'placeholder'}>{optionLabel}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </section>

              {SURVEY_SECTIONS.map((section, sectionIndex) => (
                <section className="review-section" id={section.id} key={section.id}>
                  <div className="review-section__head">
                    <span className="review-section__number">{String(sectionIndex + 2).padStart(2, '0')}</span>
                    <div>
                      <span className="review-section__kicker">Đánh giá trải nghiệm</span>
                      <h2>{t(section.titleKey, section.title)}</h2>
                      <p>Chọn mức độ đồng ý phù hợp nhất với trải nghiệm của bạn.</p>
                    </div>
                  </div>

                  <div className="review-question-list">
                    {section.questions.map((question, questionIndex) => (
                      <fieldset className={`review-question${answers[question.id] ? ' is-answered' : ''}`} key={question.id}>
                        <legend>
                          <span>{String(questionIndex + 1).padStart(2, '0')}</span>
                          {t(question.key, question.text)}
                        </legend>
                        <div className="review-rating">
                          {SCORE_LABELS.map(({ score, label }) => (
                            <label
                              className={answers[question.id] === score ? 'active' : ''}
                              key={score}
                              title={label}
                            >
                              <input
                                type="radio"
                                name={question.id}
                                value={score}
                                checked={answers[question.id] === score}
                                onChange={() => handleRating(question.id, score)}
                              />
                              <strong>{score}</strong>
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>
                        <div className="review-rating__scale" aria-hidden="true">
                          <span>Rất không đồng ý</span>
                          <span>Rất đồng ý</span>
                        </div>
                      </fieldset>
                    ))}
                  </div>
                </section>
              ))}

              <section className="review-section review-comment" id="comment">
                <div className="review-section__head">
                  <span className="review-section__number">{String(SURVEY_SECTIONS.length + 2).padStart(2, '0')}</span>
                  <div>
                    <span className="review-section__kicker">Câu hỏi mở</span>
                    <h2>Bạn muốn Dr.Fit cải thiện điều gì?</h2>
                    <p>Một góp ý cụ thể luôn có giá trị hơn rất nhiều với đội ngũ phát triển.</p>
                  </div>
                </div>
                <label className="review-comment__box">
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value.slice(0, 1000))}
                    rows={5}
                    placeholder="Ví dụ: Tôi muốn thao tác ghi bữa ăn nhanh hơn..."
                  />
                  <span>{comment.length}/1.000</span>
                </label>
              </section>

              <div className="review-submit">
                <div>
                  <strong>{progress}% hoàn thành</strong>
                  <span>Vui lòng trả lời đủ {SURVEY_QUESTIONS.length} câu trước khi gửi.</span>
                </div>
                <button type="submit" disabled={submitting}>
                  {submitting ? <i className="fa-solid fa-circle-notch fa-spin" /> : <i className="fa-solid fa-paper-plane" />}
                  {submitting ? 'Đang lưu phản hồi...' : 'Gửi khảo sát'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </PageShell>
  );
}
