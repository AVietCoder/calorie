'use client';
// surveyPrompt.js — luật quyết định "khi nào mời người dùng làm khảo sát".
//
// Tách riêng khỏi component để trang /review có thể đánh dấu ĐÃ GỬI mà không
// phải import cả UI, và để các ngưỡng nằm một chỗ dễ chỉnh.
//
// Vì sao phải đủ CẢ số ngày LẪN số phiên: bản khảo sát hỏi "đã dùng bao lâu" và
// "tần suất sử dụng" — người vừa đăng ký 5 phút không trả lời nổi. Đếm phiên
// loại thêm trường hợp cài xong rồi bỏ đó một tuần mới mở lại lần hai.

/** Số ngày kể từ lần đầu mở app trước khi được phép mời. */
export const FIRST_SEEN_DAYS = 3;
/** Số phiên tối thiểu (mỗi lần mở tab/trình duyệt tính 1 phiên). */
export const MIN_SESSIONS = 3;
/** Bấm "Để sau" thì im lặng bao nhiêu ngày. */
export const SNOOZE_DAYS = 7;

const FIRST_SEEN_KEY = 'calorie_survey_first_seen';
const SESSIONS_KEY = 'calorie_survey_sessions';
const STATE_KEY = 'calorie_survey_state';
const SNOOZE_KEY = 'calorie_survey_snooze_until';
const SESSION_FLAG = 'calorie_survey_session_counted';

const DAY_MS = 24 * 60 * 60 * 1000;

function readInt(store, key) {
  const raw = Number(store.getItem(key));
  return Number.isFinite(raw) ? raw : 0;
}

/**
 * Ghi nhận một phiên sử dụng. Gọi mỗi lần app khởi động; sessionStorage đảm bảo
 * mỗi phiên chỉ cộng đúng một lần dù người dùng điều hướng qua bao nhiêu trang.
 */
export function recordSurveySession() {
  if (typeof window === 'undefined') return;
  const { localStorage, sessionStorage } = window;

  if (!readInt(localStorage, FIRST_SEEN_KEY)) {
    localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()));
  }
  if (sessionStorage.getItem(SESSION_FLAG) === '1') return;
  sessionStorage.setItem(SESSION_FLAG, '1');
  localStorage.setItem(SESSIONS_KEY, String(readInt(localStorage, SESSIONS_KEY) + 1));
}

/** Đã đủ điều kiện mời khảo sát chưa? */
export function shouldShowSurveyPrompt() {
  if (typeof window === 'undefined') return false;
  const { localStorage } = window;

  if (!localStorage.getItem('calorie_ai_token')) return false;
  if (localStorage.getItem(STATE_KEY) === 'done') return false;
  if (Date.now() < readInt(localStorage, SNOOZE_KEY)) return false;

  const firstSeen = readInt(localStorage, FIRST_SEEN_KEY);
  if (!firstSeen) return false;
  if (Date.now() - firstSeen < FIRST_SEEN_DAYS * DAY_MS) return false;

  return readInt(localStorage, SESSIONS_KEY) >= MIN_SESSIONS;
}

/** Hoãn lời mời SNOOZE_DAYS ngày ("Để sau" hoặc đóng popup). */
export function snoozeSurveyPrompt() {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * DAY_MS));
}

/** Đã gửi khảo sát — không mời lại nữa. Gọi từ /review sau khi POST thành công. */
export function markSurveyDone() {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STATE_KEY, 'done');
}

/** Xoá toàn bộ trạng thái — quay về như người dùng hoàn toàn mới. */
export function resetSurveyPrompt() {
  if (typeof window === 'undefined') return;
  const { localStorage, sessionStorage } = window;
  [FIRST_SEEN_KEY, SESSIONS_KEY, STATE_KEY, SNOOZE_KEY].forEach((k) => localStorage.removeItem(k));
  sessionStorage.removeItem(SESSION_FLAG);
}

/**
 * Giả lập "đã dùng đủ lâu" để xem popup ngay, không phải chờ 3 ngày.
 * Chỉ dùng khi kiểm thử — tải lại trang sau khi gọi.
 */
export function forceSurveyPrompt() {
  if (typeof window === 'undefined') return;
  const { localStorage } = window;
  localStorage.setItem(FIRST_SEEN_KEY, String(Date.now() - (FIRST_SEEN_DAYS + 1) * DAY_MS));
  localStorage.setItem(SESSIONS_KEY, String(MIN_SESSIONS));
  localStorage.removeItem(STATE_KEY);
  localStorage.removeItem(SNOOZE_KEY);
}
