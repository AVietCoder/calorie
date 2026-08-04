/**
 * lib/family-menu/sample-menus.js — thực đơn mẫu cho hộ chưa có kế hoạch.
 *
 * Nguồn: knowledge/sample-menus.json, sinh offline bởi
 * scripts/build-sample-menus.mjs (final_sample/*.xlsx bị gitignore nên KHÔNG
 * tồn tại trên Vercel — bắt buộc phải đi qua file JSON đã commit).
 *
 * sampleMenuAsPlan() trả về ĐÚNG shape của GET ?resource=plan, nhờ vậy UI dùng
 * lại nguyên component, chỉ cần guard `plan.is_sample` quanh các nút ghi.
 */
import data from '../../knowledge/sample-menus.json' with { type: 'json' };

const MENUS = data.menus || [];
const byId = new Map(MENUS.map((m) => [m.id, m]));

export function listSampleMenus({ tag, limit } = {}) {
  let out = MENUS;
  if (tag) out = out.filter((m) => (m.tags || []).some((t) => t.toLowerCase() === String(tag).toLowerCase()));
  if (limit) out = out.slice(0, limit);
  return out.map((m) => ({
    id: m.id, title: m.title, tags: m.tags || [], source: m.source, dayCount: m.dayCount,
  }));
}

export function getSampleMenu(id) {
  return byId.get(id) || null;
}

/** Mẫu → cùng shape với plan thật (plan_days → plan_meals → plan_dishes). */
export function sampleMenuAsPlan(id) {
  const menu = byId.get(id);
  if (!menu) return null;
  return {
    id: `sample:${menu.id}`,
    is_sample: true,
    sample_id: menu.id,
    source_title: menu.title,
    source_name: menu.source,
    tags: menu.tags || [],
    status: 'active',
    plan_days: (menu.days || []).map((d, di) => ({
      id: `sample:${menu.id}:d${d.day_index}`,
      day_index: d.day_index,
      plan_meals: (d.meals || []).map((m, mi) => ({
        id: `sample:${menu.id}:d${d.day_index}:${m.meal_type}`,
        meal_type: m.meal_type,
        plan_dishes: (m.dishes || []).map((dish, i) => ({
          id: `sample:${menu.id}:${di}:${mi}:${i}`,
          name: dish.name,
          grams: dish.base_grams ?? null,
          calories: dish.calories ?? null,
          protein: dish.protein ?? null,
          fat: dish.fat ?? null,
          carbs: dish.carbs ?? null,
          fiber: dish.fiber ?? null,
          sugar: dish.sugar ?? null,
          sodium: dish.sodium ?? null,
          tags: [],
          plan_dish_ingredients: (dish.ingredients || []).map((ing, k) => ({
            id: `sample:${menu.id}:${di}:${mi}:${i}:${k}`,
            name: ing.name,
            grams: ing.grams ?? null,
            unit: ing.unit ?? null,
          })),
        })),
      })),
    })),
  };
}

/** Các dòng nguyên liệu thô để đưa thẳng vào computeShoppingModel. */
export function sampleIngredientRows(id) {
  const menu = byId.get(id);
  if (!menu) return [];
  const rows = [];
  for (const d of menu.days || []) {
    for (const m of d.meals || []) {
      for (const dish of m.dishes || []) {
        for (const ing of dish.ingredients || []) {
          // dayIndex đi kèm để dựng được checklist từng ngày, giống dữ liệu thật.
          rows.push({
            name: ing.name,
            grams: ing.grams ?? null,
            unit: ing.unit ?? null,
            dayIndex: d.day_index ?? d.dayIndex ?? null,
          });
        }
      }
    }
  }
  return rows;
}

export default { listSampleMenus, getSampleMenu, sampleMenuAsPlan, sampleIngredientRows };
