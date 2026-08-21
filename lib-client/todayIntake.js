// lib-client/todayIntake.js — ported verbatim from the inline script in the
// old public/schedule.html: local (per-user, per-day) tracking of which
// planned meals were eaten/skipped + ad-hoc "extra" foods, stored in
// localStorage so no DB schema change was needed. Pure functions — callers
// re-read after every mutation (cheap: one small JSON blob per day).
export function intakeKey() {
  const uid = typeof window !== 'undefined' ? window.localStorage.getItem('user_id') || 'anon' : 'anon';
  return `calorie_ai_intake_${uid}`;
}
/**
 * Khoá ngày "YYYY-MM-DD" theo GIỜ MÁY, không phải UTC.
 *
 * `toISOString()` trả ngày theo UTC. Ở Việt Nam (UTC+7) thì từ 00:00 đến 07:00
 * sáng, ngày UTC vẫn là HÔM QUA — trong khi `todayPlanDay()` lại lấy thứ theo
 * giờ máy. Hai hàm này chỉ cùng chỉ về một ngày trong 17/24 giờ.
 *
 * Hậu quả trong khoảng 0h–7h: tick "Đã ăn" cho các bữa của hôm nay lại được ghi
 * vào bản ghi của hôm qua, và món thêm cũng vậy; tới 7h sáng khoá ngày nhảy
 * sang hôm nay thì mọi thứ vừa nhập "biến mất". Đây cũng là lý do món thêm rơi
 * sai cột khi đối chiếu ngày với thứ trong tuần.
 */
export function dateKeyOf(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function todayStr() {
  return dateKeyOf(new Date());
}
// JS: 0=CN..6=T7 -> plan day 1=T2..7=CN
export function todayPlanDay() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}
export function loadIntakeAll() {
  try { return JSON.parse(window.localStorage.getItem(intakeKey())) || {}; }
  catch { return {}; }
}
export function getTodayIntake() {
  const all = loadIntakeAll();
  const k = todayStr();
  if (!all[k]) all[k] = { eaten: {}, extras: [] };
  if (!all[k].eaten) all[k].eaten = {};
  if (!all[k].extras) all[k].extras = [];
  if (!all[k].skipped) all[k].skipped = {};
  if (!all[k].eatenInfo) all[k].eatenInfo = {};
  return { all, day: all[k] };
}
export function saveTodayIntake(all) {
  window.localStorage.setItem(intakeKey(), JSON.stringify(all));
}
export function parseMacro(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}
/**
 * Khoá ngày của day_index (1 = T2 … 7 = CN) TRONG TUẦN HIỆN TẠI.
 *
 * Bảng lộ trình đánh số theo THỨ, còn kho intake lưu theo NGÀY LỊCH. Muốn đọc
 * lại "thứ 5 đã ăn gì" thì phải quy thứ về đúng ngày rồi mới tra.
 */
export function dateKeyForPlanDay(dayIndex) {
  const d = new Date();
  d.setDate(d.getDate() + (Number(dayIndex) - todayPlanDay()));
  return dateKeyOf(d);
}

/**
 * Bản ghi intake của MỘT ngày trong tuần, tạo rỗng nếu chưa có.
 *
 * Đây là chỗ sửa lỗi "qua ngày là mất hết món đã ăn". Bản cũ dùng
 * getTodayIntake() cho MỌI thao tác: `isEaten(day, meal)` có nhận tham số
 * `day` nhưng lại bỏ qua nó khi chọn bản ghi, luôn tra trong bản ghi HÔM NAY.
 *
 * Hệ quả: tick vào thứ 5 được ghi đúng vào bản ghi ngày thứ 5, nhưng sang thứ 6
 * thì getTodayIntake() trả bản ghi thứ 6 (rỗng) nên tra không thấy gì. Dữ liệu
 * KHÔNG mất — nó vẫn nằm nguyên trên đĩa — chỉ là không còn đường nào đọc lại.
 * Kiểm chứng bằng đồng hồ giả: sau khi nhảy sang hôm sau, localStorage vẫn giữ
 * `"2026-08-20": { eaten: ["4-Sáng","4-Trưa"] }` trong khi mọi hàm đọc đều
 * trả false.
 */
