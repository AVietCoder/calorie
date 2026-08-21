'use client';
import GenerationProgress from './GenerationProgress';
import '../styles/generation-progress.css';

/**
 * PageLoading — màn chờ phủ toàn trang.
 *
 * Thay cho khối `loading-overlay` + ba chấm nhấp nháy vốn lặp lại y hệt ở 5
 * trang. Ba chấm không cho biết gì ngoài "đang bận": không biết đã chạy bao lâu,
 * không biết còn lâu không, và khi mạng chậm thì trông y như treo.
 *
 * Dùng lại đúng thanh tiến trình của bên app để hai nền tảng giống nhau, nhưng
 * TẮT danh sách bước — bốn bước kia là của luồng sinh thực đơn, hiện ra lúc mở
 * trang Hồ sơ là nói sai việc hệ thống đang làm.
 *
 * @param {string} [label]      dòng chữ mô tả việc đang chạy
 * @param {number} [expectedMs] thời gian kỳ vọng, định hình đường cong
 */
export default function PageLoading({ label, expectedMs = 4000, t }) {
  const tr = t || ((_k, fb) => fb);
  return (
    <div className="loading-overlay" style={{ position: 'fixed' }}>
      <div className="page-loading-box">
        <GenerationProgress
          running
          done={false}
          showSteps={false}
          expectedMs={expectedMs}
          title={label || tr('common.loading', 'Đang tải…')}
          t={t}
        />
      </div>
    </div>
  );
}
