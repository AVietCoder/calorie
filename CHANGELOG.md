# CHANGELOG — AI Calorie System (handover continuation)

## 2026-07-04 — Knowledge Base refactor: remove ALL embeddings

Removed every embedding dependency from the project (BGE-M3, OpenAI/Lovable
embeddings, `/v1/embeddings`, pgvector, `embedTexts()`/`embedQuery()`/
`pingEmbeddings()`/`embedChunksWithFallback()`). The Knowledge Base (admin
PDF uploads + built-in disease-routed docs) now retrieves exclusively via
PostgreSQL Full Text Search (`tsvector` + GIN index + `ts_rank`). See
`docs/KNOWLEDGE-BASE-FULLTEXT-SEARCH.md` for the full architecture, and
`migrations/fulltext_search.sql` for the schema change. `lib/nutrition.js`'s
semantic food-name matching (C-semantic) was also removed in favor of
exact/alias matching only. No embedding server or API key is needed anywhere
in this project anymore.

---

Date: 2026-07-03
Scope: THT-D3 (web, `web/`) + calorie-ai-mobile (React Native, `mobile/`)

---

## 1. Project audit (status per module)

| Module | Status | Notes |
|---|---|---|
| Vision (Gemini → Qwen VL fallback) | **Completed** | `web/lib/vision.js`: temp 0 + seed, guided JSON schema, per-item counting (`items[]`) with totals computed in code, portion-from-image rules, Vietnamese-dish disambiguation |
| Nutrition Engine | **Completed** (was: partially wired) | `web/lib/nutrition.js`: unit parsing → anchor per 100 g/ml or per unit (USDA FDC → OpenFoodFacts → VN reference → AI temp 0) → cached (`nutrition_anchors` + memory) → linear scaling → Atwater validation. **Was only used by Plan; now also used by Chat (see fixes)** |
| Food / Quantity Parser | **Completed + extended** | Fractions, English words, bare counts (see BUG 2) |
| Chat | **Completed after fix** | Was generating nutrition directly from the LLM at temp 0.2 (nondeterministic, unvalidated on the analyze path) |
| Plan (coach-dynamic) | **Completed** | create / update_plan / estimate_food / health_check flows all use the shared engine |
| Weekly Health Check | **Completed** | `action: "health_check"` + web `diet-details.js` + mobile `DietScreen` |
| Charts | **Completed** | web `diet-details` + mobile `components/Charts.js` |
| Notifications / Reminders | **Completed** | web `public/reminders.js`; mobile `ReminderContext` + `expo-notifications` |
| History | **Completed** | `/api/chat-history`, offline cache on mobile |
| Voice | **Completed** | web SpeechRecognition in chat; mobile `expo-speech-recognition` |
| Guide / Landing / Settings / i18n (vi+en) | **Completed** | `guide.html`, `index.html`, `setup`, `i18n.js` (web) / `src/i18n` (mobile) |
| Mobile app + sync | **Completed** | Mobile consumes the same backend APIs (`/chat`, `/coach-dynamic`, `/analyze-food`), incl. `reanalyze` flag & `lastClientMeal` — backend fixes apply to both platforms automatically |
| Backend APIs / Database (Supabase) | **Completed** | auth (refresh flow), profiles, foods, chat_history, weekly_plan, `nutrition_anchors` (migration present) |
| Caching | **Completed** | anchor cache (DB + memory), mobile AsyncStorage plan/chat caches |
| FDC integration | **Completed** | `usdaPer100()` behind `FDC_API_KEY` |
| OpenFoodFacts | **Completed** | `offPer100()` with token-match scoring |
| Vietnam dataset | **Partially completed** | Built-in deterministic reference table (`REFERENCE_PER100`/`REFERENCE_UNITS`, ~8 staples) + `foods` DB accumulation; a full VN food-composition table is still a TODO |
| RAG knowledge base (disease diets) | **Completed** | 6 PDF sources ingested → `knowledge/knowledge-base.json`, retrieval wired into chat/plan/health-check |
| Build scripts | **Completed** | `scripts/ingest-knowledge.mjs`, `build-knowledge-base.py`, **new** `scripts/test-nutrition.mjs` |

