'use client';
// SurveyPrompt — thẻ mời làm khảo sát, nổi ở góc dưới phải sau khi người dùng đã
// dùng app một thời gian (luật ở lib-client/surveyPrompt.js).
//
// Vì sao không dùng toast: toast tự tắt sau 4 giây và không bấm được, trong khi
// đây là lời mời cần đọc rồi quyết định. Nên nó là một thẻ riêng, ở lại cho tới
// khi người dùng chọn.
//
// Nằm trong PageShell (cạnh FamilyNotices) để bắt được ở BẤT KỲ trang nào người
// dùng vào, không phải chờ họ ghé đúng một trang cụ thể.
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslation } from '../lib-client/I18nContext';
import {
  forceSurveyPrompt,
  recordSurveySession,
  resetSurveyPrompt,
  shouldShowSurveyPrompt,
  snoozeSurveyPrompt,
} from '../lib-client/surveyPrompt';

export default function SurveyPrompt() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();

  // Ngưỡng 3 ngày + 3 phiên khiến không thể tự xem popup trong ngày đầu phát
  // triển. Ở bản dev, mở Console gõ `drfitSurvey.force()` rồi F5 để xem ngay.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    window.drfitSurvey = { force: forceSurveyPrompt, reset: resetSurveyPrompt };
  }, []);

  useEffect(() => {
    // Đang ở chính trang khảo sát thì mời làm gì nữa.
    if (pathname?.startsWith('/review')) return;

    recordSurveySession();
    if (!shouldShowSurveyPrompt()) return;

    // Chờ một nhịp để không đập vào mặt người dùng ngay lúc trang vừa tải.
    const timer = setTimeout(() => setVisible(true), 2500);
    return () => clearTimeout(timer);
  }, [pathname]);

  function close() {
    setLeaving(true);
    setTimeout(() => setVisible(false), 260);
  }

  function onLater() {
    snoozeSurveyPrompt();
    close();
  }

  function onAccept() {
    // Hoãn chứ chưa đánh dấu xong: chỉ khi POST khảo sát thành công, trang
    // /review mới gọi markSurveyDone(). Bấm vào rồi bỏ ngang thì vài ngày sau
    // được mời lại, không mất hẳn cơ hội.
    snoozeSurveyPrompt();
    close();
    router.push('/review');
  }

  if (!visible) return null;

  return (
    <div className={`survey-prompt${leaving ? ' is-leaving' : ''}`} role="dialog" aria-live="polite">
      <button
        type="button"
        className="survey-prompt__close"
        onClick={onLater}
        aria-label={t('common.close', 'Đóng')}
      >
        <i className="fa-solid fa-xmark" />
      </button>

      <div className="survey-prompt__icon"><i className="fa-solid fa-comment-dots" /></div>

      <div className="survey-prompt__body">
        <strong>{t('survey.prompt_title', 'Bạn thấy Dr.Fit thế nào?')}</strong>
        <p>{t('survey.prompt_desc', 'Dành 3 phút chia sẻ trải nghiệm để đội ngũ cải thiện đúng thứ bạn cần.')}</p>
        <div className="survey-prompt__actions">
          <button type="button" className="survey-prompt__cta" onClick={onAccept}>
            <i className="fa-solid fa-star" /> {t('survey.prompt_cta', 'Đánh giá ngay')}
          </button>
          <button type="button" className="survey-prompt__later" onClick={onLater}>
            {t('survey.prompt_later', 'Để sau')}
          </button>
        </div>
      </div>
    </div>
  );
}
