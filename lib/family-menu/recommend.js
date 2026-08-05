// lib/family-menu/recommend.js — deterministic Recommendation Engine (MVP: no LLM).
//
// Templates are ranked by tag overlap with the household's aggregate
// profile. Per-dish allergy/disease conflicts are NOT resolved here — that's
// the Rule Engine's job at plan-build time (a template can still be the best
// fit even if one dish needs substituting later).
import { supabaseAdmin } from '../supabase.js';

const WEIGHTS = { goal: 3, region: 2, diet_type: 2, age_group: 1, budget_tier: 1, disease_target: 4 };

function householdTagPool(household, members) {
  const pool = new Set();
  for (const m of members) {
    for (const g of String(m.goal || '').split(',')) if (g.trim()) pool.add(`goal:${g.trim().toLowerCase()}`);
    if (m.disease) pool.add(`disease_target:${m.disease.trim().toLowerCase()}`);
  }
  if (household.region) pool.add(`region:${household.region.trim().toLowerCase()}`);
  return pool;
}

export function scoreTemplate(template, household, members) {
  const pool = householdTagPool(household, members);
  let score = 0;
  const matchedTags = [];

  for (const tag of template.tags || []) {
    const [dim] = String(tag).split(':');
    if (pool.has(tag.toLowerCase())) {
      score += WEIGHTS[dim] || 1;
      matchedTags.push(tag);
    }
  }
  for (const dt of template.disease_target || []) {
    const key = `disease_target:${String(dt).toLowerCase()}`;
    if (pool.has(key)) {
      score += WEIGHTS.disease_target;
      matchedTags.push(key);
    }
  }

  return { template, score, matchedTags };
}

/**
 * List published templates ranked best-fit first. No LLM call — pure tag-overlap
 * scoring.
 *
 * Phạm vi nhìn thấy = thực đơn HỆ THỐNG + thực đơn DO CHÍNH NGƯỜI DÙNG tạo.
 *
 * Trước đây mọi thực đơn `visibility = 'public'` đều hiện, kể cả bản nháp/thử
 * của tài khoản khác — thư viện đầy "Menu chưa đặt tên", "Test thực đơn 1" của
 * người lạ, và bộ lọc "Người dùng tạo" đếm cả những bản đó. Lọc ngay ở tầng
 * truy vấn (không phải ở client) để số đếm trên chip cũng đúng.
 *
 * `userId` bỏ trống ⇒ chỉ còn thực đơn hệ thống. Cố ý: thà thiếu còn hơn lỡ
 * để lộ thực đơn riêng của người khác khi nơi gọi quên truyền id.
 */
export async function recommendTemplates(household, members, { limit = 10, filters = {}, userId = null } = {}) {
  let query = supabaseAdmin
    .from('menu_templates')
    .select('*')
    .eq('status', 'published')
    // Vẫn giữ rào bảo mật cũ: không bao giờ trả thực đơn riêng của hộ khác.
    .or(`visibility.eq.public,owner_household_id.eq.${household.id}`);

  if (filters.tag) query = query.contains('tags', [filters.tag]);

  const { data, error } = await query;
  if (error) throw error;

  const mine = (t) => !!userId && t.created_by === userId;
  const visible = (data || []).filter((t) => t.is_system || mine(t));

  const ranked = visible
    .map((t) => scoreTemplate(t, household, members))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked;
}

export default { scoreTemplate, recommendTemplates };