function dayRecord(all, dayIndex) {
  const k = dateKeyForPlanDay(dayIndex);
  if (!all[k]) all[k] = { eaten: {}, extras: [] };
  if (!all[k].eaten) all[k].eaten = {};
  if (!all[k].extras) all[k].extras = [];
  if (!all[k].skipped) all[k].skipped = {};
  if (!all[k].eatenInfo) all[k].eatenInfo = {};
  return all[k];
}

export function isEaten(day, meal) {
  const all = loadIntakeAll();
  return !!dayRecord(all, day).eaten[`${day}-${meal}`];
}
export function setEaten(day, meal, val, item) {
  const all = loadIntakeAll();
  const d = dayRecord(all, day);
  const key = `${day}-${meal}`;
  if (val) {
    d.eaten[key] = true;
    if (d.skipped) delete d.skipped[key];
    if (item) {
      d.eatenInfo[key] = {
        food: item.food || '',
        calories: parseMacro(item.calories),
        protein: parseMacro(item.protein),
        fat: parseMacro(item.fat),
        carbs: parseMacro(item.carbs),
      };
    }
  } else {
    delete d.eaten[key];
    if (d.eatenInfo) delete d.eatenInfo[key];
  }
  saveTodayIntake(all);
}
export function isSkipped(day, meal) {
  const all = loadIntakeAll();
  return !!dayRecord(all, day).skipped[`${day}-${meal}`];
}
export function setSkipped(day, meal, val) {
  const all = loadIntakeAll();
  const d = dayRecord(all, day);
  const key = `${day}-${meal}`;
  if (!d.skipped) d.skipped = {};
  if (val) {
    d.skipped[key] = true;
    delete d.eaten[key];
  } else {
    delete d.skipped[key];
  }
  saveTodayIntake(all);
}
export function computeTodayTotals(tempPlan) {
  const tot = { calories: 0, protein: 0, fat: 0, carbs: 0, count: 0 };
  const { day: d } = getTodayIntake();
  const pday = todayPlanDay();
  (tempPlan || []).forEach((item) => {
    if (Number(item.day) !== pday) return;
    if (!d.eaten[`${pday}-${item.meal}`]) return;
    tot.calories += parseMacro(item.calories);
    tot.protein += parseMacro(item.protein);
    tot.fat += parseMacro(item.fat);
    tot.carbs += parseMacro(item.carbs);
    tot.count++;
  });
  (d.extras || []).forEach((ex) => {
    tot.calories += parseMacro(ex.calories);
    tot.protein += parseMacro(ex.protein);
    tot.fat += parseMacro(ex.fat);
    tot.carbs += parseMacro(ex.carbs);
    tot.count++;
  });
  return tot;
}
export function addExtraFood(item) {
  const { all, day } = getTodayIntake();
  day.extras = day.extras || [];
  day.extras.push(item);
  saveTodayIntake(all);
}
export function removeExtraFood(id) {
  const { all, day } = getTodayIntake();
  day.extras = (day.extras || []).filter((x) => x.id !== id);
  saveTodayIntake(all);
}

/**
 * Món thêm của CẢ TUẦN hiện tại, gom theo day_index (1 = T2 … 7 = CN).
 *
 * Bảng lộ trình 7 ngày trước đây chỉ vẽ thực đơn do AI sinh, nên món người dùng
 * tự thêm không xuất hiện ở đâu trong bảng — nhìn vào tưởng chưa ăn gì thêm.
 * Kho intake vốn đã lưu theo từng ngày, nên chỉ cần soi đúng 7 ngày của tuần
 * này rồi xếp vào cột tương ứng.
 *
 * Duyệt theo NGÀY LỊCH rồi suy ra thứ, chứ không đọc day_index đã lưu: các bản
 * ghi cũ không có trường đó, mà ngày thì luôn nằm ngay ở khoá.
 *
 * @returns {Record<number, Array>} vd { 4: [{...}], 5: [{...}] }
 */
export function getWeekExtras() {
  const all = loadIntakeAll();
  const out = {};
  const today = new Date();
  const todayIdx = todayPlanDay();
  for (let idx = 1; idx <= 7; idx++) {
    const d = new Date(today);
    d.setDate(d.getDate() + (idx - todayIdx));   // lùi/tiến về đúng thứ trong tuần này
    const rec = all[dateKeyOf(d)];
    const list = rec?.extras || [];
    if (list.length) out[idx] = list;
  }
  return out;
}
