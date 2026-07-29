/**
 * lib/excel/templates/shopping-list.js — SHEET 3: DANH SÁCH ĐI CHỢ.
 *
 * Cấu trúc cột theo yêu cầu:
 *   ☐ | Nguyên liệu | Đơn vị | Số lượng | Đơn giá | Thành tiền | Có thể thay bằng
 *
 * Mỗi NHÓM nguyên liệu (Rau / Thịt / Hải sản / …) là một `section` riêng, có
 * dòng tổng phụ của nhóm. Cuối sheet là TỔNG CHI PHÍ DỰ KIẾN.
 *
 * Nguyên liệu chưa có giá in "-" (không chặn export, không báo lỗi).
 * Nguyên liệu bị làm tròn lên có ghi chú "cần 2,2 – mua 3" trong cell note.
 */
import { formatMoney } from '../../family-menu/pricing.js';
import { formatQty } from '../../family-menu/units.js';

const MONEY_FMT = '#,##0';

export function shoppingListSheet(model) {
  const { shopping, servings, household } = model;
  const { groups, totals } = shopping;

  const columns = [
    { header: '✓', role: 'checkbox', width: 5 },
    { header: 'Nguyên liệu', role: 'text', width: 30 },
    { header: 'Đơn vị', role: 'label', width: 12 },
    { header: 'Số lượng', role: 'numeric', numFmt: '#,##0.##' },
    { header: 'Đơn giá (đ)', role: 'numeric', numFmt: MONEY_FMT },
    { header: 'Thành tiền (đ)', role: 'numeric', numFmt: MONEY_FMT },
    { header: 'Có thể thay bằng', role: 'text', width: 30 },
  ];

  const sections = groups.map((g) => ({
    type: 'section',
    title: `${g.label.toUpperCase()}  (${g.items.length} mục)`,
    span: columns.length,
    columns,
    rows: g.items.map(toRow),
    options: {
      uniformHeight: true,
      heightRange: { min: 22, max: 60 },
      totalRow: ['', `Tạm tính ${g.label}`, '', '', '', g.priced ? g.subtotal : '-', ''],
    },
  }));

  const blocks = [
    { type: 'title', text: 'DANH SÁCH NGUYÊN LIỆU CẦN MUA' },
    {
      type: 'meta',
      pairs: [
        ['Số suất', `${servings} suất/bữa`],
        ['Số mục', String(totals.itemCount)],
        ['Khu vực giá', household?.region || 'Mặc định'],
        ['Ngày xuất', formatDate(model.generatedAt)],
      ],
      perRow: Math.max(1, Math.floor(columns.length / 2)),
    },
    { type: 'spacer' },
    // Rỗng thì nói rõ VÌ SAO, thay vì để người dùng nhìn một sheet trắng.
    ...(sections.length
      ? interleaveSpacers(sections)
      : [{
        type: 'note',
        text: 'Chưa có nguyên liệu nào. Các món trong thực đơn chưa khai báo nguyên liệu, '
          + 'nên không thể dựng danh sách đi chợ. Hãy nhập lại file thực đơn có cột nguyên liệu, '
          + 'hoặc bổ sung nguyên liệu cho từng món trong Thư viện thực đơn.',
      }]),
    { type: 'spacer' },
    buildGrandTotal(totals, columns.length),
    { type: 'spacer' },
    { type: 'note', text: buildNote(totals) },
  ].filter(Boolean);

  return {
    name: 'ĐI CHỢ',
    width: columns.length,
    blocks,
    print: { orientation: 'portrait', footerLeft: 'Danh sách đi chợ' },
  };
}

/* ───────────────────────── row mapping ───────────────────────── */