Previous-AI claims (Guide, Landing, i18n, Notifications, Voice, Snapshot Intake, Weekly Health Check, Weekly Charts, Chat improvements, Portion detection, Vision prompt improvements, Confidence, Mobile sync, Layout fixes, DB override guard, Reset forms): **all verified present and working**, except:
- *Database Override Guard* — **partially working** (guarded odd portions, but plan saves still overwrote `foods` rows → fixed below).
- *Better Portion Detection* — **needed improvement** in the text parser (fractions/English → fixed below).

---

## 2. Bugs found, root causes, fixes

### BUG 1 — Same food gives different nutrition on every press
**Root causes**
1. Chat text paths (`api/chat.js` analyze/coach) asked the LLM to invent `calories/protein/...` at `temperature 0.2` with **no seed** and **never called the shared nutrition engine**. The analyze path additionally returned mealData **without any validation**.
2. `saveFoodRecord()` **overwrote** existing `foods` rows with the newest LLM numbers on every plan save / vision result → the "reference" DB itself drifted between calls.
3. Fuzzy `includes()` matching against the foods DB let one dish borrow another dish's numbers ("Sushi cá hồi" ↔ "Sushi").

**Fixes** (`web/api/chat.js`, `web/api/analyze-food.js`)
- Every Chat `mealData` (analyze + coach) now goes through **the same engine as Plan**: `resolveNutrition()` → quantity parse → cached anchor (USDA → OFF → VN ref → AI temp 0/seed 42) → linear scale → Atwater. The LLM only *identifies* dish + amount; the engine computes the numbers. Engine miss → old behavior (validated LLM numbers).
- Analyze completion now runs at `temperature 0, top_p 1, seed 42`.
- `saveFoodRecord()` is **insert-only** — existing `foods` rows are never overwritten.
- Foods-DB matching is **exact after normalization** (accent-stripped) in both `chat.js` (image path) and `analyze-food.js`; two-way `includes()` removed.

### BUG 2 — Poor portion estimation
**Root cause** — `parseQuantity()` didn't understand fractions (`1/2`, `1/3`), English quantity words (`half`, `three`, `one third`), unit plurals (`cups`, `glasses`, `liters`), or `"1 sushi"` (bare numbers required qty ≥ 2, so "1 sushi" fell into the **full-serving** lookup — a single piece could get whole-platter calories).

**Fixes** (`web/lib/nutrition.js`)
- Word-fraction preprocessing (EN + VI): `half`, `one third`, `two thirds`, `quarter(s)`, `một phần ba/tư` (with a guard so "một phần **ba chỉ**" = 1 serving of pork belly, not ⅓).
- Numeric fractions `a/b`, number words `một…mười` / `one…ten` / `a|an` when unit-adjacent (dish names like "ba rọi", "chè 3 màu" still parse as names — regression-tested).
- Bare leading quantity now accepts `1` and fractions → "1 sushi" = 1 **piece** (~50 kcal), "half banana" = 0.5 piece.
- Unit plurals: `cups|glass(es)`, `liter(s)|litre(s)`.
- Reference-table ordering fixed: generic milk (60 kcal/100 ml) now takes precedence over chocolate milk (80) for plain "sữa"/"milk" queries.

### BUG 3 — Conversation context corrupts new image analyses ("sushi → cookies")
**Verified already fixed** by the previous AI on both platforms: new images are analyzed with a **clean context** (system + image + current note only); conversation history is injected **only** when the client sets the `reanalyze=1` flag (resending the *same* photo with a correction). `lastClientMeal` keeps server "latest meal" in sync with what the user sees. Confirmed in `web/public/chat.js`, `mobile/src/screens/ChatScreen.js`, `web/api/chat.js`. The exact-match DB fix above also removes a residual cross-dish contamination channel.

### BUG 4 — Plan estimates better than Chat
**Root cause** — Plan (`coach-dynamic.js`) used the deterministic engine; Chat didn't (duplicated, weaker logic in prompts).
**Fix** — Chat and Plan now share **one pipeline**: vision prompt (`lib/vision.js`), quantity parser + nutrition engine + validation + confidence (`lib/nutrition.js`), food DB lookup and unit conversion. Chat prompts now ask the LLM for `description` (clean dish name) + `amount` (exact user-stated quantity) and defer numbers to the engine.

