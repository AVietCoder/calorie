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
import { isAdminUser } from '../../../lib/admin-auth.js';
import { uploadImage, cloudinaryConfigured } from '../../../lib/cloudinary.js';
import { categoryFromName } from '../../../lib/family-menu/menu-categories.js';
import { canEditTemplate, templateEditDenial, DENY_MESSAGES } from '../../../lib/family-menu/menu-permissions.js';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { estimateFoodSmart } from '../../../lib/nutrition.js';
import { corsJson, corsOptions } from '../../../lib/cors.js';
import { isValidBirthYear, isValidHeight, isValidWeight } from '../../../lib/body-metrics.js';
import {
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
} from '../../../lib/family-menu/household.js';
import { recommendTemplates } from '../../../lib/family-menu/recommend.js';
import {
  loadTemplateFull,
  generatePlan,
  regeneratePlan,
  swapDish,
  buildShoppingList,
  buildTemplateShoppingList,
  buildDailyChecklists,
  planIdForPlanDish,
} from '../../../lib/family-menu/plan-builder.js';
import { listSampleMenus, sampleMenuAsPlan, sampleIngredientRows } from '../../../lib/family-menu/sample-menus.js';
import { computeShoppingModel, formatShoppingText } from '../../../lib/family-menu/shopping.js';
import { importMenuWorkbook } from '../../../lib/excel/import/index.js';
import { buildExportModel } from '../../../lib/family-menu/plan-export.js';
import { exportPlanWorkbook, exportImportTemplate, SHEET_TEMPLATES } from '../../../lib/excel/index.js';
import { MIME_XLSX } from '../../../lib/excel/mime.js';

export const maxDuration = 60;

