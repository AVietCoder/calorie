'use client';
// useAction — cơ chế CHỐNG DOUBLE-SUBMIT thống nhất cho toàn app.
//
// Bọc 1 hàm async (handler gọi API) và trả về [run, pending]:
//   - `run(...args)`: gọi handler NHƯNG chặn tái nhập khi request trước chưa xong.
//     Dùng ref `inFlight` (đồng bộ) nên chặn được CẢ double-click cực nhanh xảy ra
//     trong cùng 1 nhịp render — điều mà `disabled` (bất đồng bộ theo state) KHÔNG
//     chặn được. Spam click / giữ Enter / double click → CHỈ 1 request.
//   - `pending`: true trong lúc chạy → dùng để disable nút + hiện spinner.
//
// LUÔN reset trong `finally` → thành công / lỗi / timeout đều nhả nút lại, không treo.
import { useCallback, useRef, useState } from 'react';

export function useAction(fn) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn; // luôn gọi bản handler mới nhất mà không đổi identity của `run`

  const run = useCallback(async (...args) => {
    if (inFlight.current) return undefined; // đang chạy → bỏ qua click thừa
    inFlight.current = true;
    setPending(true);
    try {
      return await fnRef.current?.(...args);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  return [run, pending];
}

export default useAction;
