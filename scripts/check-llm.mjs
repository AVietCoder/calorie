// check-llm.mjs — thu nho: nha cung cap LLM da noi dung chua?
//
// Chay tu THU MUC GOC du an:
//     node scripts/check-llm.mjs vllm
//     node scripts/check-llm.mjs openai
//
// Kiem 2 viec:
//   1) chatBody() bo dung cac tham so CHI vLLM hieu (chat_template_kwargs,
//      mm_processor_kwargs, repetition_penalty) va nang frequency/presence
//      penalty len top-level. Gui nham extra_body sang OpenAI la 400.
//   2) Goi that mot luot de biet khoa/model/endpoint co song khong.
//
// Vi sao dang test: extra_body la quy uoc cua SDK Python; SDK Node gui nguyen
// mot field la ten "extra_body" va server bo qua. Da do tren chinh server vLLM
// cua du an: cung mot guided_json ep output phai la "BANANA", ban long tra
// "Thu do nuoc Phap la Paris.", ban top-level tra {"answer":"BANANA"}.

import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
process.env.LLM_PROVIDER = process.argv[2];
const { llm, LLM_MODEL, LLM_PROVIDER, chatBody } = await import("../lib/llm.js");

// 1) chatBody: bỏ tham số vLLM-only, nâng penalty lên top-level
const out = chatBody({
  model: "m", messages: [],
  extra_body: { chat_template_kwargs: { a: 1 }, mm_processor_kwargs: { b: 2 },
                repetition_penalty: 1.15, frequency_penalty: 0.5, presence_penalty: 0.3 },
});
const keys = Object.keys(out).sort().join(",");
console.log("chatBody ->", keys,
  keys === "frequency_penalty,messages,model,presence_penalty" ? "  ✓" : "  ✗ SAI");

// 2) Gọi thật
try {
  const r = await llm.chat.completions.create({
    model: LLM_MODEL, max_tokens: 20, temperature: 0,
    messages: [{ role: "user", content: "Trả lời đúng một từ: xin chào" }],
  });
  console.log(`${LLM_PROVIDER} (${LLM_MODEL}) -> OK:`, JSON.stringify(r.choices[0].message.content));
} catch (e) {
  console.log(`${LLM_PROVIDER} (${LLM_MODEL}) -> LỖI ${e.status || ""}: ${String(e.message).slice(0, 110)}`);
}
