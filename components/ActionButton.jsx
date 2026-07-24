'use client';
// ActionButton — nút drop-in thay cho <button> ở MỌI thao tác gọi API.
// Tự chống double-click (in-flight guard qua useAction), tự disable + hiện spinner
// trong lúc chạy, tự nhả lại khi xong/lỗi. Không cần quản lý state loading thủ công.
//
//   <ActionButton className="btn btn-primary" loadingText="Đang tạo..." onClick={create}>
//     <i className="fa-solid fa-plus" /> Tạo thực đơn
//   </ActionButton>
//
// - onClick có thể async (được await). Trả về gì tuỳ handler.
// - `disabled` ngoài (vd form chưa hợp lệ) vẫn được tôn trọng.
// - `loadingText` (tuỳ chọn): text hiện khi đang chạy; không có thì giữ children.
import { useAction } from '../lib-client/useAction';

export default function ActionButton({
  onClick,
  children,
  loadingText,
  disabled = false,
  className = '',
  type = 'button',
  ...rest
}) {
  const [run, pending] = useAction(onClick || (() => {}));

  return (
    <button
      {...rest}
      type={type}
      className={`${className}${pending ? ' is-loading' : ''}`.trim()}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onClick={(e) => { if (!disabled) run(e); }}
    >
      {pending ? (
        <>
          <span className="btn-spinner" aria-hidden="true" />
          {loadingText ? <span>{loadingText}</span> : children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