function toRow(it) {
  // Thực đơn nguồn không khai định lượng → để CHỮ, tuyệt đối không in "0".
  const qtyCell = it.qty == null
    ? {
      value: 'cần ước lượng',
      style: 'body',
      note: `Thực đơn nguồn chưa khai định lượng cho "${it.name}". Hãy tự ước theo số người ăn.`,
    }
    : {
      value: it.qty,
      style: 'numeric',
      numFmt: '#,##0.##',
      note: it.rounded
        ? `Cần chính xác ${formatQty(it.exact_qty)} ${it.exact_unit} — làm tròn lên ${formatQty(it.qty)} ${it.unit} cho vừa cách bán.`
        : undefined,
    };

  const nameCell = {
    value: it.name,
    style: 'body',
    note: buildNameNote(it),
  };

  return [
    '', // ô tick — để trống, có border cho người dùng đánh dấu tay hoặc in ra tích
    nameCell,
    it.unit || '',
    qtyCell,
    it.unit_price == null ? { value: '-', style: 'numeric' } : it.unit_price,
    it.line_total == null ? { value: '-', style: 'numeric' } : it.line_total,
    it.substitutes?.length ? it.substitutes.join(', ') : '',
  ];
}

function buildNameNote(it) {
  const bits = [];
  if (it.aliases?.length) bits.push(`Gộp từ: ${it.aliases.join(', ')}`);
  if (it.unmergeable?.length) {
    bits.push(`Còn ${it.unmergeable.map((u) => `${formatQty(u.qty)} ${u.unit}`).join(' + ')} ghi ở đơn vị khác — kiểm tra lại.`);
  }
  if (!it.resolved) bits.push('Chưa có trong từ điển nguyên liệu — không tra được giá.');
  if (it.price_source === 'reference') bits.push('Giá tham khảo, chưa được Admin cấu hình.');
  return bits.length ? bits.join('\n') : undefined;
}

/** Dòng TỔNG CHI PHÍ nổi bật, merge ngang phần nhãn. */
function buildGrandTotal(totals, width) {
  return {
    type: 'table',
    columns: [
      { header: '', role: 'label', width: 5 },
      { header: '', role: 'text', width: 30 },
      { header: '', role: 'label', width: 12 },
      { header: '', role: 'numeric' },
      { header: '', role: 'numeric' },
      { header: '', role: 'numeric', numFmt: MONEY_FMT },
      { header: '', role: 'text', width: 30 },
    ].slice(0, width),
    rows: [],
    options: {
      totalRow: [
        '',
        totals.complete ? 'TỔNG CHI PHÍ DỰ KIẾN' : 'TỔNG CHI PHÍ DỰ KIẾN (chưa đủ giá)',
        '',
        '',
        '',
        totals.estimatedCost || '-',
        totals.complete ? '' : `Thiếu giá ${totals.missingPriceCount} mục`,
      ].slice(0, width),
    },
  };
}

function buildNote(totals) {
  const lines = [
    'Cách dùng: in ra và tích vào cột ✓ khi đã mua. Số lượng đã được làm tròn lên theo cách bán ' +
      'thực tế ngoài chợ (ví dụ 2,2 bó → 3 bó); di chuột vào ô Số lượng để xem lượng cần chính xác.',
  ];
  if (totals.estimateCount > 0) {
    lines.push(
      `${totals.estimateCount}/${totals.itemCount} mục ghi "cần ước lượng" vì thực đơn nguồn không khai định lượng. ` +
        'Những mục này KHÔNG được tính vào tổng chi phí — hãy tự ước theo số người ăn.'
    );
  }
  if (totals.missingPriceCount > 0) {
    lines.push(
      `${totals.missingPriceCount}/${totals.itemCount} nguyên liệu chưa có đơn giá nên hiển thị "-". ` +
        'Admin có thể bổ sung giá trong mục quản trị; khi đó tổng chi phí sẽ tự cập nhật.'
    );
  }
  lines.push(
    'Đơn giá là giá THAM KHẢO để ước tính ngân sách, không phải giá niêm yết. ' +
      'Cột "Có thể thay bằng" gợi ý nguyên liệu tương đương khi chợ hết hàng.'
  );
  return `Lưu ý: ${lines.join('\n• ')}`;
}

function interleaveSpacers(sections) {
  const out = [];
  sections.forEach((s, i) => {
    if (i > 0) out.push({ type: 'spacer' });
    out.push(s);
  });
  return out;
}

function formatDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  const dt = d instanceof Date ? d : new Date(d);
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

export { formatMoney };
export default shoppingListSheet;
