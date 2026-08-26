/**
 * app_pipeline.mjs — cầu nối để benchmark chạy ĐÚNG pipeline nhận diện của app.
 *
 * Vì sao phải gọi sang JS thay vì chép prompt sang Python: prompt vision của app
 * dài ~4000 token và toàn bộ chuẩn hoá (normalizeFood, computeTotalsFromItems,
 * guided_json schema) đều nằm trong lib/vision.js. Chép sang Python thì hôm nay
 * giống, sửa lib/vision.js một lần là lệch, và benchmark sẽ âm thầm đo một thứ
 * không còn tồn tại. Ở đây import thẳng file thật — không có bản sao nào để lệch.
 *
 * KHÔNG sửa lib/vision.js để phục vụ test. Chỉ import cái đang có.
 *
 * Giao thức: đọc từng dòng stdin = một đường dẫn ảnh, ghi ra stdout một dòng
 *   @@R@@ {"ok":true,"food":"...","calories":123,"ms":900}
 *   @@R@@ {"ok":false,"error":"..."}
 * Giữ tiến trình sống qua nhiều ảnh để khỏi trả giá khởi động Node mỗi lần.
 *
 * Chạy tay:  echo <đường-dẫn-ảnh> | node testmodel/app_pipeline.mjs
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, "..");

// ── Nạp .env.local ──────────────────────────────────────────────────────────
// Next.js tự nạp file này, `node` chạy trần thì không. Thiếu bước này là
// LLM_BASE_URL rỗng và mọi ảnh đều lỗi kết nối.
const envFile = path.join(PROJECT, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

// ── Dọn stdout TRƯỚC khi import ─────────────────────────────────────────────
// lib/llm.js in một dòng cấu hình ngay lúc import, còn lib/vision.js in
// [vision:debug] cho từng ảnh. Những dòng đó lẫn vào stdout sẽ phá giao thức
// đọc-dòng ở phía Python. Đẩy hết sang stderr: vẫn xem được khi cần debug,
// nhưng không lẫn vào kết quả.
const rawWrite = process.stdout.write.bind(process.stdout);
console.log = (...a) => process.stderr.write(a.join(" ") + "\n");
console.info = console.log;
console.warn = (...a) => process.stderr.write(a.join(" ") + "\n");

const { analyzeFoodImage, visionProvider } = await import("../lib/vision.js");
process.stderr.write(`[app_pipeline] provider = ${visionProvider()}\n`);

const mimeOf = (p) => {
  const e = path.extname(p).toLowerCase();
  return e === ".png" ? "image/png" : e === ".webp" ? "image/webp" : "image/jpeg";
};

const emit = (obj) => rawWrite("@@R@@ " + JSON.stringify(obj) + "\n");

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  const p = line.trim();
  if (!p) continue;
  const t0 = Date.now();
  try {
    const base64 = fs.readFileSync(p).toString("base64");
    // note/contextNote để rỗng: benchmark chỉ đưa ảnh, đúng như người dùng chụp
    // rồi gửi thẳng không ghi chú. Nhét gợi ý vào đây là tự chấm điểm hộ model.
    const r = await analyzeFoodImage({ base64, mimeType: mimeOf(p), lang: "vi" });
    emit({
      ok: true,
      is_food: r?.is_food !== false,
      food: r?.food || "",
      confidence: r?.confidence || "",
      alternatives: (r?.alternative_candidates || []).map((a) => a.name),
      calories: r?.calories ?? null,
      ms: Date.now() - t0,
    });
  } catch (e) {
    emit({ ok: false, error: `${e?.name || "Error"}: ${e?.message || e}`, ms: Date.now() - t0 });
  }
}
