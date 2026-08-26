// test-chat-intent.mjs — kiểm định tuyến intent + cổng fast path của
// app/api/chat/route.js. Chạy TỪ THƯ MỤC GỐC dự án:
//
//     node testmodel/test-chat-intent.mjs
//
// Lấy thẳng regex từ file nguồn (không chép tay) nên test không lệch khi sửa route.js.
//
// Bối cảnh: /tô/ của JS KHỚP vào chữ "tôi", và /mì/ khớp vào "mình" —
//  chỉ biết [A-Za-z0-9_] nên dấu tiếng Việt tạo ranh giới giả giữa từ. Hậu quả:
// mọi câu bắt đầu bằng "tôi"/"mình" đều bị xếp là "có nhắc tới món ăn", rồi cả câu
// bị đem đi tra dinh dưỡng và hiện thẻ calo + bảng xác nhận bữa ăn.
// Các ca "PHẢI GIỮ NGUYÊN" ở dưới quan trọng ngang các ca sửa lỗi.

import fs from "node:fs";
const src = fs.readFileSync("app/api/chat/route.js", "utf8");
const block = src.slice(src.indexOf("const FOOD_GENERIC_WORDS"), src.indexOf("const detectIntent"));
const m = await import("data:text/javascript," + encodeURIComponent(
  block + "\nexport { FOOD_MENTION_RE, FOOD_DISH_RE, ADVICE_QUESTION_RE, UPDATE_RE, CASUAL_RE };"));

const OLD_FOOD = /\b(ăn|uống|món|tô|bát|đĩa|ly|cốc|miếng|phần|gram|kg|kcal|calo|bữa|phở|bún|cơm|bánh|thịt|cá|rau|trái|quả|sữa|trứng|đậu|gà|heo|bò|tôm|mực|ốc|canh|lẩu|xôi|cháo|mì|hủ tiếu|pizza|burger|kfc|sandwich|salad|yogurt|yến mạch|oats|protein|smoothie|sinh tố)\b/i;
const oldIntent = (s) => m.UPDATE_RE.test(s) ? "coach" : OLD_FOOD.test(s) ? "analyze" : m.CASUAL_RE.test(s) ? "casual" : "coach";
const newIntent = (s) => m.UPDATE_RE.test(s) ? "coach" : m.ADVICE_QUESTION_RE.test(s) ? "analyze"
  : m.FOOD_MENTION_RE.test(s) ? "analyze" : m.CASUAL_RE.test(s) ? "casual" : "coach";
const oldFast = (s) => oldIntent(s) === "analyze" && OLD_FOOD.test(s);
const newFast = (s) => newIntent(s) === "analyze" && m.FOOD_DISH_RE.test(s) && !m.ADVICE_QUESTION_RE.test(s);

const CASES = [
  ["tôi bị tiểu đường thì nên ăn gì", "analyze", false],
  ["tôi bị gan nhiễm mỡ",             "analyze", false],
  ["mình bị gan nhiễm mỡ",            "analyze", false],
  ["tôi bị tiểu đường có nên ăn cơm không", "analyze", false],
  ["mình bị gout kiêng ăn gì",        "analyze", false],
  ["tôi buồn quá",                    "casual",  false],
  ["tôi mệt quá",                     "casual",  false],
  ["tôi tên là Việt",                 "coach",   false],
  ["tôi vừa ăn 1 tô phở bò",          "analyze", true ],
  ["phở bò bao nhiêu calo",           "analyze", true ],
  ["mình ăn 200g ức gà",              "analyze", true ],
  ["cơm tấm sườn bì chả",             "analyze", true ],
  ["1 ly sinh tố bơ",                 "analyze", true ],
  ["đổi bữa trưa thứ 3",              "coach",   false],
  ["tạo lại thực đơn mới",            "coach",   false],
  ["hôm nay trời đẹp",                "coach",   false],
];
let bad = 0;
console.log("CÂU".padEnd(40) + "intent cũ".padEnd(11) + "intent mới".padEnd(12) + "mong".padEnd(10) + "fast cũ".padEnd(9) + "fast mới".padEnd(10) + "mong  KQ");
console.log("-".repeat(112));
for (const [s, wantIntent, wantFast] of CASES) {
  const ni = newIntent(s), nf = newFast(s);
  const ok = ni === wantIntent && nf === wantFast;
  if (!ok) bad++;
  console.log(s.padEnd(40) + oldIntent(s).padEnd(11) + ni.padEnd(12) + wantIntent.padEnd(10)
    + String(oldFast(s)).padEnd(9) + String(nf).padEnd(10) + String(wantFast).padEnd(6) + (ok ? "ok" : "SAI"));
}
console.log(`\n${CASES.length - bad}/${CASES.length} đúng`);
process.exit(bad ? 1 : 0);
