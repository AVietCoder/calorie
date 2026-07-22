// lib/family-menu/rules.js — Data-driven Rule Engine (MVP: allergy + disease).
//
// Rules live in the `rules` table, not in code — same philosophy as
// lib/knowledge.js's disease-label routing. A rule says:
//   "if a person's allergy/disease matches condition_value,
//    exclude/substitute/scale any dish/ingredient tagged action_value.tag"
// The evaluator never invents a dish; it only flags/removes tag matches —
// picking the actual replacement is the caller's job (recommend.js /
// plan-builder.js), so every decision stays traceable back to one rule row.
import { supabaseAdmin } from '../supabase.js';
import { deaccent } from '../knowledge.js';

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 60_000;

export async function loadActiveRules() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  const { data, error } = await supabaseAdmin
    .from('rules')
    .select('*')
    .eq('active', true)
    .order('priority', { ascending: false });
  if (error) throw error;
  _cache = data || [];
  _cacheAt = Date.now();
  return _cache;
}

function personConditionValues(person, conditionType) {
  if (conditionType === 'allergy') return (person.allergies || []).map(deaccent);
  if (conditionType === 'disease') return [deaccent(person.disease || '')].filter(Boolean);
  if (conditionType === 'dislike') return (person.dislikes || []).map(deaccent);
  if (conditionType === 'religion') return [deaccent(person.religion || '')].filter(Boolean);
  return [];
}

function dishHasTag(dish, tag) {
  const tagKey = deaccent(tag);
  return (dish.tags || []).some((t) => deaccent(t) === tagKey || deaccent(t).includes(tagKey));
}

/**
 * Evaluate every active rule for one (person, dish) pair.
 * @param {object[]} [rulesOverride] — pass fixture rules to test the matcher
 *   without touching Supabase; defaults to loadActiveRules().
 * @returns {{allowed:boolean, matches:Array<{rule, reason:string}>}}
 *   `matches` lists EVERY rule that fired (highest priority first);
 *   `allowed=false` when any fired rule's action_type is 'exclude'.
 */
export async function applyRules(person, dish, rulesOverride = null) {
  const rules = rulesOverride || (await loadActiveRules());
  const matches = [];

  for (const rule of rules) {
    const personValues = personConditionValues(person, rule.condition_type);
    if (!personValues.length) continue;
    const conditionKey = deaccent(rule.condition_value);
    const personMatches = personValues.some((v) => v.includes(conditionKey) || conditionKey.includes(v));
    if (!personMatches) continue;

    const tag = rule.action_value?.tag;
    if (tag && !dishHasTag(dish, tag)) continue;

    matches.push({
      rule,
      reason: `${rule.condition_type === 'allergy' ? 'Dị ứng' : 'Bệnh lý'} "${rule.condition_value}" → ${
        rule.action_type === 'exclude' ? 'loại bỏ' : rule.action_type
      } món có nhãn "${tag || rule.condition_value}"`,
    });
  }

  const allowed = !matches.some((m) => m.rule.action_type === 'exclude');
  return { allowed, matches };
}

/** Convenience: does ANY member of a household reject this dish? */
export async function dishAllowedForHousehold(members, dish, rulesOverride = null) {
  const perMemberResults = await Promise.all(members.map((m) => applyRules(m, dish, rulesOverride)));
  const blockingIdx = perMemberResults.findIndex((r) => !r.allowed);
  if (blockingIdx === -1) return { allowed: true, matches: [] };
  return { allowed: false, matches: perMemberResults[blockingIdx].matches, blockedMember: members[blockingIdx] };
}

export default { loadActiveRules, applyRules, dishAllowedForHousehold };
