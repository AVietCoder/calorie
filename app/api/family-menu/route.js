/**
 * app/api/family-menu/route.js — replaces api/family-menu.js (AI Personalized
 * Weekly Menu Planner: household + menu template library + rule engine +
 * recommendation engine + audit). Same action-multiplexed contract as before;
 * only the request/response plumbing changed for the Next.js Route Handler
 * (Web Request/Response) API — multipart now uses the native
 * `request.formData()` instead of `formidable`, since Route Handlers don't
 * expose a raw Node stream for formidable to parse.
 *
 * AI is NEVER used to invent a menu here. Templates are curated (Excel/form
 * upload); a plan is always built by selecting + scaling + rule-adjusting a
 * template (lib/family-menu/plan-builder.js). Every adjustment is written to
 * menu_adjustment_audit.
 *
 * GET  ?resource=household                       -> current user's household + members
 *                                                    (+ join code & pending join
 *                                                     requests when owner)
 * GET  ?resource=join-requests&household_id=      -> pending join requests (owner only)
 * GET  ?resource=templates[&tag=]                 -> ranked template list
 * GET  ?resource=template&id=                     -> full template detail
 * GET  ?resource=plan&household_id=                -> latest active plan for household
 * GET  ?resource=plan-audit&plan_id=
 * GET  ?resource=shopping-list&plan_id=
 *
 * POST { action: 'create_household' | 'update_household' | 'set_household_mode' |
 *                'add_member' | 'update_member' | 'remove_member' |
 *                'regenerate_join_code' | 'join_by_code' |
 *                'approve_join_request' | 'reject_join_request' |
 *                'upload_template_excel' (multipart) | 'create_template_manual' |
 *                'generate_plan' | 'regenerate_plan' | 'swap_dish', ... }
 */
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

import { authenticateToken } from '../../../lib/auth-middleware.js';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { estimateFoodSmart } from '../../../lib/nutrition.js';
import { corsJson, corsOptions } from '../../../lib/cors.js';
import {
  getHouseholdForUser,
  isHouseholdOwner,
  getMembers,
  canSwitchMode,
  generateUniqueJoinCode,
  regenerateJoinCode,
  ensureJoinCode,
  findHouseholdByJoinCode,
  JOIN_CODE_RE,
} from '../../../lib/family-menu/household.js';
import { recommendTemplates } from '../../../lib/family-menu/recommend.js';
import {
  loadTemplateFull,
  generatePlan,
  regeneratePlan,
  swapDish,
  buildShoppingList,
} from '../../../lib/family-menu/plan-builder.js';

export const maxDuration = 60;