const asText = (v) => String(v ?? '').trim();
const asList = (v) =>
  asText(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Giá tiền món ăn — KHÔNG ép kiểu, KHÔNG chuyển đổi, chỉ trim.
 *
 * Giá trị là một khoảng giá do người dùng gõ ("15.000đ -> 18.000đ", "25k ->
 * 30k") và phải xuất Excel lại đúng nguyên văn, nên mọi thao tác parse/format
 * đều là sai. Cắt ở 120 ký tự để một ô Excel hỏng không thổi phồng hàng DB.
 */
const asPriceText = (v) => asText(v).slice(0, 120);

const ok = (data, status = 200) => corsJson(NextResponse, { success: true, data }, { status });
const fail = (status, error) => corsJson(NextResponse, { success: false, error: String(error?.message || error) }, { status });

/**
 * Lỗi ĐÃ PHÂN LOẠI (sai tham số, không đủ quyền, không tìm thấy).
 *
 * Không có nó thì mọi thứ ném ra đều thành 500, kể cả khi người dùng chỉ nhập
 * sai — che mất lỗi thật trong log. Bug thật vẫn là 500 kèm stack như cũ.
 */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const httpError = (status, message) => new HttpError(status, message);
const statusOf = (err) => (err instanceof HttpError ? err.status : 500);

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
  const { estimated, pending, warning } = await estimateMissingNutrition(days, 'excel_import');
  if (warning) report.warnings = [...(report.warnings || []), warning];
  return { days, report: { ...report, estimatedDishes: estimated, pendingEstimates: pending } };
}

/**
 * Bù calories/protein… cho món chưa có số, bằng engine ước tính sẵn có.
 *
 * Dùng chung cho CẢ hai đường tạo thực đơn (Excel và nhập tay) — nếu không,
 * thực đơn gõ tay sẽ hiện 0 kcal ở mọi nơi trong khi thực đơn nhập từ Excel
 * thì có số.
 */
async function estimateMissingNutrition(days, source) {
  const pending = [];
  for (const day of days || []) {
    for (const meal of day.meals || []) {
      for (const dish of meal.dishes || []) {
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
      dish.source = est.source || source;
      dish.confidence = est.confidence || 'low';
      estimated += 1;
    } catch {
      /* best-effort — để null, chủ hộ/admin sửa sau */
    }
  }

  return {
    estimated,
    pending: pending.length,
    warning: pending.length > MAX_ESTIMATES
      ? `${pending.length - MAX_ESTIMATES} món chưa được ước tính dinh dưỡng (vượt giới hạn mỗi lần nhập) — có thể bổ sung sau.`
      : null,
  };
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
        // Ghi chú + cờ rà soát từ sheet "THỰC ĐƠN" của bộ thực đơn chuẩn.
        .insert({
          template_day_id: dayRow.id,
          meal_type: meal.meal_type,
          note: asText(meal.note).slice(0, 500),
          needs_review: !!meal.needs_review,
        })
        .select()
        .single();
      if (mErr) throw mErr;

      for (const dish of meal.dishes) {
        const { data: dishRow, error: dishErr } = await supabaseAdmin
          .from('menu_template_dishes')
          .insert({
            template_meal_id: mealRow.id,
            name: dish.name,
            // Giá tiền: lưu nguyên văn chuỗi người nhập (khoảng giá), '' nếu trống.
            price: asPriceText(dish.price),
            price_range: asPriceText(dish.price_range),
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
            ...(dish.source_text ? { source_text: dish.source_text } : {}),
          })
          .select()
          .single();
        if (dishErr) throw dishErr;

        if (dish.ingredients?.length) {
          const { error: ingErr } = await supabaseAdmin
            .from('menu_template_dish_ingredients')
            .insert(dish.ingredients.map((i) => ({
              dish_id: dishRow.id,
              name: i.name,
              // Không ép mặc định 'g'/0: nguồn không khai thì để null.
              grams: i.grams ?? null,
              unit: i.unit ?? null,
              // Giá nguyên liệu: nguyên văn, '' nếu trống.
              price: asPriceText(i.price),
              // Lượng/tiền THỰC PHẢI MUA — khác lượng dùng trong món.
              buy_grams: i.buy_grams ?? null,
              buy_unit: asText(i.buy_unit).slice(0, 60),
              buy_price: i.buy_price ?? null,
              tags: i.tags || [],
            })));
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

    // Thông báo "để dành" (được duyệt / bị gỡ khỏi gia đình) — client gọi 1 lần
    // mỗi phiên đăng nhập ở mọi trang, xem components/FamilyNotices.jsx.
    if (resource === 'notifications') {
      return ok(await getUnreadNotifications(user.id));
    }

    if (resource === 'templates') {
      const household = await getHouseholdForUser(user.id);
      if (!household) return fail(400, 'Chưa có household — tạo household trước.');
      const members = await getMembers(household.id);
      // Thư viện phải hiện ĐỦ mọi thực đơn: limit mặc định 10 của
      // recommendTemplates từng cắt mất 33/43 bản, và vì gần như mọi điểm số
      // đều bằng 0 nên 10 bản lọt lại là ngẫu nhiên — cả nhóm gout, tiểu
      // đường, mỡ máu biến mất khỏi bộ lọc danh mục.
      const ranked = await recommendTemplates(household, members, {
        limit: Infinity,
        filters: { tag: url.searchParams.get('tag') || undefined },
        // Lọc bỏ thực đơn của tài khoản khác — xem chú thích ở recommendTemplates.
        userId: user.id,
      });

      // Kèm sẵn: đang dùng thực đơn nào, và quyền sửa từng thực đơn — để thư
      // viện đánh dấu "Đang sử dụng" và ẩn nút Sửa mà không phải gọi thêm API.
      const { data: activePlan } = await supabaseAdmin
        .from('weekly_menu_plans')
        .select('id, source_template_id')
        .eq('household_id', household.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const admin = await isAdminUser(user);
      const items = (ranked || []).map((r) => ({
        ...r,
        in_use: !!activePlan && r.template.id === activePlan.source_template_id,
        can_edit: canEditTemplate(r.template, { userId: user.id, isAdmin: admin }),
      }));

      return ok({
        items,
        active_plan_id: activePlan?.id || null,
        active_template_id: activePlan?.source_template_id || null,
        is_admin: admin,
        household_id: household.id,
      });
    }

    if (resource === 'template') {
      const id = url.searchParams.get('id');
      if (!id) return fail(400, 'Thiếu id');
      const template = await loadTemplateFull(id);
      return ok(template);
    }

    // Đi chợ cho một thực đơn trong thư viện, CHƯA cần áp dụng — để cân nhắc
    // trước khi thay kế hoạch đang chạy. Chỉ đọc, không ghi shopping_lists.
    if (resource === 'template-shopping-list') {
      const id = url.searchParams.get('id');
      if (!id) return fail(400, 'Thiếu id');
      const household = await getHouseholdForUser(user.id);
      const members = household ? await getMembers(household.id) : [];
      return ok(await buildTemplateShoppingList(id, {
        household,
        baseServings: Math.max(1, members.length || 1),
        servings: parseServings(url),
      }));
    }

    if (resource === 'plan') {
      const householdId = url.searchParams.get('household_id');
      if (!householdId) return fail(400, 'Thiếu household_id');
      await requireHouseholdAccess(user, householdId);
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
      await requirePlanAccess(user, planId);
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
      return exportPlanToExcel(url, user);
    }

    if (resource === 'import-template') {
      const { buffer, filename } = await exportImportTemplate();
      return xlsxResponse(buffer, filename);
    }

    /* Thực đơn MẪU — chỉ đọc, không đụng DB. Dùng khi hộ chưa có kế hoạch nào,
       để màn hình không trống trơn. Áp cho cả chế độ Gia đình lẫn Đầu bếp. */
    if (resource === 'sample-menus') {
      return ok(listSampleMenus({ tag: url.searchParams.get('tag') || undefined }));
    }

    if (resource === 'sample-menu') {
      const id = url.searchParams.get('id');
      const plan = sampleMenuAsPlan(id);
      if (!plan) throw httpError(404, 'Không tìm thấy thực đơn mẫu.');
      return ok(plan);
    }

    if (resource === 'sample-shopping-list') {
      const id = url.searchParams.get('id');
      const rows = sampleIngredientRows(id);
      if (!rows.length) throw httpError(404, 'Không tìm thấy thực đơn mẫu.');
      const servings = parseServings(url) || 1;
      const model = await computeShoppingModel(rows, { servings, baseServings: 1 });
      return ok({
        is_sample: true,
        servings,
        ...model,
        days: await buildDailyChecklists(rows, (r) => r.dayIndex, { servings, baseServings: 1 }),
        text: formatShoppingText(model),
      });
    }

    if (resource === 'shopping-list') {
      const planId = url.searchParams.get('plan_id');
      if (!planId) return fail(400, 'Thiếu plan_id');
      await requirePlanAccess(user, planId);

      // KHÔNG cache lại dòng shopping_lists nữa. Bản cache trả về
      // { shopping_list_items[] } với cột total_qty/est_cost, khác hẳn shape khi
      // dựng mới ({ items, groups, totals }) — nên từ lần load thứ hai trở đi
      // UI mất phần gom nhóm và tổng chi phí. Dựng lại tốn 1 query + bảng giá
      // đã cache 60s, đổi lại response chỉ còn MỘT shape duy nhất.
      return ok(await buildShoppingList(planId, { servings: parseServings(url) }));
    }

    return fail(400, `resource không hợp lệ: ${resource}`);
  } catch (err) {
    console.error('[family-menu] GET error:', err);
    return fail(statusOf(err), err);
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
      case 'mark_notifications_read':
        return ok(await markNotificationsRead(user, body));
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
      case 'update_template':
        return ok(await updateTemplate(user, body, files));
      case 'delete_template':
        return ok(await deleteTemplate(user, body));
      case 'generate_plan':
        return ok(
          await generatePlan({
            household: await requireOwnedHousehold(user, body.household_id),
            templateId: body.template_id || undefined,
            userId: user.id,
          })
        );
      case 'regenerate_plan':
        // Không có dòng này thì BẤT KỲ ai biết plan_id đều xoá được cả tuần của hộ khác.
        await requirePlanAccess(user, body.plan_id, { owner: true });
        return ok(
          await regeneratePlan({
            planId: body.plan_id,
            scope: body.scope,
            dayIndex: body.day_index,
            mealType: body.meal_type,
            planDishId: body.plan_dish_id,
          })
        );
      case 'swap_dish': {
        // Kiểm tra quyền TRƯỚC khi ghi: tra plan_id từ plan_dish_id rồi mới đổi.
        const swapPlanId = await planIdForPlanDish(body.plan_dish_id);
        if (!swapPlanId) throw httpError(404, 'Không tìm thấy món trong kế hoạch.');
        await requirePlanAccess(user, swapPlanId, { owner: true });
        return ok(await swapDish({ planDishId: body.plan_dish_id, replacementDishId: body.replacement_dish_id }));
      }
      default:
        return fail(400, `action không hợp lệ: ${action}`);
    }
  } catch (err) {
    console.error('[family-menu] POST error:', err);
    return fail(statusOf(err), err);
  }
}

/* ───────────────────────── tham số & phân quyền ───────────────────────── */

/** `?servings=` — bỏ trống = tự động theo số thành viên. Sai → 400, không phải 500. */
function parseServings(url) {
  const raw = url.searchParams.get('servings');
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 50) {
    throw httpError(400, 'servings phải là số từ 1 đến 50.');
  }
  return n;
}

/** Đọc được kế hoạch: chủ hộ HOẶC thành viên đã liên kết (thực đơn là của chung). */
async function requireHouseholdAccess(user, householdId) {
  if (!householdId) throw httpError(400, 'Thiếu household_id');
  if (await isHouseholdMember(user.id, householdId)) return;
  throw httpError(403, 'Bạn không có quyền xem thực đơn của gia đình này.');
}

/**
 * Kiểm tra quyền theo plan_id.
 * @param {object} opts
 * @param {boolean} [opts.owner]  true = chỉ chủ hộ (mọi thao tác GHI)
 */
async function requirePlanAccess(user, planId, { owner = false } = {}) {
  const { data: plan } = await supabaseAdmin
    .from('weekly_menu_plans')
    .select('id, household_id')
    .eq('id', planId)
    .maybeSingle();
  if (!plan) throw httpError(404, 'Không tìm thấy kế hoạch thực đơn.');
  if (owner) await requireOwnedHousehold(user, plan.household_id);
  else await requireHouseholdAccess(user, plan.household_id);
  return plan;
}

/**
 * Ảnh 3 — quyền SỬA/XOÁ một thực đơn trong thư viện.
 *
 *   admin            → mọi thực đơn, kể cả thực đơn hệ thống
 *   người dùng thường → chỉ thực đơn DO CHÍNH MÌNH tạo và KHÔNG phải hệ thống
 *
 * Cùng một công thức với `can_edit` mà `?resource=templates` trả về, nên nút
 * trên UI và chốt chặn ở BE không thể lệch nhau.
 */
async function requireTemplateEditAccess(user, templateId) {
  if (!templateId) throw httpError(400, 'Thiếu template_id');
  const { data: template, error } = await supabaseAdmin
    .from('menu_templates')
    .select('*')
    .eq('id', templateId)
    .maybeSingle();
  if (error) throw error;
  if (!template) throw httpError(404, 'Không tìm thấy thực đơn.');

  const isAdmin = await isAdminUser(user);
  const denial = templateEditDenial(template, { userId: user.id, isAdmin });
  if (denial) throw httpError(403, DENY_MESSAGES[denial]);
  return { template, isAdmin };
}

/* ───────────────────────── action implementations ───────────────────────── */

async function requireOwnedHousehold(user, householdId) {
  if (!householdId) throw httpError(400, 'Thiếu household_id');
  const owner = await isHouseholdOwner(user.id, householdId);
  if (!owner) throw httpError(403, 'Chỉ chủ hộ mới có quyền thực hiện hành động này.');
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

  // Thành viên có tài khoản thật -> để dành thông báo cho lần đăng nhập sau.
  // Thành viên 'dependent' không có tài khoản nên không cần báo.
  if (member.kind === 'linked' && member.user_id) {
    await notifyUsers([member.user_id], { type: 'removed_from_family', household });
  }
  return { removed: true };
}

/* ─────────────── thông báo để dành cho thành viên gia đình ─────────────── */

/** Handle (@username) của chủ hộ — dùng để hiển thị "gia đình của @ai". */
async function ownerHandleOf(household) {
  if (!household?.owner_id) return null;
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('username')
    .eq('id', household.owner_id)
    .maybeSingle();
  return asText(data?.username) || null;
}

/**
 * Ghi thông báo cho những người dùng KHÔNG online lúc sự kiện xảy ra
 * (được duyệt vào gia đình / bị gỡ khỏi gia đình). Xem migrations/family_notifications.sql.
 *
 * Best-effort: thông báo hỏng thì KHÔNG được làm hỏng hành động chính (duyệt/xoá
 * đã thành công rồi) — nuốt lỗi và ghi log.
 */
async function notifyUsers(userIds, { type, household, ownerHandle }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  try {
    const handle = ownerHandle !== undefined ? ownerHandle : await ownerHandleOf(household);
    const rows = ids.map((uid) => ({
      user_id: uid,
      type,
      owner_handle: handle,
      household_id: household?.id || null,
    }));
    const { error } = await supabaseAdmin.from('household_notifications').insert(rows);
    if (error) throw error;
    return rows.length;
  } catch (err) {
    console.error('[family-menu] notifyUsers failed:', err?.message || err);
    return 0;
  }
}

async function getUnreadNotifications(userId) {
  const { data, error } = await supabaseAdmin
    .from('household_notifications')
    .select('id, type, owner_handle, created_at')
    .eq('user_id', userId)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(20);
  // Bảng chưa được tạo (chưa chạy migration) thì coi như không có thông báo,
  // KHÔNG làm hỏng cả trang Kitchen.
  if (error) {
    console.error('[family-menu] getUnreadNotifications failed:', error.message);
    return [];
  }
  return data || [];
}

async function markNotificationsRead(user, body) {
  const ids = Array.isArray(body.notification_ids) ? body.notification_ids.filter(Boolean) : [];
  let q = supabaseAdmin
    .from('household_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)          // chỉ được đánh dấu thông báo CỦA MÌNH
    .is('read_at', null);
  if (ids.length) q = q.in('id', ids);
  const { error } = await q;
  if (error) throw error;
  return { marked: true };
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

  // Đếm TRƯỚC khi xoá để báo lại cho người dùng đã gỡ bao nhiêu người.
  const { data: members, error: mErr } = await supabaseAdmin
    .from('household_members')
    .select('id, user_id, kind')
    .eq('household_id', owned.id);
  if (mErr) throw mErr;
  const others = (members || []).filter((m) => m.user_id !== user.id);
  const removedMembers = others.length;

  // Ghi thông báo TRƯỚC khi xoá: sau lệnh delete thì không còn tra ra được
  // handle chủ hộ lẫn danh sách thành viên nữa.
  await notifyUsers(
    others.filter((m) => m.kind === 'linked' && m.user_id).map((m) => m.user_id),
    { type: 'removed_from_family', household: owned, ownerHandle: await ownerHandleOf(owned) }
  );

  // Xoá household là ĐỦ: mọi bảng con đều `on delete cascade` (household_members,
  // household_join_requests, weekly_menu_plans/plan_*, shopping_lists...), nên
  // toàn bộ thành viên — kể cả tài khoản thật đã tham gia — bị gỡ tự động.
  // Không bắt chủ hộ xoá tay từng người nữa.
  // household_notifications dùng `on delete set null` nên thông báo vừa ghi SỐNG SÓT.
  const { error } = await supabaseAdmin.from('households').delete().eq('id', owned.id);
  if (error) throw error;
  return { left: true, household_id: owned.id, deleted_household: true, removed_members: removedMembers };
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

  // Người xin vào thường không online lúc được duyệt -> để dành thông báo.
  await notifyUsers([req.user_id], { type: 'join_approved', household });

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
      ...(await templateMetaFromBody(user, body)),
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
      ...(await templateMetaFromBody(user, body)),
    })
    .select()
    .single();
  if (error) throw error;

  if (Array.isArray(body.days) && body.days.length) {
    // Món gõ tay chỉ có tên ⇒ bù dinh dưỡng như đường Excel, để thực đơn tự
    // nhập không hiện 0 kcal khắp nơi.
    const { estimated, pending } = await estimateMissingNutrition(body.days, 'manual_form');
    await persistTemplateDays(template.id, body.days);
    return { ...template, import_report: { dayCount: body.days.length, dishCount: countDishes(body.days), estimatedDishes: estimated, pendingEstimates: pending, strategy: 'manual', layout: 'manual' } };
  }
  return template;
}

const countDishes = (days) =>
  (days || []).reduce((s, d) => s + (d.meals || []).reduce((n, m) => n + (m.dishes?.length || 0), 0), 0);

/* ───────────────────── Sửa / xoá thực đơn (Ảnh 3) ───────────────────── */

/**
 * Phần meta chung cho cả hai đường TẠO thực đơn (Excel và nhập tay).
 * `category` bỏ trống thì suy từ tiêu đề — thư viện lọc theo danh mục nên
 * không được để thực đơn mới rơi hết vào "Khác".
 */
async function templateMetaFromBody(user, body) {
  const title = asText(body.title);
  const meta = {
    description: asText(body.description).trim() || null,
    category: asText(body.category).trim() || categoryFromName(title),
    image_url: asText(body.image_url).trim() || null,
  };
  // Chỉ admin mới đánh dấu được thực đơn hệ thống.
  if ((asText(body.is_system) === 'true' || body.is_system === true) && (await isAdminUser(user))) {
    meta.is_system = true;
  }
  return meta;
}

const MENU_COVER_FOLDER = process.env.CLOUDINARY_MENU_FOLDER || 'calorie-menu-covers';
const COVER_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const COVER_MAX_BYTES = 5 * 1024 * 1024;

/** Chỉ những cột người dùng được sửa. Không nhận nguyên `body` để không ai
 *  đẩy được `created_by`/`is_system` qua đường vòng. */
const TEMPLATE_TEXT_FIELDS = ['title', 'description', 'category'];
const TEMPLATE_LIST_FIELDS = ['tags', 'disease_target'];

/**
 * POST { action:'update_template', template_id, … }
 *
 * Nhận cả JSON lẫn multipart — multipart để kèm ảnh bìa (`file`). Chỉ ghi
 * những trường CÓ MẶT trong body, nên sửa mỗi tiêu đề không xoá mất mô tả.
 */
async function updateTemplate(user, body, files) {
  const { template, isAdmin } = await requireTemplateEditAccess(user, asText(body.template_id));

  const patch = { updated_at: new Date().toISOString() };

  for (const f of TEMPLATE_TEXT_FIELDS) {
    if (!(f in body)) continue;
    const v = asText(body[f]).trim();
    if (f === 'title' && !v) throw httpError(400, 'Tiêu đề không được để trống.');
    patch[f] = v || null;
  }
  for (const f of TEMPLATE_LIST_FIELDS) {
    if (!(f in body)) continue;
    patch[f] = Array.isArray(body[f]) ? body[f] : asList(body[f]);
  }
  if ('visibility' in body) {
    patch.visibility = asText(body.visibility) === 'private' ? 'private' : 'public';
    // private mà không gắn hộ nào thì thành "mồ côi" — không ai thấy được nữa,
    // kể cả người tạo (xem ghi chú ở migrations/menu_template_meta.sql).
    if (patch.visibility === 'private') {
      const household = await requireOwnedHousehold(user, asText(body.household_id) || template.owner_household_id);
      patch.owner_household_id = household.id;
    } else {
      patch.owner_household_id = null;
    }
  }
  // Cờ hệ thống là đặc quyền của admin — người thường gửi lên cũng bị bỏ qua.
  if (isAdmin && 'is_system' in body) {
    patch.is_system = asText(body.is_system) === 'true' || body.is_system === true;
  }

  const fileEntry = files?.get('file');
  if (fileEntry && typeof fileEntry !== 'string') {
    patch.image_url = await uploadCoverImage(fileEntry);
  } else if ('image_url' in body) {
    patch.image_url = asText(body.image_url).trim() || null;   // '' = gỡ ảnh
  }

  const { data, error } = await supabaseAdmin
    .from('menu_templates')
    .update(patch)
    .eq('id', template.id)
    .select()
    .single();
  if (error) throw error;

  if (Array.isArray(body.days)) await persistTemplateDays(template.id, body.days);
  return data;
}

/**
 * Ảnh bìa → Cloudinary. Khác `uploadImage` cho nhật ký ảnh ở chỗ đây là hành
 * động CÓ CHỦ Ý: hỏng thì phải báo lỗi, không được im lặng trả null rồi để
 * người dùng bấm lưu mà chẳng thấy gì đổi.
 */
async function uploadCoverImage(fileEntry) {
  const type = fileEntry.type || '';
  if (!COVER_MIME.has(type)) {
    throw httpError(400, 'Ảnh bìa phải là JPEG, PNG hoặc WebP.');
  }
  if (fileEntry.size > COVER_MAX_BYTES) {
    throw httpError(400, `Ảnh bìa tối đa ${COVER_MAX_BYTES / 1024 / 1024} MB.`);
  }
  if (!cloudinaryConfigured()) {
    throw httpError(503, 'Máy chủ chưa cấu hình Cloudinary nên chưa tải ảnh lên được.');
  }
  const buffer = Buffer.from(await fileEntry.arrayBuffer());
  const up = await uploadImage(buffer, fileEntry.name || 'menu-cover.jpg', {
    folder: MENU_COVER_FOLDER,
    mime: type,
  });
  if (!up?.url) throw httpError(502, 'Tải ảnh lên Cloudinary thất bại.');
  return up.url;
}

/**
 * POST { action:'delete_template', template_id }
 *
 * Kế hoạch đã sinh từ thực đơn này KHÔNG mất theo: khoá ngoại
 * `weekly_menu_plans.source_template_id` khai `on delete set null`
 * (migrations/family_menu_planner.sql:177), nên bữa ăn của gia đình vẫn còn
 * nguyên, chỉ rụng đường dẫn ngược về thư viện. Ngày/bữa/món của chính
 * template thì `on delete cascade` dọn giúp.
 *
 * Đếm trước khi xoá chỉ để BÁO lại cho người dùng bao nhiêu kế hoạch bị ảnh
 * hưởng — không phải để dọn dẹp.
 */
async function deleteTemplate(user, body) {
  const { template } = await requireTemplateEditAccess(user, asText(body.template_id));

  const { count } = await supabaseAdmin
    .from('weekly_menu_plans')
    .select('id', { count: 'exact', head: true })
    .eq('source_template_id', template.id);

  const { error } = await supabaseAdmin.from('menu_templates').delete().eq('id', template.id);
  if (error) throw error;

  return { id: template.id, deleted: true, detached_plans: count || 0 };
}

/* ───────────────────────── Xuất Excel ───────────────────────── */

/**
 * GET /api/family-menu?resource=export&plan_id=…[&sheets=menu,shopping][&servings=6][&start_date=2026-07-27]
 *
 * `sheets` cho phép xuất một phần (ví dụ chỉ danh sách đi chợ để in mang đi).
 * `servings` cho phép đổi số suất NGAY LÚC XUẤT mà không phải sinh lại kế
 * hoạch — mọi định lượng và danh sách mua được nhân lại theo hệ số.
 */
async function exportPlanToExcel(url, user) {
  const planId = url.searchParams.get('plan_id');
  if (!planId) return fail(400, 'Thiếu plan_id');
  await requirePlanAccess(user, planId);

  const sheets = (url.searchParams.get('sheets') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Tên sheet lạ là lỗi NHẬP, không phải lỗi máy chủ — trước đây nó lọt xuống
  // rồi bị selectSheets loại sạch và ném "chưa có dữ liệu" thành 500.
  const unknown = sheets.filter((s) => !(s in SHEET_TEMPLATES));
  if (unknown.length) {
    return fail(400, `sheets không hợp lệ: ${unknown.join(', ')}. Hợp lệ: ${Object.keys(SHEET_TEMPLATES).join(', ')}.`);
  }

  const startDate = url.searchParams.get('start_date');
  const model = await buildExportModel(planId, {
    servings: parseServings(url),
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
