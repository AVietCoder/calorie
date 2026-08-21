'use client';
import { useEffect, useRef, useState } from 'react';
import '../styles/generation-progress.css';

/**
 * GenerationProgress — thanh tiến trình cho các tác vụ chạy lâu (sinh thực đơn,
 * dựng kế hoạch tuần, dựng danh sách đi chợ).
 *
 * Bản web của src/components/GenerationProgress.js bên app — CÙNG đường cong và
 * cùng các mốc đổi lời, để hai nền tảng cho cảm giác chờ giống nhau.
 *
 * NGUYÊN TẮC: không bịa tiến độ để che backend chậm.
 *
 *  • Backend không phát tiến độ thật, nên phần trăm ở đây là ƯỚC LƯỢNG theo
 *    thời gian đã trôi — và điều đó được nói thật bằng cách KHÔNG BAO GIỜ tự
 *    chạy tới 100%. Chỉ khi `done` bật (server đã trả kết quả) mới lên 100%.
 *  • Đường cong bão hoà mũ: nhanh lúc đầu, chậm dần, tiệm cận 96% rồi bò rất
 *    chậm. Thấy chuyển động ngay nên biết máy đang chạy, nhưng không bị lừa là
 *    "sắp xong" khi backend còn đang làm.
 *
 * @param {boolean} running   đang chạy
 * @param {boolean} done      server đã trả kết quả → chạy nốt lên 100%
 * @param {string}  [title]   tiêu đề thay cho tên bước
 * @param {number}  [expectedMs] thời gian kỳ vọng, dùng để định hình đường cong
 */

const STEPS = [
  { at: 0, icon: 'fa-magnifying-glass', label: 'Đang phân tích thông tin' },
  { at: 25, icon: 'fa-utensils', label: 'Đang xây dựng thực đơn' },
  { at: 62, icon: 'fa-heart-pulse', label: 'Đang kiểm tra dinh dưỡng' },
  { at: 86, icon: 'fa-wand-magic-sparkles', label: 'Đang hoàn thiện' },
];

/* Mốc đổi lời trấn an — chờ quá ~10s mà chữ không đổi là người dùng tưởng treo. */
const REASSURE = [
  { after: 10_000, text: 'Vẫn đang xử lý — thực đơn 7 ngày cần một chút thời gian.' },
  { after: 30_000, text: 'Sắp xong rồi, hệ thống đang cân đối dinh dưỡng cả tuần…' },
];
const SLOW_AFTER_MS = 60_000;

/** Trần của phần ước lượng. Không chạm 100% khi chưa có kết quả thật. */
const CAP = 96;

export default function GenerationProgress({ running, done, title, expectedMs = 12_000, t }) {
  const [pct, setPct] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(null);
  const tr = t || ((_k, fb) => fb);

  useEffect(() => {
    if (!running) {
      startedAt.current = null;
      setPct(0);
      setElapsed(0);
      return undefined;
    }
    if (startedAt.current == null) startedAt.current = Date.now();

    const id = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      /* p = CAP × (1 − e^(−t/τ)), τ = expectedMs/2 → tới mốc kỳ vọng đã đi được
         ~86% quãng đường, sau đó mỗi giây thêm được ít dần. Cộng một nhịp bò
         rất chậm để thanh không đứng chết cứng khi backend lâu bất thường. */
      const tau = Math.max(1, expectedMs / 2);
      const base = CAP * (1 - Math.exp(-ms / tau));
      const creep = Math.min(2, (ms / 60_000) * 2);
      setPct(Math.min(CAP + 2, base + creep));
    }, 250);
    return () => clearInterval(id);
  }, [running, expectedMs]);

  if (!running && !done) return null;

  const shown = Math.round(done ? 100 : pct);
  const step = [...STEPS].reverse().find((s) => shown >= s.at) || STEPS[0];
  const reassure = [...REASSURE].reverse().find((r) => elapsed >= r.after);
  const slow = elapsed >= SLOW_AFTER_MS;

  return (
    <div className="gp" role="status" aria-live="polite">
      <div className="gp-head">
        <i className={`fa-solid ${done ? 'fa-circle-check' : step.icon}`} />
        <span className="gp-title">
          {done ? tr('gp.done', 'Đã xong!') : (title || tr(`gp.step_${step.at}`, step.label))}
        </span>
        <b className="gp-pct">{shown}%</b>
      </div>

      <div className="gp-track">
        <span className="gp-fill" style={{ width: `${shown}%` }} />
      </div>

      <ul className="gp-steps">
        {STEPS.map((s) => {
          const passed = done || shown > s.at + 4;
          const active = !done && step.at === s.at;
          return (
            <li key={s.at} className={passed ? 'passed' : active ? 'active' : ''}>
              <i className={`fa-solid ${passed ? 'fa-circle-check' : active ? 'fa-circle' : 'fa-circle-notch'}`} />
              <span>{tr(`gp.step_${s.at}`, s.label)}</span>
            </li>
          );
        })}
      </ul>

      {!done && slow && (
        <p className="gp-slow">
          <i className="fa-solid fa-clock" />{' '}
          {tr('gp.slow', 'Thực đơn đang được xử lý lâu hơn bình thường, bạn chờ thêm chút nhé…')}
        </p>
      )}
      {!done && !slow && !!reassure && <p className="gp-note">{reassure.text}</p>}
    </div>
  );
}
