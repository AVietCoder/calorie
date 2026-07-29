'use client';
/**
 * ActiveMenuBanner — "gia đình bạn đang dùng thực đơn nào".
 *
 * Chưa có thì hiện một thực đơn GIẢ đã làm mờ kèm lời mời bắt đầu: màn hình
 * trống không nói được cho người dùng biết thứ họ sắp có trông ra sao. Bản mờ
 * chỉ là hình minh hoạ, có `aria-hidden` để trình đọc màn hình không đọc nhầm
 * thành dữ liệu thật.
 */
import { getCategory } from '../../lib/family-menu/menu-categories';

/** Khung xương minh hoạ — cố ý là chữ chung chung, không phải món bịa. */
const BLUR_DAYS = [
  { day: 'Thứ 2', meals: ['Bữa sáng', 'Bữa trưa', 'Bữa tối'] },
  { day: 'Thứ 3', meals: ['Bữa sáng', 'Bữa trưa', 'Bữa tối'] },
  { day: 'Thứ 4', meals: ['Bữa sáng', 'Bữa trưa', 'Bữa tối'] },
];

export default function ActiveMenuBanner({ active, onOpen, onUpload, onManual, t }) {
  if (active) {
    const tpl = active.template;
    const cat = getCategory(tpl.category);
    return (
      <section className="ml-active">
        <div
          className="ml-active-cover"
          style={{ '--ml-grad': `linear-gradient(135deg, ${cat.from}, ${cat.to})` }}
        >
          {tpl.image_url
            ? <img src={tpl.image_url} alt="" />
            : <i className={`fa-solid ${cat.icon}`} aria-hidden="true" />}
        </div>

        <div className="ml-active-body">
          <span className="ml-active-tag">
            <i className="fa-solid fa-circle-check" /> {t('ml.active_now', 'Gia đình bạn đang dùng')}
          </span>
          <h3>{tpl.title}</h3>
          {tpl.description && <p>{tpl.description}</p>}
          <div className="ml-active-meta">
            <span>{cat.label}</span>
            {(active.dayCount ?? tpl.day_count) != null && (
              <span>{active.dayCount ?? tpl.day_count} {t('ml.days', 'ngày')}</span>
            )}
          </div>
        </div>

        <div className="ml-active-actions">
          <button type="button" className="btn btn-primary" onClick={() => onOpen(active)}>
            <i className="fa-solid fa-arrow-right" /> {t('ml.active_open', 'Xem thực đơn')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="ml-start">
      <div className="ml-start-preview" aria-hidden="true">
        {BLUR_DAYS.map((d) => (
          <div className="ml-start-day" key={d.day}>
            <b>{d.day}</b>
            {d.meals.map((m) => (
              <div className="ml-start-meal" key={m}>
                <span>{m}</span>
                <i /><i />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="ml-start-overlay">
        <div className="ml-start-icon"><i className="fa-solid fa-utensils" /></div>
        <h3>{t('ml.start_title', 'Bắt đầu tạo thực đơn phù hợp')}</h3>
        <p>
          {t('ml.start_sub', 'Gia đình bạn chưa có thực đơn nào. Chọn một thực đơn có sẵn bên dưới, hoặc tự thêm thực đơn riêng theo một trong hai cách:')}
        </p>
        <div className="ml-start-actions">
          <button type="button" className="btn btn-primary" onClick={onUpload}>
            <i className="fa-solid fa-file-excel" /> {t('ml.start_excel', 'Tải lên file Excel')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onManual}>
            <i className="fa-solid fa-keyboard" /> {t('ml.start_manual', 'Tự nhập thực đơn')}
          </button>
        </div>
      </div>
    </section>
  );
}
