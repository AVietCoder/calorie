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

import { authenticateToken } from '../../../lib/auth-middleware.js';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { estimateFoodSmart } from '../../../lib/nutrition.js';
import { corsJson, corsOptions } from '../../../lib/cors.js';
import { isValidBirthYear, isValidHeight, isValidWeight } from '../../../lib/body-metrics.js';
import {
  getHouseholdForUser,
  getJoinedHousehold,
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
import { importMenuWorkbook } from '../../../lib/excel/import/index.js';
import { buildExportModel } from '../../../lib/family-menu/plan-export.js';
import { exportPlanWorkbook, exportImportTemplate } from '../../../lib/excel/index.js';
import { MIME_XLSX } from '../../../lib/excel/mime.js';

export const maxDuration = 60;

const asText = (v) => String(v ?? '').trim();
const asList = (v) =>
  asText(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const ok = (data, status = 200) => corsJson(NextResponse, { success: true, data }, { status });
const fail = (status, error) => corsJson(NextResponse, { success: false, error: String(error?.message || error) }, { status });

/* ───────────────────── Excel template ingestion (bộ nhập thông minh) ───────────────────── */

/**
 * Đọc file Excel người dùng tải lên và trả về `days[]` sẵn sàng ghi DB.
 *
 * Toàn bộ việc nhận diện layout đã chuyển sang lib/excel/import/ (pipeline
 * Đọc → Phân tích layout → Nhận diện bảng/ngày/bữa → Chuẩn hoá). Route chỉ còn
 * lo phần nghiệp vụ: bù dinh dưỡng thiếu bằng engine ước tính sẵn có.
 *
 * Định dạng mẫu 16 cột cũ vẫn được nhận diện và xử lý y như trước.
 */
async function parseExcelTemplate(buffer, opts = {}) {
  const { days, report } = await importMenuWorkbook(buffer, opts);

  // Món nào thiếu calories/protein thì nhờ engine dinh dưỡng ước tính — giữ
  // nguyên hành vi cũ, chỉ khác là nay áp dụng cho mọi layout chứ không riêng
  // file mẫu 16 cột.
  const pending = [];
  for (const day of days) {
    for (const meal of day.meals) {
      for (const dish of meal.dishes) {
        if (dish.calories == null || dish.protein == null) pending.push(dish);
      }
    }
  }

  // Giới hạn số lần gọi engine để một file 120 món không làm request timeout.
  const MAX_ESTIMATES = Number(process.env.EXCEL_IMPORT_MAX_ESTIMATES || 60);
  let estimated = 0;
  for (const dish of pending.slice(0, MAX_ESTIMATES)) {
    try {
      const est = await estimateFoodSmart({ food: dish.name });
      if (!est) continue;
      dish.calories = dish.calories ?? est.calories;
      dish.protein = dish.protein ?? stripUnit(est.protein);
      dish.fat = dish.fat ?? stripUnit(est.fat);
      dish.carbs = dish.carbs ?? stripUnit(est.carbs);
      dish.fiber = dish.fiber ?? stripUnit(est.fiber);
      dish.sugar = dish.sugar ?? stripUnit(est.sugar);
      dish.sodium = dish.sodium ?? stripUnit(est.sodium);
      dish.source = est.source || 'excel_import';
      dish.confidence = est.confidence || 'low';
      estimated += 1;
    } catch {
      /* best-effort — để null, chủ hộ/admin sửa sau */
    }
  }

  if (pending.length > MAX_ESTIMATES) {
    report.warnings = [
      ...(report.warnings || []),
      `${pending.length - MAX_ESTIMATES} món chưa được ước tính dinh dưỡng (vượt giới hạn mỗi lần nhập) — có thể bổ sung sau.`,
    ];
  }

  return { days, report: { ...report, estimatedDishes: estimated, pendingEstimates: pending.length } };
}

function stripUnit(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
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
          is_joined_member: false,
          can_create_family: true,
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
        // join_code chỉ dành cho chủ hộ — thành viên không được thấy mã (Ảnh 3.1).
        household: isOwner ? household : { ...household, join_code: null, join_code_updated_at: null },
        members,
        is_owner: isOwner,
        // Đang là thành viên gia đình của NGƯỜI KHÁC -> UI ẩn toàn bộ chức năng
        // tạo gia đình / sinh mã, và hiện nút "Rời gia đình".
        is_joined_member: !isOwner,
        can_create_family: false,
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

    // Xuất Excel: trả BINARY chứ không phải JSON, nên không đi qua ok()/fail().
    if (resource === 'export') {
      return exportPlanToExcel(url);
    }

    if (resource === 'import-template') {
      const { buffer, filename } = await exportImportTemplate();
      return xlsxResponse(buffer, filename);
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
      case 'leave_family':
        return ok(await leaveFamily(user));
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

/**
 * Ảnh 3.1 — người ĐANG là thành viên của gia đình người khác thì KHÔNG được tạo
 * gia đình mới, cũng không được sinh mã tham gia. Phải "Rời gia đình" trước.
 * Đây là chốt chặn phía BE; UI cũng ẩn nút tương ứng.
 */
async function requireNotJoinedElsewhere(user, actionLabel) {
  const joined = await getJoinedHousehold(user.id);
  if (joined) {
    throw new Error(
      `Bạn đang là thành viên của một gia đình khác nên không thể ${actionLabel}. Hãy rời gia đình đó trước.`
    );
  }
}

async function createHousehold(user, body) {
  await requireNotJoinedElsewhere(user, 'tạo gia đình mới');
  const { data: existing } = await supabaseAdmin
    .from('households')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle();
  if (existing) throw new Error('Bạn đã có một gia đình rồi.');

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

// Các cột kiểu `numeric`/`integer` trong household_members. Form gửi lên chuỗi
// RỖNG khi người dùng bỏ trống — `'' != null` nên bản cũ đẩy thẳng '' xuống
// Postgres và nổ `invalid input syntax for type numeric: ""` (Ảnh 2).
const MEMBER_NUMERIC_FIELDS = ['birth_year', 'height', 'weight', 'target_weight', 'activity_level'];

/** '' | null | undefined -> null; còn lại -> số (ném lỗi nếu không phải số). */
function numericOrNull(field, value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Giá trị không hợp lệ ở trường "${field}".`);
  return n;
}

/** Mục tiêu BẮT BUỘC phải có cân nặng mục tiêu. Giữ cân/tăng cơ thì không. */
const GOALS_NEEDING_TARGET = new Set(['lose', 'gain']);
const TARGET_WEIGHT_MIN = 25;
const TARGET_WEIGHT_MAX = 300;

/**
 * Ảnh 2: chỉ bắt nhập target weight khi mục tiêu là giảm/tăng cân, và khi có thì
 * phải hợp lý so với cân nặng hiện tại. Chạy ở BE để client nào cũng bị chặn.
 */
function validateTargetWeight(patch, existing = {}) {
  // Dùng `in` chứ KHÔNG dùng `??`: form gửi target_weight = '' (nghĩa là XOÁ TRẮNG)
  // sẽ thành null trong patch, mà `null ?? existing` lại rơi về giá trị CŨ —
  // validation đậu nhưng cột vẫn bị ghi null. `in` phân biệt đúng
  // "không gửi trường" với "gửi lên để xoá".
  const pick = (field) => (field in patch ? patch[field] : existing[field] ?? null);
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const goal = String(pick('goal') ?? '').trim().split(',')[0];
  if (!GOALS_NEEDING_TARGET.has(goal)) return;

  const target = num(pick('target_weight'));
  if (target == null) {
    throw new Error(
      goal === 'lose'
        ? 'Mục tiêu "Giảm cân" cần có cân nặng mục tiêu.'
        : 'Mục tiêu "Tăng cân" cần có cân nặng mục tiêu.'
    );
  }
  if (target < TARGET_WEIGHT_MIN || target > TARGET_WEIGHT_MAX) {
    throw new Error(`Cân nặng mục tiêu phải trong khoảng ${TARGET_WEIGHT_MIN}–${TARGET_WEIGHT_MAX} kg.`);
  }

  const current = num(pick('weight'));
  if (current == null || current <= 0) return; // chưa biết cân nặng hiện tại thì không so sánh được

  if (goal === 'lose' && target >= current) {
    throw new Error(`Mục tiêu "Giảm cân": cân nặng mục tiêu phải NHỎ HƠN cân nặng hiện tại (${current} kg).`);
  }
  if (goal === 'gain' && target <= current) {
    throw new Error(`Mục tiêu "Tăng cân": cân nặng mục tiêu phải LỚN HƠN cân nặng hiện tại (${current} kg).`);
  }
  // Chênh lệch quá lớn gần như luôn là gõ nhầm (vd 55 -> 5.5 hoặc 550).
  if (target < current * 0.5 || target > current * 1.5) {
    throw new Error(`Cân nặng mục tiêu ${target} kg chênh quá xa so với ${current} kg hiện tại. Hãy kiểm tra lại.`);
  }
}

/**
 * Cảnh báo nếu năm sinh/chiều cao/cân nặng không hợp lý cho một con người.
 * allowChild=true vì thành viên hộ gia đình có thể là trẻ em/em bé (kind='dependent'),
 * khác với hồ sơ chính chủ (signup/setup) luôn là người tự đăng ký.
 * Dùng `in` (không phải `??`) với lý do y hệt validateTargetWeight ở trên.
 */
function validateBodyMetrics(patch, existing = {}) {
  const pick = (field) => (field in patch ? patch[field] : existing[field] ?? null);

  const birthYear = pick('birth_year');
  if (birthYear != null && !isValidBirthYear(birthYear)) {
    throw new Error('Năm sinh không hợp lệ.');
  }
  const height = pick('height');
  if (height != null && !isValidHeight(height, { allowChild: true })) {
    throw new Error('Chiều cao không hợp lệ (phải trong khoảng 40 - 250 cm).');
  }
  const weight = pick('weight');
  if (weight != null && !isValidWeight(weight, { allowChild: true })) {
    throw new Error('Cân nặng không hợp lệ (phải trong khoảng 2 - 300 kg).');
  }
}

function memberPatchFrom(body) {
  const patch = {};
  for (const f of MEMBER_FIELDS) {
    if (body[f] == null) continue;
    patch[f] = MEMBER_NUMERIC_FIELDS.includes(f) ? numericOrNull(f, body[f]) : body[f];
  }
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
  validateBodyMetrics(patch);
  validateTargetWeight(patch);
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
  // So với dòng ĐANG CÓ, vì form sửa có thể chỉ gửi lên một phần các trường.
  validateBodyMetrics(patch, member);
  validateTargetWeight(patch, member);
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

// Ảnh 1: KHÔNG trả `email` ra client nữa — Kitchen chỉ định danh bằng handle
// (profiles.username), vốn đã được chốt vào `display_name` lúc gửi yêu cầu.
// Cột `email` vẫn giữ trong DB (không đổi migration), chỉ là không select ra.
const REQUEST_FIELDS = 'id, household_id, user_id, status, display_name, created_at';

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
  // requireOwnedHousehold đã chặn việc sinh mã cho household của người khác;
  // dòng dưới chặn thêm ca "vừa sở hữu household riêng vừa là thành viên nơi khác".
  await requireNotJoinedElsewhere(user, 'tạo mã tham gia');
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

  // Một người chỉ thuộc MỘT gia đình. Chặn ở đây để không sinh ra trạng thái
  // "vừa sở hữu household riêng vừa là thành viên nơi khác" như user trong Ảnh 3.
  const joined = await getJoinedHousehold(user.id);
  if (joined) throw new Error('Bạn đang ở trong một gia đình khác. Hãy rời gia đình đó trước khi tham gia gia đình mới.');

  const { data: owned } = await supabaseAdmin
    .from('households')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle();
  if (owned) throw new Error('Bạn đang là chủ hộ của một gia đình. Hãy xoá gia đình của bạn trước khi tham gia gia đình khác.');

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

/**
 * Ảnh 3.1 — "Rời gia đình". Đây là lối thoát DUY NHẤT để một thành viên có thể
 * quay lại tự tạo gia đình / sinh mã tham gia.
 *
 *  - Là thành viên gia đình người khác  -> xoá dòng household_members của mình.
 *  - Là CHỦ HỘ và không còn ai khác     -> xoá luôn household (cascade theo FK).
 *  - Là CHỦ HỘ mà vẫn còn thành viên    -> chặn, y hệt luật của canSwitchMode:
 *    không tự ý cắt quyền truy cập của tài khoản thật mà họ không đồng ý.
 */
async function leaveFamily(user) {
  const joined = await getJoinedHousehold(user.id);
  if (joined) {
    const { error } = await supabaseAdmin
      .from('household_members')
      .delete()
      .eq('household_id', joined.id)
      .eq('user_id', user.id)
      .eq('kind', 'linked');
    if (error) throw error;
    return { left: true, household_id: joined.id, deleted_household: false };
  }

  const { data: owned } = await supabaseAdmin
    .from('households')
    .select('*')
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!owned) throw new Error('Bạn chưa thuộc gia đình nào.');

  const { data: linked, error: lErr } = await supabaseAdmin
    .from('household_members')
    .select('id, user_id')
    .eq('household_id', owned.id)
    .eq('kind', 'linked');
  if (lErr) throw lErr;
  const others = (linked || []).filter((m) => m.user_id && m.user_id !== user.id);
  if (others.length > 0) {
    throw new Error('Vẫn còn thành viên khác trong gia đình của bạn. Hãy xoá họ khỏi gia đình trước khi rời đi.');
  }

  const { error } = await supabaseAdmin.from('households').delete().eq('id', owned.id);
  if (error) throw error;
  return { left: true, household_id: owned.id, deleted_household: true };
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

  // Người dùng có thể tắt AI (nhanh hơn, rẻ hơn) khi biết file theo mẫu chuẩn.
  const useAI = asText(body.use_ai) !== 'false';
  const { days, report } = await parseExcelTemplate(buffer, {
    useAI,
    sheetName: asText(body.sheet_name) || undefined,
  });
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
  await logImport(user, template, fileEntry, report);

  // Trả kèm report để UI hiển thị "đã nhận diện 7 ngày / 63 món bằng layout X"
  // — người dùng thấy ngay hệ thống hiểu đúng hay sai thay vì phải mở lại.
  return { ...template, import_report: report };
}

/** Ghi nhật ký nhập file. Lỗi ở đây KHÔNG được làm hỏng lần nhập đã thành công. */
async function logImport(user, template, fileEntry, report) {
  try {
    await supabaseAdmin.from('menu_import_logs').insert({
      template_id: template.id,
      user_id: user.id,
      filename: fileEntry?.name || null,
      sheet_name: report.sheet || null,
      strategy: report.strategy || null,
      layout: report.layout || null,
      confidence: report.confidence ?? null,
      day_count: report.dayCount ?? null,
      dish_count: report.dishCount ?? null,
      warnings: report.warnings || [],
      report,
    });
  } catch (err) {
    console.warn(`⚠️ [family-menu] không ghi được menu_import_logs: ${err.message}`);
  }
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

/* ───────────────────────── Xuất Excel ───────────────────────── */

/**
 * GET /api/family-menu?resource=export&plan_id=…[&sheets=menu,shopping][&servings=6][&start_date=2026-07-27]
 *
 * `sheets` cho phép xuất một phần (ví dụ chỉ danh sách đi chợ để in mang đi).
 * `servings` cho phép đổi số suất NGAY LÚC XUẤT mà không phải sinh lại kế
 * hoạch — mọi định lượng và danh sách mua được nhân lại theo hệ số.
 */
async function exportPlanToExcel(url) {
  const planId = url.searchParams.get('plan_id');
  if (!planId) return fail(400, 'Thiếu plan_id');

  const sheets = (url.searchParams.get('sheets') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const servings = url.searchParams.get('servings');
  const startDate = url.searchParams.get('start_date');

  const model = await buildExportModel(planId, {
    servings: servings ? Number(servings) : undefined,
    startDate: startDate || undefined,
  });

  const { buffer, filename } = await exportPlanWorkbook(model, { sheets });
  return xlsxResponse(buffer, filename);
}

/**
 * Tên file có dấu tiếng Việt phải đi qua `filename*=UTF-8''…` (RFC 5987);
 * `filename=` thuần ASCII giữ lại làm phương án dự phòng cho trình duyệt cũ.
 */
function xlsxResponse(buffer, filename) {
  const asciiName = filename.replace(/[^\x20-\x7E]/g, '_');
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': MIME_XLSX,
      'Content-Length': String(buffer.length),
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Disposition',
    },
  });
}
