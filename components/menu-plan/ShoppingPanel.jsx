'use client';
/**
 * ShoppingPanel — danh sách đi chợ + gợi ý nơi mua.
 *
 * Toàn bộ số liệu lấy nguyên từ model do lib/family-menu/shopping.js dựng
 * (qua API), KHÔNG tính lại gì ở đây — cùng nguồn với file Excel xuất ra.
 */
import { useState } from 'react';
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
  const { has, toggle } = useChecklist(scope);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* trình duyệt chặn clipboard — người dùng tự bôi đen copy */ }
  }

  if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  if (loading) return <p className="mp-empty">{t('common.loading', 'Đang tải...')}</p>;
  if (!items?.length) {
    return (
      <p className="mp-empty">
        {t('mp.no_ingredients', 'Chưa có nguyên liệu. Thực đơn hiện tại chưa khai báo nguyên liệu cho các món.')}
      </p>
    );
  }

  const shown = groups?.length ? groups : [{ key: 'all', label: '', items }];

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

      {text && (
        <div className="mp-shop-text">
          <p>{text}</p>
          <button type="button" className="btn btn-secondary" onClick={copyText}>
            <i className={`fa-regular ${copied ? 'fa-circle-check' : 'fa-copy'}`} />{' '}
            {copied ? t('mp.copied', 'Đã chép') : t('mp.copy', 'Chép')}
          </button>
        </div>
      )}

      {shown.map((g) => (
        <div className="mp-shop-group" key={g.key}>
          {g.label && <h4>{g.label}</h4>}
          <table className="mp-shop-table">
            <thead>
              <tr>
                {checkable && <th className="mp-shop-tick" aria-label={t('mp.bought', 'Đã mua')} />}
                <th>{t('mp.ingredient', 'Nguyên liệu')}</th>
                <th>{t('mp.qty', 'Số lượng')}</th>
                <th>{t('mp.unit_price', 'Đơn giá')}</th>
                <th>{t('mp.line_total', 'Thành tiền')}</th>
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
                  </td>
                  <td>
                    {it.qty == null
                      ? <span className="mp-est-chip">{t('mp.need_estimate', 'cần ước lượng')}</span>
                      : `${qty(it.qty)} ${it.unit || ''}`}
                  </td>
                  <td>{money(it.unit_price)}</td>
                  <td>{money(it.line_total)}</td>
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
          {SHOP_KINDS.map((k) => (
            <button
              type="button"
              className="mp-nearby-btn"
              key={k.key}
              onClick={() => openNearbySearch(`${k.query} gần đây`)}
            >
              <i className={`fa-solid ${k.icon}`} /> {t(k.tkey, k.label)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
