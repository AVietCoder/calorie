'use client';
/**
 * TemplateCard — một thực đơn trong thư viện.
 *
 * Bìa dùng gradient + icon theo danh mục (menu-categories.js) nên thực đơn nào
 * cũng có bìa ngay, không cần file ảnh. `image_url` do admin tải lên sẽ đè lên.
 */
import { getCategory } from '../../lib/family-menu/menu-categories';
import { sourceLogo } from '../../lib/family-menu/source-logos';

export default function TemplateCard({ item, onOpen, onEdit, t }) {
  const tpl = item.template;
  const cat = getCategory(tpl.category);
  const dayCount = item.dayCount ?? tpl.day_count ?? null;

  /*
   * Bìa thẻ, theo thứ tự ưu tiên:
   *   1. ảnh admin tự tải lên
   *   2. logo ĐƠN VỊ phát hành (thực đơn hệ thống) — để phân biệt nguồn thay vì
   *      thẻ nào cũng một icon danh mục giống hệt nhau
   *   3. icon danh mục
   * Nguồn chưa có logo thì sourceLogo() trả null → rơi xuống (3); gán đại một
   * logo khác là ghi sai đơn vị phát hành.
   */
  const logo = tpl.image_url ? null : sourceLogo(tpl.source_name);

  return (
    // Lớp bọc tồn tại vì nút Sửa KHÔNG được nằm trong <button> của thẻ —
    // button lồng button là HTML sai và Firefox bỏ luôn nút bên trong.
    <div className="ml-card-wrap">
    <button
      type="button"
      className={`ml-card${item.in_use ? ' in-use' : ''}`}
      onClick={() => onOpen(item)}
    >
      <div
        className="ml-cover"
        style={{ '--ml-grad': `linear-gradient(135deg, ${cat.from}, ${cat.to})` }}
      >
        {tpl.image_url && <img src={tpl.image_url} alt="" />}
        {!tpl.image_url && logo && (
          <span className="ml-source-logo">
            <img src={logo} alt={tpl.source_name || ''} loading="lazy" />
          </span>
        )}
        {!tpl.image_url && !logo && <i className={`fa-solid ${cat.icon}`} aria-hidden="true" />}

        {item.in_use && (
          <span className="ml-badge">
            <i className="fa-solid fa-circle-check" /> {t('ml.in_use', 'Đang sử dụng')}
          </span>
        )}
        {tpl.is_system && !item.in_use && (
          <span className="ml-badge ml-badge-sys" title={t('ml.system_hint', 'Thực đơn mẫu của hệ thống')}>
            <i className="fa-solid fa-shield-halved" /> {t('ml.system', 'Hệ thống')}
          </span>
        )}
        <span className="ml-cat">{cat.label}</span>
      </div>

      <div className="ml-body">
        <h4>{tpl.title}</h4>
        {tpl.description && <p className="ml-desc">{tpl.description}</p>}
        <div className="ml-meta">
          {dayCount != null && <span><b>{dayCount}</b> {t('ml.days', 'ngày')}</span>}
          {/* Điểm 0 nghĩa là "không có nhãn nào trùng hồ sơ" — đúng với hầu hết
              thẻ, nên hiện ra chỉ làm nhiễu và trông như thực đơn kém. */}
          {item.score > 0 && <span>{t('ml.score', 'Độ phù hợp')}: <b>{item.score}</b></span>}
        </div>
      </div>
    </button>

    {item.can_edit && onEdit && (
      <button
        type="button"
        className="ml-card-edit"
        title={t('ml.edit', 'Sửa')}
        aria-label={`${t('ml.edit', 'Sửa')}: ${tpl.title}`}
        onClick={() => onEdit(item)}
      >
        <i className="fa-solid fa-pen" />
      </button>
    )}
    </div>
  );
}
