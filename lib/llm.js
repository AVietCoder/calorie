/**
 * lib/llm.js — một client LLM duy nhất cho cả dự án, chọn nhà cung cấp bằng env.
 *
 *   LLM_PROVIDER=openai   (MẶC ĐỊNH) → api.openai.com
 *   LLM_PROVIDER=vllm                → server vLLM tự dựng
 *
 * Đổi một biến môi trường là quay về vLLM được, không phải sửa code hay deploy lại.
 *
 * ENV THEO TỪNG NHÀ CUNG CẤP — CỐ Ý KHÔNG DÙNG CHUNG:
 *
 *   openai:  OPENAI_API_KEY       (bắt buộc)
 *            OPENAI_MODEL         mặc định "gpt-4.1-mini"
 *            OPENAI_VISION_MODEL  mặc định = OPENAI_MODEL
 *            OPENAI_BASE_URL      chỉ đặt khi đi qua proxy/gateway
 *
 *   vllm:    LLM_BASE_URL         địa chỉ server (bắt buộc)
 *            LLM_API_KEY          chuỗi bất kỳ; "EMPTY" nếu vLLM chạy không --api-key
 *            LLM_MODEL            đúng tên đã khai ở --served-model-name
 *            LLM_VISION_MODEL     mặc định = LLM_MODEL
 *
 * VÌ SAO TÊN MODEL KHÔNG DÙNG CHUNG MỘT BIẾN: `.env.local` đang có
 * LLM_MODEL=qwen2.5-vl. Nếu nhánh openai cũng đọc biến đó thì mọi lời gọi sẽ
 * xin model "qwen2.5-vl" từ api.openai.com và ăn 404 hàng loạt — đúng kiểu lỗi
 * đã xảy ra một lần với GEMINI_MODEL trỏ vào model Google đã gỡ, và im lặng cho
 * tới khi có người đọc log. Tách biến ra thì cấu hình của nhà cung cấp này
 * không thể lặng lẽ rò sang nhà cung cấp kia.
 *
 * Ghi chú: dự án KHÔNG dùng endpoint embeddings ở đâu cả. Knowledge Base tra
 * bằng PostgreSQL Full Text Search (tsvector + GIN + ts_rank) — xem
 * migrations/fulltext_search.sql / lib/knowledge.js.
 */
import OpenAI from "openai";

export const LLM_PROVIDER = String(process.env.LLM_PROVIDER || "openai").toLowerCase();
export const IS_VLLM = LLM_PROVIDER === "vllm";
export const IS_OPENAI = !IS_VLLM;

const BASE_URL = IS_VLLM
  ? (process.env.LLM_BASE_URL || "http://localhost:8000/v1")
  : (process.env.OPENAI_BASE_URL || undefined);   // undefined = mặc định của SDK

const API_KEY = IS_VLLM
  // vLLM đòi một chuỗi khác rỗng kể cả khi không bật xác thực.
  ? (process.env.LLM_API_KEY || "EMPTY")
  : (process.env.OPENAI_API_KEY || "");

if (IS_OPENAI && !API_KEY) {
  // Báo ngay lúc nạp module thay vì để từng route ngã với "401 Unauthorized"
  // rải rác — thiếu khoá là lỗi cấu hình, không phải lỗi lúc chạy.
  console.error("[llm] LLM_PROVIDER=openai nhưng THIẾU OPENAI_API_KEY — mọi lời gọi sẽ lỗi 401.");
}

/** Model cho các luồng CHỮ (chat, coach tạo thực đơn, RAG, đọc Excel…). */
export const LLM_MODEL = IS_VLLM
  ? (process.env.LLM_MODEL || "qwen2.5-vl")
  : (process.env.OPENAI_MODEL || "gpt-4.1-mini");

/** Model cho luồng ẢNH. Mặc định dùng chung model chữ (cả hai bên đều đa phương thức). */
export const LLM_VISION_MODEL = IS_VLLM
  ? (process.env.LLM_VISION_MODEL || LLM_MODEL)
  : (process.env.OPENAI_VISION_MODEL || LLM_MODEL);

console.log(`[llm] provider=${LLM_PROVIDER} model=${LLM_MODEL} vision=${LLM_VISION_MODEL}` +
            (BASE_URL ? ` base=${BASE_URL}` : ""));

/**
 * Client dùng chung. Import với tên `openai` để phần còn lại của codebase đọc y như cũ:
 *   import { llm as openai } from "../lib/llm.js";
 */
export const llm = new OpenAI({
  ...(BASE_URL ? { baseURL: BASE_URL } : {}),
  apiKey: API_KEY,
});

/**
 * Dọn body trước khi gửi: bỏ những tham số CHỈ vLLM hiểu.
 *
 * ĐO ĐƯỢC, KHÔNG PHẢI SUY ĐOÁN: `extra_body` là quy ước của SDK **Python** —
 * nó gộp các khoá bên trong lên top-level. SDK **Node** không làm vậy: nó gửi
 * nguyên một field tên "extra_body", và vLLM lặng lẽ bỏ qua field lạ. Thử trực
 * tiếp trên server của dự án, cùng một schema guided_json ép output chỉ được
 * phép là "BANANA":
 *
 *     lồng trong extra_body  ->  "Thủ đô nước Pháp là Paris."      (bị bỏ qua)
 *     đặt thẳng top-level    ->  { "answer": "BANANA" }            (có hiệu lực)
 *
 * Nghĩa là guided_json, mm_processor_kwargs (min/max pixels), chat_template_kwargs
 * và repetition_penalty trong dự án này CHƯA BAO GIỜ có tác dụng — với cả vLLM.
 * Nên xoá chúng đi là thay đổi 0% hành vi ở CẢ HAI nhà cung cấp, đồng thời bỏ
 * được đoạn code đang mô tả sai việc nó làm.
 *
 * KHÔNG tự "sửa" bằng cách nâng chúng lên top-level: làm thế sẽ BẬT lần đầu một
 * loạt ràng buộc chưa từng chạy (ép schema, đổi độ phân giải ảnh) — đó là thay
 * đổi hành vi thật, phải đo trước rồi mới bật, không phải gài kèm vào lượt đổi
 * nhà cung cấp.
 *
 * frequency_penalty / presence_penalty thì OpenAI có thật, nên được nâng lên
 * top-level đúng chỗ của chúng.
 */
export function chatBody(body = {}) {
  const { extra_body: extra, ...rest } = body;
  if (extra && typeof extra === "object") {
    for (const k of ["frequency_penalty", "presence_penalty"]) {
      if (rest[k] === undefined && typeof extra[k] === "number") rest[k] = extra[k];
    }
  }
  return rest;
}

export default llm;
