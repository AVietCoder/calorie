// lib/family-menu/household.js — Household CRUD helpers + family⇄chef mode switching.
//
// Two household "modes" are just a UI/permission label over ONE schema:
//   chef   = owner + dependent members (no login), no invite UI shown
//   family = owner + other real accounts linked in via invite
// Switching modes never migrates data — chef→family only unlocks invites;
// family→chef is blocked while any non-owner linked member still exists,
// since demoting a real account to a dependent silently would take away
// their access without consent.
import { supabaseAdmin } from '../supabase.js';

export async function getHouseholdForUser(userId) {
  const { data: owned } = await supabaseAdmin
    .from('households')
    .select('*')
    .eq('owner_id', userId)
    .maybeSingle();
  if (owned) return owned;

  const { data: membership } = await supabaseAdmin
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .eq('kind', 'linked')
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
    // chef -> family: always allowed, just unlocks the invite UI.
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

export default { getHouseholdForUser, isHouseholdOwner, getMembers, canSwitchMode };
