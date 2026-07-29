'use client';
/**
 * /settings — Cài đặt tài khoản.
 *
 * Hiện chỉ chứa Vùng nguy hiểm (xoá tài khoản), nhưng là trang riêng chứ không
 * nhét vào /setup: /setup là trình hướng dẫn nhiều bước để KHAI BÁO hồ sơ, đặt
 * nút xoá vĩnh viễn ở cuối một luồng "Tiếp theo → Tiếp theo" là cách chắc chắn
 * nhất để ai đó bấm nhầm.
 *
 * Đường dẫn khớp với hướng dẫn công khai ở /delete-account và trong app mobile:
 * Hồ sơ → Cài đặt → Xoá tài khoản.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageShell from '../../components/PageShell';
import DeleteAccountDialog from '../../components/DeleteAccountDialog';
import { useAuth } from '../../lib-client/AuthContext';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/modal.css';
import '../../styles/settings.css';

export default function SettingsPage() {
  const [open, setOpen] = useState(false);
  const { isAuthenticated, ready } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();

  useEffect(() => {
    if (ready && !isAuthenticated) router.replace('/signin');
  }, [ready, isAuthenticated, router]);

  return (
    <PageShell>
      <div className="schedule-hero">
        <div className="schedule-hero-text">
          <div className="schedule-hero-icon"><i className="fa-solid fa-gear" /></div>
          <div>
            <h1>{t('set.title', 'Cài đặt')}</h1>
            <p>{t('set.subtitle', 'Quản lý tài khoản và dữ liệu cá nhân của bạn')}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h3><i className="fa-solid fa-user" /> {t('set.account', 'Tài khoản')}</h3>
        <p className="set-row-desc">
          {t('set.profile_desc', 'Cập nhật chỉ số cơ thể, mục tiêu và thói quen ăn uống.')}
        </p>
        <Link href="/setup" className="btn btn-secondary">
          <i className="fa-solid fa-pen" /> {t('set.edit_profile', 'Chỉnh sửa hồ sơ')}
        </Link>
      </div>

      {/* Vùng nguy hiểm — tách hẳn khỏi cài đặt thường bằng khung đỏ riêng. */}
      <div className="set-danger">
        <div className="set-danger-head">
          <i className="fa-solid fa-triangle-exclamation" />
          <h3>{t('set.danger', 'Vùng nguy hiểm')}</h3>
        </div>

        <div className="set-danger-body">
          <div>
            <b>{t('set.delete_title', 'Xoá tài khoản')}</b>
            <p>
              {t('set.delete_desc', 'Xoá vĩnh viễn tài khoản và toàn bộ dữ liệu của bạn. Hành động này không thể hoàn tác.')}
            </p>
          </div>
          <button type="button" className="btn-danger-solid" onClick={() => setOpen(true)}>
            <i className="fa-solid fa-trash-can" /> {t('set.delete_btn', 'Xoá tài khoản')}
          </button>
        </div>

        <p className="set-danger-foot">
          {t('set.delete_more', 'Tìm hiểu thêm về việc xoá tài khoản và dữ liệu tại')}{' '}
          <Link href="/delete-account">{t('set.delete_link', 'trang hướng dẫn xoá tài khoản')}</Link>.
        </p>
      </div>

      <DeleteAccountDialog open={open} onClose={() => setOpen(false)} t={t} />
    </PageShell>
  );
}
