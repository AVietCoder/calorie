// lib-client/todayIntake.js — ported verbatim from the inline script in the
// old public/schedule.html: local (per-user, per-day) tracking of which
// planned meals were eaten/skipped + ad-hoc "extra" foods, stored in
// localStorage so no DB schema change was needed. Pure functions — callers
// re-read after every mutation (cheap: one small JSON blob per day).
export function intakeKey() {
  const uid = typeof window !== 'undefined' ? window.localStorage.getItem('user_id') || 'anon' : 'anon';
  return `calorie_ai_intake_${uid}`;
}
export function todayStr() {
  return new Date().toISOString().slice(0, 10);
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
export function isEaten(day, meal) {
  const { day: d } = getTodayIntake();
  return !!d.eaten[`${day}-${meal}`];
}
export function setEaten(day, meal, val, item) {
  const { all, day: d } = getTodayIntake();
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
  const { day: d } = getTodayIntake();
  return !!(d.skipped && d.skipped[`${day}-${meal}`]);
}
export function setSkipped(day, meal, val) {
  const { all, day: d } = getTodayIntake();
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
