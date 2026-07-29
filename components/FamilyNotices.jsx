'use client';
// FamilyNotices — hiện các thông báo "để dành" về gia đình (được duyệt vào /
// bị gỡ khỏi gia đình) ở LẦN ĐĂNG NHẬP KẾ TIẾP.
//
// Vì sao lại nằm trong PageShell chứ không phải trang Kitchen: người bị gỡ khỏi
// gia đình có thể không bao giờ mở lại trang Kitchen, nên phải bắt được ở BẤT KỲ
// trang nào họ vào sau khi đăng nhập.
//
// Chỉ gọi API MỘT LẦN mỗi phiên (sessionStorage), tránh bắn thêm request ở mọi
// lần điều hướng — PageShell mount lại theo từng trang.
import { useEffect, useRef } from 'react';
import { useApi } from '../lib-client/useApi';
import { useToast } from '../lib-client/ToastContext';
import { useTranslation } from '../lib-client/I18nContext';

const SESSION_KEY = 'calorie_family_notices_checked';

export default function FamilyNotices() {
  const { get, post } = useApi();
  const showToast = useToast();
  const { t, tn } = useTranslation();
  // StrictMode ở dev mount 2 lần -> chặn chạy đôi trong cùng một lần mount.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    if (!window.localStorage.getItem('calorie_ai_token')) return;   // chưa đăng nhập
    if (window.sessionStorage.getItem(SESSION_KEY) === '1') return; // đã kiểm tra phiên này
    window.sessionStorage.setItem(SESSION_KEY, '1');

    (async () => {
      try {
        const list = await get('/api/family-menu', { resource: 'notifications' });
        if (!Array.isArray(list) || list.length === 0) return;

        for (const n of list) {
          const who = n.owner_handle ? `@${n.owner_handle}` : t('hh.notice_someone', 'chủ hộ');
          if (n.type === 'removed_from_family') {
            showToast(tn('hh.notice_removed', { who }, `Bạn đã bị xoá ra khỏi gia đình của ${who}.`), 'info');
          } else if (n.type === 'join_approved') {
            showToast(tn('hh.notice_approved', { who }, `Bạn đã được phê duyệt vào gia đình của ${who}.`), 'success');
          }
        }

        // Đánh dấu đã đọc để lần đăng nhập sau không hiện lại.
        await post('/api/family-menu', {
          action: 'mark_notifications_read',
          notification_ids: list.map((n) => n.id),
        });
      } catch {
        // Thông báo là phụ trợ — hỏng thì im lặng bỏ qua, KHÔNG chặn trang.
        // Cho phép thử lại ở phiên sau.
        window.sessionStorage.removeItem(SESSION_KEY);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
