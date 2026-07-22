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
 * List published templates (public + this household's own private ones)
 * ranked best-fit first. No LLM call — pure tag-overlap scoring.
 */
export async function recommendTemplates(household, members, { limit = 10, filters = {} } = {}) {
  let query = supabaseAdmin
    .from('menu_templates')
    .select('*')
    .eq('status', 'published')
    .or(`visibility.eq.public,owner_household_id.eq.${household.id}`);

  if (filters.tag) query = query.contains('tags', [filters.tag]);

  const { data, error } = await query;
  if (error) throw error;

  const ranked = (data || [])
    .map((t) => scoreTemplate(t, household, members))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked;
}

export default { scoreTemplate, recommendTemplates };