### Minor fixes
- `formatDate()` in `api/chat.js` no longer renders `NaN/NaN/NaN` for non-ISO day texts ("thứ 2").
- `<data>` tag now carries the computed `amount` (clients ignore unknown fields — safe, enables portion display later).

---

## 3. Verification
- **Web**: `node --check` passes for all `api/`, `lib/`, `public/`, `lib/rag/` files.
- **Mobile**: all 29 source files parse (Babel/JSX); **production Metro bundle succeeds** (`npx expo export --platform android` → 4.8 MB Hermes bundle, exit 0).
- **New regression suite** `web/scripts/test-nutrition.mjs` (offline — no network/API keys needed): **48/48 pass**, covering:
  - milk 100/200/300/500 ml → exactly linear & monotonic (100 ml = 60 kcal)
  - 1/2/3 sushi → 50/100/150 kcal (per piece, never whole-platter)
  - 1/2 bananas, half banana; nửa tô / 1 tô phở (VI) = half/1 bowl pho (EN) → 240/480 kcal
  - 1 phần cơm tấm = 650 kcal; 150 g cơm trắng ≈ 195 kcal; one-third cup milk ≈ 50 kcal
  - determinism: 3 repeated calls per dish → byte-identical results
  - parser guards: "chè 3 màu", "ba rọi kho tiêu", "một phần ba chỉ" not misparsed
  - Atwater correction + negative clamping

Run with: `cd web && node scripts/test-nutrition.mjs`

---

## 4. Files modified / added
| File | Change |
|---|---|
| `web/lib/nutrition.js` | Quantity parser: fractions, EN/VI number words, unit plurals, bare qty ≥ 1; reference-table ordering (milk) |
| `web/api/chat.js` | Unified nutrition pipeline for all mealData; deterministic sampling on analyze path; insert-only `saveFoodRecord`; exact-match DB lookup; `amount` in prompts & `<data>`; date guard |
| `web/api/analyze-food.js` | Exact-match (normalized) foods-DB lookup only |
| `web/scripts/test-nutrition.mjs` | **New** offline regression suite (48 tests) |
| `CHANGELOG.md` | This file |

No mobile source changes were required — mobile consumes the fixed backend.

---

## 5. Completion estimate & remaining TODOs
**Overall completion: ~92%.** All listed modules implemented; core pipelines unified and deterministic.

Remaining TODOs / suggestions:
1. **Vietnam dataset**: import a real VN food-composition table (e.g. FCT Vietnam) into `nutrition_anchors`/`foods` instead of the small built-in reference list.
2. Route the **image path's** per-item counts through the anchor cache too (currently vision computes totals from counted items; anchoring `calories_per_unit` per item name would make photo results as stable as text results across model updates).
3. `estimateOneFoodAI` in `coach-dynamic.js` is a legacy fallback that duplicates the anchor prompt; it only runs when the whole engine fails — consider removing once the engine has proven itself in production.
4. Add CI (GitHub Actions) running `node --check` + `scripts/test-nutrition.mjs` + Babel parse of mobile.
5. Consider server-side rate limiting on `/api/chat` and image size caps (client already resizes to ~2 MP).
6. Migrations `migrations/nutrition_anchors.sql` and `migrations/admin.sql` must be applied on Supabase for full caching benefit (engine degrades gracefully to memory cache without them).

---

## 6. Session 2 — tester regressions + i18n + audit (2026-07-04)

### REGRESSION A — `<data>` JSON broken → kcal card went blank (P0)
**Root cause** — introducing the `items[]` schema, the `<data>` spec used verbose bracket placeholders (`"quantity":[SỐ LƯỢNG...]`) AND the few-shot example was still the *old* format (no `amount`/`items`). The model imitated the malformed spec and, with `max_tokens: 1200`, ran out of tokens mid-JSON → truncated `<data>` with no closing tag → parser returned null → the sidebar showed no calories.
**Fixes** (`web/api/chat.js`, `web/lib/vision.js`)
- Rewrote the `<data>` spec with short canonical placeholders + **two complete few-shot examples** (single serving + "3 cookies" with `items` quantity=3).
- `max_tokens` 1200→1600 (chat) and 800→1000 (vision).
- **Truncated-JSON repair** (`repairTruncatedJson` / `repairItemsTail`): missing `</data>` or a cut inside `items[]` is recovered by dropping the dangling `items` tail and auto-closing braces → the kcal card always renders. Fallback scan now requires `description` so it never grabs a nested `items` sub-object.

