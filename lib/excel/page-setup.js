/**
 * lib/excel/page-setup.js — thiết lập in.
 *
 * ĐÂY LÀ CHỖ BẢN SINH TỐT HƠN FILE MẪU.
 *
 * Kiểm tra 43 file mẫu cho thấy: KHÔNG file nào set print area, fit-to-width,
 * khổ giấy, freeze pane hay header/footer (chỉ đúng 1 file có orientation).
 * Nghĩa là in trực tiếp sẽ tràn sang 3–4 trang và mất dòng tiêu đề.
 *
 * Ta giữ nguyên phần nhìn của mẫu nhưng bổ sung cấu hình in A4 chuẩn:
 *   • khổ A4, canh ngang khi bảng rộng
 *   • fit 1 trang theo chiều ngang, tự tràn theo chiều dọc
 *   • lặp lại hàng tiêu đề ở mọi trang
 *   • footer "Trang x / y" + ngày xuất
 */

const A4 = 9; // ExcelJS paperSize code cho A4

export function applyPageSetup(ws, opts = {}) {
  const {
    sheetWidth = 5,
    orientation,
    repeatRows,        // ví dụ '5:5'
    printArea,
    footerLeft,
    fitToWidth = 1,
    fitToHeight = 0,   // 0 = không giới hạn số trang dọc
    margins,
  } = opts;

  ws.pageSetup = {
    paperSize: A4,
    orientation: orientation || (sheetWidth >= 6 ? 'landscape' : 'portrait'),
    fitToPage: true,
    fitToWidth,
    fitToHeight,
    horizontalCentered: true,
    verticalCentered: false,
    margins: {
      left: 0.4,
      right: 0.4,
      top: 0.5,
      bottom: 0.5,
      header: 0.25,
      footer: 0.25,
      ...(margins || {}),
    },
    ...(printArea ? { printArea } : {}),
  };

  if (repeatRows) ws.pageSetup.printTitlesRow = repeatRows;

  // &L trái, &C giữa, &R phải; &P trang hiện tại, &N tổng số trang, &9 cỡ chữ 9.
  // Lưu ý: sau &9 KHÔNG được là chữ số, nếu không Excel đọc "&927" thành cỡ 927
  // — vì vậy phần ngày luôn có tiền tố chữ.
  const footer = `&L&9${escapeHF(footerLeft || 'Calorie AI')}&C&9Trang &P / &N&R&9Xuất ngày ${formatDate(new Date())}`;
  ws.headerFooter = { oddFooter: footer, evenFooter: footer };

  return ws;
}

/** '&' là ký tự điều khiển trong header/footer của Excel — phải nhân đôi. */
function escapeHF(s) {
  return String(s).replace(/&/g, '&&');
}

function formatDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export default { applyPageSetup };
