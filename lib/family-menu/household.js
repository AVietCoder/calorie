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

/**
 * Household mà user đang thuộc về.
 *
 * THỨ TỰ ƯU TIÊN: gia đình ĐÃ THAM GIA (household của người khác) ĐỨNG TRƯỚC
 * household do chính mình sở hữu. Trước đây ngược lại, nên một người vừa sở hữu
 * household riêng vừa tham gia gia đình khác vẫn thấy Kitchen của chính mình
 * ("Kitchen gần như không thay đổi gì" — Ảnh 3). Xem thêm getJoinedHousehold().
 */
export async function getHouseholdForUser(userId) {
  const joined = await getJoinedHousehold(userId);
  if (joined) return joined;

  const { data: owned } = await supabaseAdmin
    .from('households')
    .select('*')
    .eq('owner_id', userId)
    .maybeSingle();
  return owned || null;
}

/**
 * Household của NGƯỜI KHÁC mà user đã được duyệt vào (kind='linked' và không
 * phải chủ hộ). Trả null nếu user chỉ ở trong household của chính mình.
 *
 * Đây là "nguồn sự thật" cho phân quyền: ai có joined household thì là MEMBER —
 * không được tạo gia đình mới, không được sinh mã tham gia.
 */
export async function getJoinedHousehold(userId) {
  // limit(1): dữ liệu cũ có thể còn user nằm trong nhiều household (xem
  // migrations/family_single_membership.sql); maybeSingle() trần sẽ ném lỗi khi
  // có >1 dòng và làm hỏng mọi trang đang load household.
  const { data: memberships } = await supabaseAdmin
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .eq('kind', 'linked')
    .order('created_at', { ascending: true });

  for (const m of memberships || []) {
    const { data: household } = await supabaseAdmin
      .from('households')
      .select('*')
      .eq('id', m.household_id)
      .maybeSingle();
    if (household && household.owner_id !== userId) return household;
  }
  return null;
}

/**
 * Có quyền ĐỌC dữ liệu của household không: chủ hộ hoặc thành viên đã liên kết
 * tài khoản. Thực đơn và danh sách đi chợ là của chung cả nhà.
 */
export async function isHouseholdMember(userId, householdId) {
  if (!userId || !householdId) return false;
  if (await isHouseholdOwner(userId, householdId)) return true;
  const { data } = await supabaseAdmin
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .eq('kind', 'linked')
    .maybeSingle();
  return !!data;
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

/**
 * Thành viên của household, kèm `handle` (profiles.username) cho các thành viên
 * đã liên kết tài khoản. Kitchen hiển thị handle chứ KHÔNG hiển thị email.
 */
export async function getMembers(householdId) {
  const { data, error } = await supabaseAdmin
    .from('household_members')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const members = data || [];

  const userIds = [...new Set(members.map((m) => m.user_id).filter(Boolean))];
  if (userIds.length === 0) return members.map((m) => ({ ...m, handle: null }));

  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, username')
    .in('id', userIds);
  const handleById = new Map((profiles || []).map((p) => [p.id, p.username || null]));

  return members.map((m) => ({ ...m, handle: m.user_id ? handleById.get(m.user_id) || null : null }));
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
  getJoinedHousehold,
  isHouseholdOwner,
  isHouseholdMember,
  getMembers,
  canSwitchMode,
  generateUniqueJoinCode,
  regenerateJoinCode,
  ensureJoinCode,
  findHouseholdByJoinCode,
  JOIN_CODE_RE,
};
