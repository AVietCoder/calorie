/**
 * kb-answer.js — STRICT Knowledge-Base question answering.
 *
 * This is the flow the requirements describe:
 *   • answer ONLY from the uploaded PDFs (admin_kb_chunks),
 *   • retrieved via PostgreSQL Full Text Search (tsvector + GIN + ts_rank —
 *     NO embeddings, NO embedding server, NO vector DB anywhere),
 *   • if the document doesn't contain the answer, reply EXACTLY
 *     "Không tìm thấy trong Knowledge Base." instead of guessing.
 *
 * It calls retrieveKnowledge({ kbOnly: true }) (lib/knowledge.js), applies a
 * confidence gate before ever calling the LLM, then hands the raw matched
 * passages to Qwen verbatim. Every stage is logged so you can see exactly
 * what happened.
 */
import { llm, LLM_MODEL } from "../llm.js";
import {
  retrieveKnowledge,
  buildStrictKbSection,
  kbHasConfidentHit,
  kbThresholds,
  KB_NOT_FOUND,
} from "../knowledge.js";

const DEBUG = process.env.RAG_DEBUG === "1";
function log(...a) {
  console.log("📖 [kb-answer]", ...a);
}
function dbg(...a) {
  if (DEBUG) console.log("📖 [kb-answer]", ...a);
}

/**
 * @param {object} args
 * @param {string} args.question         The user's question.
 * @param {"vi"|"en"} [args.lang="vi"]
 * @param {number} [args.topK=6]         How many chunks to ground on (5-10 recommended).
 * @param {number} [args.maxChars=4500]  Char budget for the grounding context.
 * @param {number} [args.temperature=0]  Low temp → faithful to the passages.
 * @returns {Promise<{
 *   found: boolean, answer: string, chunks: object[], mode: string,
 *   confidence: {bestRank:number, thresholds:object}
 * }>}
 */
export async function answerFromKnowledgeBase({
  question,
  lang = "vi",
  topK = 8,
  maxChars = 4500,
  temperature = 0,
} = {}) {
  const q = String(question || "").trim();
  log(`Q="${q.slice(0, 100)}" lang=${lang} | engine=postgres-fulltext-search`);

  if (!q) {
    return {
      found: false, answer: KB_NOT_FOUND, chunks: [], mode: "empty-question",
      confidence: { bestRank: 0, thresholds: kbThresholds() },
    };
  }

  // 1) RETRIEVE (Knowledge Base only) — PostgreSQL Full Text Search.
  const result = await retrieveKnowledge({ message: q, topK, maxChars, kbOnly: true });
  const confidence = {
    bestRank: Number((result.bestRank || 0).toFixed(4)),
    thresholds: kbThresholds(),
  };
  log(
    `retrieved ${result.chunks.length} chunk(s) | mode=${result.mode} | ` +
      `bestRank=${confidence.bestRank} (gate: rank>=${confidence.thresholds.minRank})`
  );

  // 2) CONFIDENCE GATE → refuse rather than hallucinate.
  if (!kbHasConfidentHit(result)) {
    log(`below confidence gate → "${KB_NOT_FOUND}"`);
    return { found: false, answer: KB_NOT_FOUND, chunks: result.chunks, mode: result.mode, confidence };
  }

  // 3) GROUND + ANSWER. The system prompt forbids outside knowledge and mandates
  //    the not-found reply, so even a passing gate can still return not-found if
  //    the passages don't actually contain the specific fact requested.
  const grounding = buildStrictKbSection(result, { lang });
  const system =
    lang === "en"
      ? "You are a retrieval-grounded assistant. Answer strictly from the provided Knowledge Base passages. Never use outside knowledge, never invent numbers. If the answer isn't in the passages, output exactly: \"" +
        KB_NOT_FOUND + "\"."
      : "Bạn là trợ lý trả lời DỰA HOÀN TOÀN trên tài liệu được cung cấp. Chỉ dùng thông tin trong các trích đoạn Knowledge Base, tuyệt đối không dùng kiến thức nền, không bịa số liệu. Nếu không có trong trích đoạn, trả lời đúng: \"" +
        KB_NOT_FOUND + "\".";

  dbg(`grounding block: ${grounding.length} chars over ${result.chunks.length} chunks`);

  let answer;
  try {
    const t0 = Date.now();
    const completion = await llm.chat.completions.create({
      model: LLM_MODEL,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `${grounding}\n\nCâu hỏi: ${q}` },
      ],
    });
    answer = (completion.choices?.[0]?.message?.content || "").trim();
    log(`LLM answered in ${Date.now() - t0}ms (${answer.length} chars)`);
  } catch (err) {
    // If the LLM is unreachable we still return the grounded context so the caller
    // isn't left with nothing, but we flag it clearly.
    console.error(`❌ [kb-answer] LLM call failed: ${err.message}`);
    return {
      found: true,
      answer: `⚠️ Không gọi được mô hình để tổng hợp câu trả lời (${err.message}). ` +
        `Dưới đây là các trích đoạn liên quan nhất trong Knowledge Base:\n\n` +
        result.chunks.map((c, i) => `[${i + 1}] ${c.text}`).join("\n\n"),
      chunks: result.chunks, mode: result.mode, confidence,
    };
  }

  const found = answer && !answer.includes(KB_NOT_FOUND);
  return { found: !!found, answer: answer || KB_NOT_FOUND, chunks: result.chunks, mode: result.mode, confidence };
}