### REGRESSION B — chat image path didn't multiply by count
**Root cause** — `computeTotalsFromItems` existed in `vision.js` (used by analyze-food/Plan) but the chat Qwen `<data>` path never called it → "3 cookies" showed 1-cookie calories, and the odd-portion DB-override could stamp a 1-serving row over a multi-item photo.
**Fix** (`web/api/chat.js`) — image path now runs `computeTotalsFromItems` on the parsed `<data>`, then **count-aware portion guard**: when `items.count > 1` and `amount` doesn't match the count, `amount` is forced to "N cái" so `isStandardPortion` is false → no DB override / no DB pollution. Same guard added in `vision.js`.

### i18n — hardcoded strings localized (VI/EN)
- Web (`public/chat.js`, `public/schedule.html`, `public/i18n.js`, ~27 keys): "Phân tích hình ảnh này"→"Analyze this image", pasted-image toast/label, analyzing/loading/JPG-only/login/logout/error toasts, input placeholder, 4 voice-error messages, Plan photo card (Protein/Fat/Carbs labels, detected/filled/not-food/server-error). Default-analyze-text detection now matches both languages so the resend-guard still works after a language switch.
- Mobile (`src/screens/ChatScreen.js`, `src/i18n/index.js`, 9 keys): add-photo dialog, camera/library permission dialogs, analyze-image default text, 4 voice-error messages.

### Audit verification (this session, evidence-based — claims re-checked, not trusted)
- **Determinism (BUG1)**: `scripts/test-nutrition.mjs` 48/48; plus an audit harness running every handover test food **5× each** → byte-identical results (milk 100/200/300/500 = 60/120/180/300; sushi 1/2/3 = 50/100/150; banana 1/2 = 105/210; ½/1 bowl pho = 240/480; broken rice 650; cake slice 300; coffee/pizza → deterministic AI fallback). Monotonic + exact-linear checks pass. Live OpenFoodFacts path (chocolate milk 100/200/300/500 = 44/87/131/218) also linear + `confidence: high`.
- **Sampling**: every nutrition-**number** path is `temperature 0 + seed 42` (vision.js, nutrition.js anchors, analyze-food fallback, coach `estimateOneFoodAI`). Remaining `temp 0.2/0.5` are **text-only** paths (casual chat, coaching prose, weekly-plan variety) whose numbers are re-derived by `resolveNutrition` afterwards.
- **Context (BUG3)**: `reanalyze=1` gating confirmed in all three (`public/chat.js`, `ChatScreen.js`, `api/chat.js`) — new images use clean context; history injected only on same-photo re-analysis.
- **Unified pipeline (BUG4)**: `api/chat.js` imports and uses `resolveNutrition` from `lib/nutrition.js` — same engine as Plan.
- **Builds**: backend `node --check` all files OK; `public/*.js` + HTML inline scripts parse OK; mobile 27 source files parse OK; **Metro production bundle OK** (1580 modules, exit 0).

### Files modified (session 2)
`web/api/chat.js` (JSON spec + few-shot + repair + items counting + i18n-safe resend guard + max_tokens), `web/lib/vision.js` (JSON repair, count-aware amount, max_tokens), `web/public/chat.js` + `web/public/schedule.html` + `web/public/i18n.js` (i18n), `mobile/src/screens/ChatScreen.js` + `mobile/src/i18n/index.js` (i18n). No schema/DB changes.

---

## 7. Session 3 — DB leverage upgrades A/B/C/D/E/F (2026-07-04, all approved by owner)

Goal: better exploit `foods`, `nutrition_anchors`, and the two dead tables
(`ai_usage_logs`, `chat_images`) to raise accuracy + add features. Delivered
sequentially, verified after each.

