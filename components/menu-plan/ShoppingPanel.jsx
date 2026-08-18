'use client';
/**
 * ShoppingPanel — danh sách đi chợ + gợi ý nơi mua.
 *
 * Toàn bộ số liệu lấy nguyên từ model do lib/family-menu/shopping.js dựng
 * (qua API), KHÔNG tính lại gì ở đây — cùng nguồn với file Excel xuất ra.
 */
import { useState } from 'react';
import ActionButton from '../ActionButton';
import { openNearbySearch, SHOP_KINDS } from '../../lib-client/nearby';
import { useChecklist } from '../../lib-client/useChecklist';

const money = (v) => (v == null || !Number.isFinite(Number(v)) ? '-' : Math.round(v).toLocaleString('vi-VN'));
const qty = (v) => (v == null || !Number.isFinite(Number(v)) ? '' : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 2 }));

/**
 * @param {boolean} [checkable]  thêm cột tick "đã mua" (lưu ở trình duyệt)
 * @param {string}  [scope]      khoá lưu tick — id kế hoạch hoặc id thực đơn
 */
export default function ShoppingPanel({ items, groups, totals, text, error, loading, checkable, scope, t }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { has, toggle } = useChecklist(scope);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* trình duyệt chặn clipboard — người dùng tự bôi đen copy */ }
  }

  if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  /* Dựng danh sách đi chợ phải gộp nguyên liệu + tra bảng giá nên mất vài giây.
     Một dòng chữ "Đang tải..." trơ khiến người dùng tưởng trang hỏng — khung
     xương + vòng xoay cho thấy hệ thống đang chạy và sắp ra cái gì. */
  if (loading) {
    return (
      <div className="mp-shop-loading" role="status" aria-live="polite">
        <div className="mp-shop-loading-head">
          <span className="mp-spinner" aria-hidden="true" />
          <span>{t('mp.shop_loading', 'Đang dựng danh sách đi chợ…')}</span>
        </div>
        <div className="mp-skeleton-list" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <div className="mp-skeleton-row" key={i}>
              <span className="mp-skeleton-bar" style={{ width: `${58 + ((i * 13) % 32)}%` }} />
              <span className="mp-skeleton-bar sm" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!items?.length) {
    return (
      <p className="mp-empty">
        {t('mp.no_ingredients', 'Chưa có nguyên liệu. Thực đơn hiện tại chưa khai báo nguyên liệu cho các món.')}
      </p>
    );
  }

  const shown = groups?.length ? groups : [{ key: 'all', label: '', items }];

  /*
   * Xem trước thực đơn trong thư viện thường CHƯA có giá nào — khi đó hai cột
   * "Đơn giá"/"Thành tiền" chỉ toàn dấu "-" trải dài, vừa chiếm chỗ vừa làm
   * bảng trông như bị hỏng. Chỉ giấu khi TOÀN BỘ danh sách không có giá; còn
   * một mục có giá thì vẫn giữ cột để không mất thông tin.
   *
   * KHÔNG xét manual_price: nó đã chuyển xuống dòng phụ dưới tên nguyên liệu,
   * nên nếu chỉ có mình nó thì hai cột tiền vẫn rỗng và không đáng dựng.
   */
  const hasAnyPrice = items.some((i) => i.unit_price != null || i.line_total != null);

  return (
    <>
      {totals && (
        <div className="mp-shop-summary">
          <span><b>{totals.itemCount}</b> {t('mp.items', 'nguyên liệu')}</span>
          <span><b>≈ {money(totals.estimatedCost)} đ</b> {t('mp.est_cost', 'ước tính')}</span>
          {totals.estimateCount > 0 && (
            <span className="warn">
              <i className="fa-solid fa-circle-info" /> {totals.estimateCount} {t('mp.need_estimate_n', 'mục cần tự ước lượng')}
            </span>
          )}
          {totals.missingPriceCount > 0 && (
            <span>{totals.missingPriceCount} {t('mp.no_price', 'mục chưa có giá')}</span>
          )}
        </div>
      )}

      {/* Giá là ƯỚC TÍNH và phụ thuộc nơi mua — phải nói rõ ngay cạnh con số,
          không để người dùng hiểu đây là giá cố định. */}
      {totals && (
        <p className="mp-price-note">
          <i className="fa-solid fa-circle-info" />
          <span>{t('mp.price_note', 'Giá là ước tính cho một người và thay đổi theo nơi bạn mua nguyên liệu (siêu thị, chợ, cửa hàng tiện lợi). Hãy xem đây là mức tham khảo.')}</span>
        </p>
      )}

      {/* Chuỗi này để CHÉP đi (nhắn Zalo, ghi ra giấy) chứ không phải để đọc:
          53 nguyên liệu nối bằng dấu "/" thành một khối chữ dài choán hết thẻ,
          đẩy bảng thật xuống dưới màn hình. Mặc định thu gọn, nút Chép vẫn luôn
          hiện vì đó mới là việc người dùng cần ở đây. */}
      {text && (
        <div className={`mp-shop-text${expanded ? ' is-open' : ''}`}>
          <p>{text}</p>
          <div className="mp-shop-text-actions">
            <button type="button" className="btn btn-secondary" onClick={copyText}>
              <i className={`fa-regular ${copied ? 'fa-circle-check' : 'fa-copy'}`} />{' '}
              {copied ? t('mp.copied', 'Đã chép') : t('mp.copy', 'Chép')}
            </button>
            <button type="button" className="mp-shop-text-toggle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? t('mp.collapse', 'Thu gọn') : t('mp.expand', 'Xem đầy đủ')}
            </button>
          </div>
        </div>
      )}

      {shown.map((g) => (
        <div className="mp-shop-group" key={g.key}>
          {g.label && <h4>{g.label}</h4>}
          <table className="mp-shop-table">
            {/* Mỗi nhóm là một <table> riêng. Không khai chiều rộng thì mỗi bảng
                tự co theo nội dung của chính nó, nên "Rau & củ" và "Thịt" ra hai
                bộ vị trí cột khác nhau — đó là chỗ nhìn lệch. colgroup + fixed
                layout ép mọi nhóm dùng chung một khung cột. */}
            <colgroup>
              {checkable && <col className="c-tick" />}
              <col />
              <col className="c-qty" />
              {hasAnyPrice && <col className="c-price" />}
              {hasAnyPrice && <col className="c-total" />}
            </colgroup>
            <thead>
              <tr>
                {checkable && <th className="mp-shop-tick" aria-label={t('mp.bought', 'Đã mua')} />}
                <th>{t('mp.ingredient', 'Nguyên liệu')}</th>
                <th>{t('mp.qty', 'Số lượng')}</th>
                {hasAnyPrice && <th>{t('mp.unit_price', 'Đơn giá')}</th>}
                {hasAnyPrice && <th>{t('mp.line_total', 'Thành tiền')}</th>}
              </tr>
            </thead>
            <tbody>
              {g.items.map((it) => {
                const id = it.ingredient_id || it.name;
                const on = checkable && has(`week:${id}`);
                return (
                <tr key={id} className={on ? 'is-bought' : undefined}>
                  {checkable && (
                    <td className="mp-shop-tick">
                      <input
                        type="checkbox"
                        checked={!!on}
                        onChange={() => toggle(`week:${id}`)}
                        aria-label={`${t('mp.bought', 'Đã mua')}: ${it.name}`}
                      />
                    </td>
                  )}
                  <td>
                    {it.name}
                    {it.aliases?.length > 0 && (
                      <span className="mp-shop-alias">{t('mp.merged_from', 'Gộp từ')}: {it.aliases.join(', ')}</span>
                    )}
                    {/* Giá khai trong Excel: NGUYÊN VĂN, có thể là một khoảng
                        ("12.000đ -> 15.000đ") và không nói rõ tính trên đơn vị
                        nào. Nó KHÔNG sinh ra Thành tiền, nên phải nằm ngoài hai
                        cột tiền — để trong cột "Đơn giá" là mời người đọc nhân
                        nó với Số lượng rồi thấy lệch. */}
                    {it.manual_price && (
                      <span className="mp-shop-alias">
                        {t('mp.price_in_file', 'Giá ghi trong file')}: {it.manual_price}
                      </span>
                    )}
                  </td>
                  <td>
                    {it.qty == null
                      ? <span className="mp-est-chip">{t('mp.need_estimate', 'cần ước lượng')}</span>
                      : `${qty(it.qty)} ${it.unit || ''}`}
                  </td>
                  {/* Đơn giá × Số lượng = Thành tiền. Cả hai cột cùng lấy từ
                      bảng giá tự động nên phép nhân này luôn khớp; kèm đơn vị
                      vì "18đ" trơ trọi không nói lên là trên mỗi gram. */}
                  {hasAnyPrice && (
                    <td>
                      {it.unit_price == null
                        ? '-'
                        : <>{money(it.unit_price)}<span className="mp-shop-per">/{it.unit || 'g'}</span></>}
                    </td>
                  )}
                  {hasAnyPrice && <td>{money(it.line_total)}</td>}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Gợi ý nơi mua — chỉ deep link Google Maps quanh vị trí hiện tại,
          không API key, không AI đoán địa điểm. */}
      <div className="mp-nearby">
        <h4><i className="fa-solid fa-location-dot" /> {t('mp.where_title', 'Mua ở đâu gần bạn?')}</h4>
        <p>{t('mp.where_desc', 'Mở Google Maps quanh vị trí hiện tại của bạn.')}</p>
        <div className="mp-nearby-actions">
          {/* ActionButton: lấy toạ độ mất vài giây (và lần đầu còn phải hỏi
              quyền), không có spinner thì bấm xong tưởng nút hỏng. */}
          {SHOP_KINDS.map((k) => (
            <ActionButton
              className="mp-nearby-btn"
              key={k.key}
              loadingText={t('mp.opening_maps', 'Đang mở bản đồ…')}
              onClick={() => openNearbySearch(`${k.query} gần đây`)}
            >
              <i className={`fa-solid ${k.icon}`} /> {t(k.tkey, k.label)}
            </ActionButton>
          ))}
        </div>
      </div>
    </>
  );
}