/* ----------------------------------------------------------------------- */
/* Numeric nutrition grounding from the uploaded PDFs (Knowledge Base).     */
/* Dùng cho analyze-food/chat: ưu tiên số liệu "chuẩn" người dùng đã upload  */
/* thay vì để vision/LLM tự bịa. TUYỆT ĐỐI chống hallucination:             */
/*   - có cổng tin cậy (kbHasConfidentHit) trước khi gọi LLM,               */
/*   - prompt NGHIÊM NGẶT: chỉ dùng số trong trích đoạn, thiếu → found:false,*/
/*   - validate số hữu hạn/dương; mọi lỗi/nghi ngờ → { found:false }.       */
/* ----------------------------------------------------------------------- */
const kbTolerantParse = (raw) => {
  const s = String(raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0].replace(/,\s*([}\]])/g, "$1")); } catch {} }
  return null;
};

const kbNum = (v) => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * Tra dinh dưỡng cho MỘT món ăn CHỈ từ Knowledge Base (PDF admin đã upload).
 * @param {{food:string, amount?:string, lang?:"vi"|"en", topK?:number}} p
 * @returns {Promise<{found:boolean, calories?:number, protein?:string, fat?:string,
 *   carbs?:string, fiber?:string, sugar?:string, sodium?:string, sources?:number}>}
 *   found=false khi KB không chứa (giữ nguyên số vision) — không bao giờ ném lỗi.
 */
export async function nutritionFromKnowledgeBase({ food, amount = "1 phần", lang = "vi", topK = 6 } = {}) {
  const name = String(food || "").trim();
  if (!name) return { found: false };
  try {
    const q = `${name} ${amount} calo calories protein chất béo fat carbohydrate carbs dinh dưỡng nutrition`;
    const result = await retrieveKnowledge({ message: q, topK, kbOnly: true });
    if (!kbHasConfidentHit(result)) {
      dbg(`kb-nutrition "${name}" → không đủ tin cậy, giữ số vision`);
      return { found: false, reason: "no-kb-hit" };
    }
    const grounding = buildStrictKbSection(result, { lang });
    const sys =
      "Bạn là công cụ TRÍCH dinh dưỡng. CHỈ dùng con số XUẤT HIỆN trong các trích đoạn được cung cấp. " +
      "TUYỆT ĐỐI không dùng kiến thức nền, không suy đoán, không bịa số. Chỉ trả về DUY NHẤT một JSON.";
    const user =
      `${grounding}\n\nMón cần tra: "${name}", khẩu phần: "${amount}".\n` +
      `Nếu trích đoạn CÓ đủ dữ liệu để xác định dinh dưỡng của món này cho ĐÚNG khẩu phần trên, trả:\n` +
      `{"found":true,"calories":<kcal number>,"protein":"Xg","fat":"Xg","carbs":"Xg","fiber":"Xg","sugar":"Xg","sodium":"Xmg"}\n` +
      `Nếu trích đoạn KHÔNG có/không đủ để suy ra (đừng tự quy đổi mơ hồ) → {"found":false}.\nCHỈ JSON.`;
    const c = await llm.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0, top_p: 1, seed: 42, max_tokens: 260,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      extra_body: { chat_template_kwargs: { enable_thinking: false }, repetition_penalty: 1.15, frequency_penalty: 0.5 },
    });
    const obj = kbTolerantParse(c.choices?.[0]?.message?.content || "");
    if (!obj || obj.found === false) return { found: false };
    const cal = kbNum(obj.calories);
    if (cal == null || cal <= 0) return { found: false };
    const g = (v) => (kbNum(v) != null ? `${Math.round(kbNum(v))}g` : undefined);
    const mg = (v) => (kbNum(v) != null ? `${Math.round(kbNum(v))}mg` : undefined);
    log(`kb-nutrition "${name}" (${amount}) → ${Math.round(cal)} kcal (từ ${result.chunks.length} đoạn KB)`);
    return {
      found: true,
      calories: Math.round(cal),
      protein: g(obj.protein), fat: g(obj.fat), carbs: g(obj.carbs),
      fiber: g(obj.fiber), sugar: g(obj.sugar), sodium: mg(obj.sodium),
      sources: result.chunks.length,
    };
  } catch (e) {
    console.warn(`⚠️ [kb-answer] nutritionFromKnowledgeBase lỗi (giữ số vision): ${e.message}`);
    return { found: false };
  }
}

export default { answerFromKnowledgeBase, nutritionFromKnowledgeBase };