### A+B — Nutrition provenance + ranked lookup + anti-pollution
- **Migration** `migrations/nutrition_provenance.sql` (idempotent, additive): `foods` gains `source/confidence/verified/hit_count/last_used_at (+embedding jsonb for C)`; `nutrition_anchors` gains `confidence/verified/hit_count/last_used_at`; indexes; `increment_anchor_hit` RPC.
- `lib/nutrition.js`: `SOURCE_RANK` (manual>usda≈off≈vn_ref>foods>ai; `verified`=top). `saveAnchor` is **rank-aware** — never downgrades a higher-tier/verified anchor. `getAnchor` reads provenance + bumps hit_count (fire-and-forget). Result `confidence` now derived honestly from source/verified (foods rows are `high` only if verified, else `medium` — no more blanket `high`).
- Writes tag provenance: `api/chat.js saveFoodRecord`, `api/analyze-food.js` insert + DB-override → `source/confidence/verified=false`; `fetchFoodsDB` (3 files) now select `source/confidence/verified`.
- **Seed** `migrations/nutrition_anchors_seed.sql`: the in-code `REFERENCE_*` table mirrored into `nutrition_anchors` as `vn_ref/verified/high` (code table kept as offline fallback).

### C — Alias + semantic matching
- **Alias** (deterministic, no dependency): `FOOD_ALIASES` + `canonKey()` unify regional names (bắp=ngô, heo=lợn, khoai mì=sắn, bánh mỳ=bánh mì, hủ tíu=hủ tiếu, đậu phộng=lạc) across reference/foods matching **and** anchor cacheKeys. Seed keys contain no aliased tokens → unaffected. Proven: "bắp luộc"↔"ngô luộc" share a verified foods row.
- **Semantic** (graceful): `findSemanticInFoodsDB` reuses RAG embeddings (`lib/rag/embeddings.js`), cosine ≥ 0.82, per-instance vector cache, capped 400 candidates. **No-op when `EMBEDDING_BASE_URL` unset** (current deploy) → zero behavior change; matched rows capped at `medium` confidence, source `foods_semantic`.

### D — Food photo diary (activates dead `chat_images`)
- `migrations/chat_images_diary.sql`: `analysis jsonb` column + user/created index.
- `lib/cloudinary.js`: new `uploadImage()` (resource_type image, signed+unsigned). `lib/food-diary.js`: `saveFoodPhoto` (fire-and-forget upload+insert) + `getFoodPhotos`. Wired into `api/analyze-food.js` and `api/chat.js` image path (only when a dish is recognized). New GET `api/food-diary.js` (function #11 of 12).
- UI: web `diet-details` "Nhật ký ảnh món ăn" thumbnail grid; mobile `DietScreen` gallery card; `DiaryAPI.list`; i18n `diary.*` (web+app, vi+en). Degrades silently when Cloudinary unconfigured.

### E — AI usage logging (activates dead `ai_usage_logs`)
- `lib/usage-log.js`: `logUsage` (fire-and-forget insert) + `getUsageStats(days)`. Wired into `chat.js` (chat_image/chat_text), `analyze-food.js` (analyze_food), `coach-dynamic.js` (estimate_food/health_check).

### F — Admin nutrition curation + analytics (web-admin API)
- `api/admin.js` new admin-gated actions: `nutrition_stats` (usage 7d + foods/anchors quality breakdown), `list_foods` (unverified-first), `verify_food`, `update_food` (manual edit → verified), `delete_food`. Manual JSON body reader (bodyParser disabled for multipart upload). Admin **UI** for these is the remaining TODO (backend ready).

### Verification (session 3)
Backend `node --check` all 11 functions + all lib OK; `scripts/test-nutrition.mjs` **48/48**; determinism harness **36/36** (5× each, byte-identical); alias unification proven; web `public/*.js` + HTML inline OK; mobile **27 files** OK; **Metro bundle OK** (1580 modules).

### Migrations to run on Supabase (in order)
1. `migrations/nutrition_provenance.sql`  2. `migrations/nutrition_anchors_seed.sql`  3. `migrations/chat_images_diary.sql`
(All idempotent + additive; engine degrades gracefully if not yet applied.) Diary needs Cloudinary env; semantic-C needs `EMBEDDING_BASE_URL` — both optional/no-op otherwise.
