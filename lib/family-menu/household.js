// lib/family-menu/household.js — Household CRUD helpers + family⇄chef mode switching.
//
// Two household "modes" are just a UI/permission label over ONE schema:
//   chef   = owner + dependent members (no login), no join code UI shown
//   family = owner + other real accounts that joined via the 6-digit join code
// Switching modes never migrates data — chef→family only unlocks the join code
// UI; family→chef is blocked while any non-owner linked member still exists,
// since demoting a real account to a dependent silently would take away
// their access without consent.
import { randomInt } from 'node:crypto';

import { supabaseAdmin } from '../supabase.js';

export async function getHouseholdForUser(userId) {
  const { data: owned } = await supabaseAdmin
    .from('households')
    .select('*')
    .eq('owner_id', userId)
    .maybeSingle();
  if (owned) return owned;

  // limit(1): a user may be linked into more than one household (joining another
  // family doesn't remove them from their current one), and a bare maybeSingle()
  // throws on multiple rows — which would break every page that loads a household.
  const { data: membership } = await supabaseAdmin
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .eq('kind', 'linked')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) return null;

  const { data: household } = await supabaseAdmin
    .from('households')
    .select('*')
    .eq('id', membership.household_id)
    .maybeSingle();
  return household || null;
}

export async function isHouseholdOwner(userId, householdId) {
  const { data } = await supabaseAdmin
    .from('households')
    .select('id')
    .eq('id', householdId)
    .eq('owner_id', userId)
    .maybeSingle();
  return !!data;
}

export async function getMembers(householdId) {
  const { data, error } = await supabaseAdmin
    .from('household_members')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Can `household` switch to `targetMode`?
 * @returns {Promise<{ok:true} | {ok:false, message:string}>}
 */
export async function canSwitchMode(household, targetMode) {
  if (household.mode === targetMode) return { ok: true };

  if (targetMode === 'family') {
    // chef -> family: always allowed, just unlocks the join code UI.
    return { ok: true };
  }

  if (targetMode === 'chef') {
    const { data, error } = await supabaseAdmin
      .from('household_members')
      .select('id, user_id')
      .eq('household_id', household.id)
      .eq('kind', 'linked');
    if (error) throw error;
    const others = (data || []).filter((m) => m.user_id !== household.owner_id);
    if (others.length > 0) {
      return {
        ok: false,
        message: 'Vẫn còn thành viên khác đã liên kết tài khoản. Hãy xóa họ khỏi gia đình trước khi chuyển về Chế độ đầu bếp.',
      };
    }
    return { ok: true };
  }

  return { ok: false, message: 'Chế độ không hợp lệ.' };
}

/* ───────────────────────── join code (6-digit numeric) ───────────────────────── */

export const JOIN_CODE_RE = /^[0-9]{6}$/;

/** "483921" — digits only, leading zeros preserved. */
function randomJoinCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * A fresh 6-digit code not currently held by any household. Uniqueness is also
 * enforced by idx_households_join_code, so the loop is an optimization that
 * keeps the common case from ever hitting a constraint violation.
 */
export async function generateUniqueJoinCode(attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    const code = randomJoinCode();
    const { data } = await supabaseAdmin.from('households').select('id').eq('join_code', code).maybeSingle();
    if (!data) return code;
  }
  throw new Error('Không tạo được mã tham gia mới. Vui lòng thử lại.');
}

/**
 * Issue a new code for `householdId`, invalidating the old one immediately
 * (there is only ever one active code per household — it's a single column).
 */
export async function regenerateJoinCode(householdId) {
  const code = await generateUniqueJoinCode();
  const { data, error } = await supabaseAdmin
    .from('households')
    .update({ join_code: code, join_code_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Households created before this feature (or before the migration ran) have no code yet. */
export async function ensureJoinCode(household) {
  if (household?.join_code) return household;
  return regenerateJoinCode(household.id);
}

export async function findHouseholdByJoinCode(code) {
  const { data } = await supabaseAdmin.from('households').select('*').eq('join_code', code).maybeSingle();
  return data || null;
}

export default {
  getHouseholdForUser,
  isHouseholdOwner,
  getMembers,
  canSwitchMode,
  generateUniqueJoinCode,
  regenerateJoinCode,
  ensureJoinCode,
  findHouseholdByJoinCode,
  JOIN_CODE_RE,
};