const asText = (v) => String(v ?? '').trim();
const asList = (v) =>
  asText(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const ok = (data, status = 200) => corsJson(NextResponse, { success: true, data }, { status });
const fail = (status, error) => corsJson(NextResponse, { success: false, error: String(error?.message || error) }, { status });

/* ───────────────────────── Excel template ingestion ───────────────────────── */

async function parseExcelTemplate(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const dishKey = (r) => `${r.day_index}::${r.meal_type}::${String(r.dish_name).trim().toLowerCase()}`;
  const dishesByKey = new Map();
  const order = [];

  for (const r of rows) {
    const key = dishKey(r);
    if (!dishesByKey.has(key)) {
      dishesByKey.set(key, {
        day_index: Number(r.day_index),
        meal_type: String(r.meal_type).trim().toLowerCase(),
        name: String(r.dish_name).trim(),
        base_grams: numOrNull(r.base_grams),
        calories: numOrNull(r.calories),
        protein: numOrNull(r.protein),
        fat: numOrNull(r.fat),
        carbs: numOrNull(r.carbs),
        fiber: numOrNull(r.fiber),
        sugar: numOrNull(r.sugar),
        sodium: numOrNull(r.sodium),
        tags: asListLocal(r.dish_tags),
        ingredients: [],
      });
      order.push(key);
    }
    const dish = dishesByKey.get(key);
    if (r.ingredient_name) {
      dish.ingredients.push({
        name: String(r.ingredient_name).trim(),
        grams: numOrNull(r.ingredient_grams),
        unit: String(r.ingredient_unit || 'g').trim(),
        tags: asListLocal(r.ingredient_tags),
      });
    }
  }

  for (const key of order) {
    const dish = dishesByKey.get(key);
    if (dish.calories == null || dish.protein == null) {
      try {
        const est = await estimateFoodSmart({ food: dish.name });
        if (est) {
          dish.calories = dish.calories ?? est.calories;
          dish.protein = dish.protein ?? stripUnit(est.protein);
          dish.fat = dish.fat ?? stripUnit(est.fat);
          dish.carbs = dish.carbs ?? stripUnit(est.carbs);
          dish.fiber = dish.fiber ?? stripUnit(est.fiber);
          dish.sugar = dish.sugar ?? stripUnit(est.sugar);
          dish.sodium = dish.sodium ?? stripUnit(est.sodium);
          dish.source = est.source;
          dish.confidence = est.confidence;
        }
      } catch {
        /* best-effort — leave nulls, admin/owner can fix later */
      }
    }
  }

  const byDayMeal = new Map();
  for (const key of order) {
    const dish = dishesByKey.get(key);
    const dmKey = `${dish.day_index}::${dish.meal_type}`;
    if (!byDayMeal.has(dmKey)) byDayMeal.set(dmKey, { day_index: dish.day_index, meal_type: dish.meal_type, dishes: [] });
    byDayMeal.get(dmKey).dishes.push(dish);
  }

  const byDay = new Map();
  for (const dm of byDayMeal.values()) {
    if (!byDay.has(dm.day_index)) byDay.set(dm.day_index, { day_index: dm.day_index, meals: [] });
    byDay.get(dm.day_index).meals.push(dm);
  }

  return [...byDay.values()].sort((a, b) => a.day_index - b.day_index);
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function stripUnit(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function asListLocal(v) {
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function persistTemplateDays(templateId, days) {
  for (const day of days) {
    const { data: dayRow, error: dErr } = await supabaseAdmin
      .from('menu_template_days')
      .insert({ template_id: templateId, day_index: day.day_index })
      .select()
      .single();
    if (dErr) throw dErr;

    for (const meal of day.meals) {
      const { data: mealRow, error: mErr } = await supabaseAdmin
        .from('menu_template_meals')
        .insert({ template_day_id: dayRow.id, meal_type: meal.meal_type })
        .select()
        .single();
      if (mErr) throw mErr;

      for (const dish of meal.dishes) {
        const { data: dishRow, error: dishErr } = await supabaseAdmin
          .from('menu_template_dishes')
          .insert({
            template_meal_id: mealRow.id,
            name: dish.name,
            base_grams: dish.base_grams,
            calories: dish.calories,
            protein: dish.protein,
            fat: dish.fat,
            carbs: dish.carbs,
            fiber: dish.fiber,
            sugar: dish.sugar,
            sodium: dish.sodium,
            tags: dish.tags,
            source: dish.source || 'manual',
            confidence: dish.confidence || 'medium',
          })
          .select()
          .single();
        if (dishErr) throw dishErr;

        if (dish.ingredients?.length) {
          const { error: ingErr } = await supabaseAdmin
            .from('menu_template_dish_ingredients')
            .insert(dish.ingredients.map((i) => ({ dish_id: dishRow.id, ...i })));
          if (ingErr) throw ingErr;
        }
      }
    }
  }
}

/* ───────────────────────── handler ───────────────────────── */

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

export async function GET(request) {
  const user = await authenticateToken(request);
  if (!user) return fail(401, 'Unauthorized');

  try {
    const url = new URL(request.url);
    const resource = url.searchParams.get('resource');

    if (resource === 'household') {
      let household = await getHouseholdForUser(user.id);
      // A user with no household still needs my_pending_request so the join
      // screen can render "waiting for the owner's approval" instead of the form.
      if (!household) {
        return ok({
          household: null,
          members: [],
          is_owner: false,
          join_requests: [],
          my_pending_request: await getMyPendingRequest(user.id),
        });
      }

      const isOwner = household.owner_id === user.id;
      // Households created before migrations/family_join_code.sql ran have no
      // code yet — mint one lazily the first time the owner opens the page.
      if (isOwner && household.mode === 'family' && !household.join_code) {
        household = await ensureJoinCode(household);
      }

      const members = await getMembers(household.id);
      return ok({
        household: isOwner ? household : { ...household, join_code: null, join_code_updated_at: null },
        members,
        is_owner: isOwner,
        join_requests: isOwner ? await getPendingRequests(household.id) : [],
        my_pending_request: await getMyPendingRequest(user.id),
      });
    }

    if (resource === 'join-requests') {
      const householdId = url.searchParams.get('household_id');
      await requireOwnedHousehold(user, householdId);
      return ok(await getPendingRequests(householdId));
    }

    if (resource === 'templates') {
      const household = await getHouseholdForUser(user.id);
      if (!household) return fail(400, 'Chưa có household — tạo household trước.');
      const members = await getMembers(household.id);
      const tag = url.searchParams.get('tag') || undefined;
      const ranked = await recommendTemplates(household, members, { filters: { tag } });
      return ok(ranked);
    }

    if (resource === 'template') {
      const id = url.searchParams.get('id');
      if (!id) return fail(400, 'Thiếu id');
      const template = await loadTemplateFull(id);
      return ok(template);
    }

    if (resource === 'plan') {
      const householdId = url.searchParams.get('household_id');
      if (!householdId) return fail(400, 'Thiếu household_id');
      const { data: plan, error } = await supabaseAdmin
        .from('weekly_menu_plans')
        .select('*, plan_days(*, plan_meals(*, plan_dishes(*, plan_dish_ingredients(*))))')
        .eq('household_id', householdId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return ok(plan || null);
    }

    if (resource === 'plan-audit') {
      const planId = url.searchParams.get('plan_id');
      if (!planId) return fail(400, 'Thiếu plan_id');
      const { data, error } = await supabaseAdmin
        .from('menu_adjustment_audit')
        .select('*')
        .eq('plan_id', planId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ok(data || []);
    }

    if (resource === 'shopping-list') {
      const planId = url.searchParams.get('plan_id');
      if (!planId) return fail(400, 'Thiếu plan_id');
      const { data: existing } = await supabaseAdmin
        .from('shopping_lists')
        .select('*, shopping_list_items(*)')
        .eq('plan_id', planId)
        .maybeSingle();
      if (existing) return ok(existing);
      const built = await buildShoppingList(planId);
      return ok(built);
    }

    return fail(400, `resource không hợp lệ: ${resource}`);
  } catch (err) {
    console.error('[family-menu] GET error:', err);
    return fail(500, err);
  }
}

export async function POST(request) {
  const user = await authenticateToken(request);
  if (!user) return fail(401, 'Unauthorized');

  try {
    const contentType = request.headers.get('content-type') || '';
    let body = {};
    let files = null; // native FormData when multipart

    if (contentType.includes('multipart/form-data')) {
      files = await request.formData();
      body = {};
      for (const [key, value] of files.entries()) {
        if (typeof value === 'string') body[key] = value;
      }
    } else {
      body = await request.json().catch(() => ({}));
    }

    const action = asText(body.action) || body.action;

    switch (action) {
      case 'create_household':
        return ok(await createHousehold(user, body));
      case 'update_household':
        return ok(await updateHousehold(user, body));
      case 'set_household_mode':
        return ok(await setHouseholdMode(user, body));
      case 'add_member':
        return ok(await addMember(user, body));
      case 'update_member':
        return ok(await updateMember(user, body));
      case 'remove_member':
        return ok(await removeMember(user, body));
      case 'regenerate_join_code':
        return ok(await regenerateHouseholdJoinCode(user, body));
      case 'join_by_code':
        return ok(await joinByCode(user, body));
      case 'approve_join_request':
        return ok(await approveJoinRequest(user, body));
      case 'reject_join_request':
        return ok(await rejectJoinRequest(user, body));
      case 'upload_template_excel':
        return ok(await uploadTemplateExcel(user, body, files));
      case 'create_template_manual':
        return ok(await createTemplateManual(user, body));
      case 'generate_plan':
        return ok(
          await generatePlan({
            household: await requireOwnedHousehold(user, body.household_id),
            templateId: body.template_id || undefined,
          })
        );
      case 'regenerate_plan':
        return ok(
          await regeneratePlan({
            planId: body.plan_id,
            scope: body.scope,
            dayIndex: body.day_index,
            mealType: body.meal_type,
            planDishId: body.plan_dish_id,
          })
        );
      case 'swap_dish':
        return ok(await swapDish({ planDishId: body.plan_dish_id, replacementDishId: body.replacement_dish_id }));
      default:
        return fail(400, `action không hợp lệ: ${action}`);
    }
  } catch (err) {
    console.error('[family-menu] POST error:', err);
    return fail(500, err);
  }
}

/* ───────────────────────── action implementations ───────────────────────── */

async function requireOwnedHousehold(user, householdId) {
  if (!householdId) throw new Error('Thiếu household_id');
  const owner = await isHouseholdOwner(user.id, householdId);
  if (!owner) throw new Error('Chỉ chủ hộ mới có quyền thực hiện hành động này.');
  const { data, error } = await supabaseAdmin.from('households').select('*').eq('id', householdId).single();
  if (error) throw error;
  return data;
}

async function createHousehold(user, body) {
  const mode = body.mode === 'family' ? 'family' : 'chef';
  const { data, error } = await supabaseAdmin
    .from('households')
    .insert({
      owner_id: user.id,
      mode,
      region: asText(body.region) || null,
      budget_week: body.budget_week ? Number(body.budget_week) : null,
      cooking_skill: asText(body.cooking_skill) || null,
      meals_per_day: body.meals_per_day ? Number(body.meals_per_day) : 3,
      // Every family gets its 6-digit join code up front (chef mode too, so
      // switching to family mode later needs no extra step).
      join_code: await generateUniqueJoinCode(),
      join_code_updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;

  await supabaseAdmin.from('household_members').insert({
    household_id: data.id,
    kind: 'linked',
    user_id: user.id,
    display_name: asText(body.owner_display_name) || 'Chủ hộ',
  });

  return data;
}

async function updateHousehold(user, body) {
  const household = await requireOwnedHousehold(user, body.household_id);
  const patch = {};
  for (const f of ['region', 'cooking_skill']) if (body[f] != null) patch[f] = asText(body[f]);
  if (body.budget_week != null) patch.budget_week = Number(body.budget_week);
  if (body.meals_per_day != null) patch.meals_per_day = Number(body.meals_per_day);
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin.from('households').update(patch).eq('id', household.id).select().single();
  if (error) throw error;
  return data;
}

async function setHouseholdMode(user, body) {
  const household = await requireOwnedHousehold(user, body.household_id);
  const targetMode = body.mode === 'family' ? 'family' : 'chef';
  const check = await canSwitchMode(household, targetMode);
  if (!check.ok) throw new Error(check.message);

  const { data, error } = await supabaseAdmin
    .from('households')
    .update({ mode: targetMode, updated_at: new Date().toISOString() })
    .eq('id', household.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

const MEMBER_FIELDS = [
  'display_name', 'relation', 'birth_year', 'gender', 'height', 'weight', 'target_weight',
  'goal', 'activity_level', 'disease', 'religion',
];

function memberPatchFrom(body) {
  const patch = {};
  for (const f of MEMBER_FIELDS) if (body[f] != null) patch[f] = body[f];
  if (body.allergies != null) patch.allergies = Array.isArray(body.allergies) ? body.allergies : asList(body.allergies);
  if (body.medications != null) patch.medications = Array.isArray(body.medications) ? body.medications : asList(body.medications);
  if (body.dislikes != null) patch.dislikes = Array.isArray(body.dislikes) ? body.dislikes : asList(body.dislikes);
  if (body.likes != null) patch.likes = Array.isArray(body.likes) ? body.likes : asList(body.likes);
  return patch;
}

async function addMember(user, body) {
  const household = await requireOwnedHousehold(user, body.household_id);
  const patch = memberPatchFrom(body);
  if (!patch.display_name) throw new Error('Thiếu tên thành viên.');
  const { data, error } = await supabaseAdmin
    .from('household_members')
    .insert({ household_id: household.id, kind: 'dependent', ...patch })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateMember(user, body) {
  if (!body.member_id) throw new Error('Thiếu member_id');
  const { data: member, error: mErr } = await supabaseAdmin.from('household_members').select('*').eq('id', body.member_id).single();
  if (mErr) throw mErr;
  await requireOwnedHousehold(user, member.household_id);
  const patch = memberPatchFrom(body);
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('household_members').update(patch).eq('id', body.member_id).select().single();
  if (error) throw error;
  return data;
}

async function removeMember(user, body) {
  if (!body.member_id) throw new Error('Thiếu member_id');
  const { data: member, error: mErr } = await supabaseAdmin.from('household_members').select('*').eq('id', body.member_id).single();
  if (mErr) throw mErr;
  const household = await requireOwnedHousehold(user, member.household_id);
  if (member.user_id === household.owner_id) throw new Error('Không thể xóa chủ hộ.');
  const { error } = await supabaseAdmin.from('household_members').delete().eq('id', body.member_id);
  if (error) throw error;
  return { removed: true };
}

/* ─────────────── join code: request → owner approval → membership ─────────────── */

const REQUEST_FIELDS = 'id, household_id, user_id, status, display_name, email, created_at';

async function getPendingRequests(householdId) {
  const { data, error } = await supabaseAdmin
    .from('household_join_requests')
    .select(REQUEST_FIELDS)
    .eq('household_id', householdId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getMyPendingRequest(userId) {
  const { data } = await supabaseAdmin
    .from('household_join_requests')
    .select(REQUEST_FIELDS)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

/** Best-effort label for the owner's pending-request list, snapshotted at request time. */
async function requesterIdentity(user) {
  let username = null;
  try {
    const { data } = await supabaseAdmin.from('profiles').select('username').eq('id', user.id).maybeSingle();
    username = data?.username || null;
  } catch {
    /* profile is optional — fall through to auth metadata */
  }
  const email = user.email || null;
  const display_name =
    asText(username) || asText(user.user_metadata?.display_name) || (email ? email.split('@')[0] : '') || 'Thành viên';
  return { display_name, email };
}

async function isLinkedMember(householdId, userId) {
  const { data } = await supabaseAdmin
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .eq('kind', 'linked')
    .maybeSingle();
  return !!data;
}

async function regenerateHouseholdJoinCode(user, body) {
  const household = await requireOwnedHousehold(user, body.household_id);
  // Overwriting the column IS the invalidation — there is only ever one active
  // code per household, so the previous one stops resolving immediately.
  return regenerateJoinCode(household.id);
}

async function joinByCode(user, body) {
  const code = asText(body.code);
  if (!JOIN_CODE_RE.test(code)) throw new Error('Mã tham gia phải gồm đúng 6 chữ số.');

  const household = await findHouseholdByJoinCode(code);
  if (!household) throw new Error('Mã tham gia không tồn tại hoặc đã hết hạn.');

  if (household.owner_id === user.id) throw new Error('Đây là gia đình của bạn rồi.');
  if (await isLinkedMember(household.id, user.id)) throw new Error('Bạn đã là thành viên của gia đình này.');

  const { data: existing } = await supabaseAdmin
    .from('household_join_requests')
    .select('id')
    .eq('household_id', household.id)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .maybeSingle();
  if (existing) throw new Error('Bạn đã gửi yêu cầu rồi — đang chờ chủ hộ duyệt.');

  const identity = await requesterIdentity(user);
  const { data, error } = await supabaseAdmin
    .from('household_join_requests')
    .insert({ household_id: household.id, user_id: user.id, status: 'pending', ...identity })
    .select(REQUEST_FIELDS)
    .single();
  if (error) throw error;
  return data;
}

async function loadPendingRequestForOwner(user, requestId) {
  if (!requestId) throw new Error('Thiếu request_id');
  const { data: req, error } = await supabaseAdmin
    .from('household_join_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw error;
  if (!req) throw new Error('Yêu cầu không tồn tại.');
  if (req.status !== 'pending') throw new Error('Yêu cầu này đã được xử lý.');
  const household = await requireOwnedHousehold(user, req.household_id);
  return { req, household };
}

async function approveJoinRequest(user, body) {
  const { req, household } = await loadPendingRequestForOwner(user, body.request_id);

  // Tolerate the race where the user was linked in by some other path already.
  if (!(await isLinkedMember(household.id, req.user_id))) {
    const { error: insErr } = await supabaseAdmin.from('household_members').insert({
      household_id: household.id,
      kind: 'linked',
      user_id: req.user_id,
      display_name: req.display_name || req.email || 'Thành viên',
    });
    if (insErr) throw insErr;
  }

  const { error } = await supabaseAdmin
    .from('household_join_requests')
    .update({ status: 'accepted', decided_at: new Date().toISOString(), decided_by: user.id })
    .eq('id', req.id);
  if (error) throw error;

  // A household that gains a real linked account is a family by definition.
  await supabaseAdmin.from('households').update({ mode: 'family' }).eq('id', household.id).eq('mode', 'chef');

  return { approved: true, request_id: req.id, user_id: req.user_id };
}

async function rejectJoinRequest(user, body) {
  const { req } = await loadPendingRequestForOwner(user, body.request_id);
  // Rejection removes the request outright so the user is free to try again.
  const { error } = await supabaseAdmin.from('household_join_requests').delete().eq('id', req.id);
  if (error) throw error;
  return { rejected: true, request_id: req.id };
}

async function uploadTemplateExcel(user, body, files) {
  const fileEntry = files?.get('file');
  if (!fileEntry) throw new Error('Thiếu file Excel.');
  const buffer = Buffer.from(await fileEntry.arrayBuffer());
  const days = await parseExcelTemplate(buffer);
  if (!days.length) throw new Error('File Excel không có dữ liệu hợp lệ.');

  const visibility = asText(body.visibility) === 'private' ? 'private' : 'public';
  let ownerHouseholdId = null;
  if (visibility === 'private' || body.household_id) {
    const household = await requireOwnedHousehold(user, asText(body.household_id));
    ownerHouseholdId = household.id;
  }

  const { data: template, error } = await supabaseAdmin
    .from('menu_templates')
    .insert({
      title: asText(body.title) || 'Menu chưa đặt tên',
      tags: asList(body.tags),
      disease_target: asList(body.disease_target),
      status: 'published',
      visibility,
      owner_household_id: ownerHouseholdId,
      source: 'excel_upload',
      created_by: user.id,
    })
    .select()
    .single();
  if (error) throw error;

  await persistTemplateDays(template.id, days);
  return template;
}

async function createTemplateManual(user, body) {
  const visibility = body.visibility === 'private' ? 'private' : 'public';
  let ownerHouseholdId = null;
  if (visibility === 'private' || body.household_id) {
    const household = await requireOwnedHousehold(user, body.household_id);
    ownerHouseholdId = household.id;
  }

  const { data: template, error } = await supabaseAdmin
    .from('menu_templates')
    .insert({
      title: asText(body.title) || 'Menu chưa đặt tên',
      tags: Array.isArray(body.tags) ? body.tags : asList(body.tags),
      disease_target: Array.isArray(body.disease_target) ? body.disease_target : asList(body.disease_target),
      status: 'published',
      visibility,
      owner_household_id: ownerHouseholdId,
      source: 'admin_form',
      created_by: user.id,
    })
    .select()
    .single();
  if (error) throw error;

  if (Array.isArray(body.days)) await persistTemplateDays(template.id, body.days);
  return template;
}
