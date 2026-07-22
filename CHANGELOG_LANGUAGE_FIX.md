# Language Consistency Fix

## The bug

Reply mixed English intro + Vietnamese headings, e.g.:

> This is a piece of California roll sushi...
> Phù hợp với mục tiêu của bạn:
> ...
> Gợi ý điều chỉnh:

## Root cause

Every prompt builder in the AI pipeline prepended a single-line
`langInstruction` ("Respond ONLY in English") to a **prompt body that was
still 100% Vietnamese**, including hard-coded Vietnamese headings and
Vietnamese few-shot examples inside the required output structure.

The model correctly translated the free-form intro to English but copied
the fixed structural headings (`**Phù hợp với mục tiêu của bạn:**`,
`**Gợi ý điều chỉnh:**`) verbatim from the template's own example.

Files affected: `api/chat.js`, `api/coach-dynamic.js`, `lib/vision.js`.

## The fix

Every prompt builder now branches on language and emits a fully
localized template — headings, rules, and few-shot examples all in one
language. There is exactly one final language before streaming.

Bilingual builders converted:

| File                    | Function                | Purpose                                    |
| ----------------------- | ----------------------- | ------------------------------------------ |
| `api/chat.js`           | `buildNutritionPrompt`  | Vision → nutrition reply (main bug source) |
| `api/chat.js`           | `buildAnalyzePrompt`    | Text food analysis                         |
| `api/chat.js`           | `buildCoachPrompt`      | Coach with plan updates                    |
| `api/chat.js`           | `buildCasualPrompt`     | Off-topic small talk                       |
| `api/coach-dynamic.js`  | `buildHealthCheckPrompt`| 7-day health summary                       |
| `lib/vision.js`         | `VISION_PROMPT` +       | Gemini/Qwen vision base prompt             |
|                         | `NAMING_RULES` +        |                                            |
|                         | `visionLangRule`        |                                            |

Each localized template:
- Opens with an **ABSOLUTE RULE** stating the target language and forbidding
  the other language's headings by name.
- Contains an example whose headings/prose are in the target language.
- Ends with a **language self-check** instruction.
- Keeps authentic Vietnamese dish names (Phở, Bánh mì, Bún bò Huế, Gỏi cuốn,
  Cơm tấm...) as proper nouns in both branches.
- Preserves `meal` storage keys ("Sáng"/"Trưa"/"Tối"/"Phụ") since they are
  keys used elsewhere in the app, not user-facing labels.

Language priority (unchanged in transport, now honored throughout the
prompt): user setting → user request → conversation → English fallback.

## Notes on the other priorities

The remaining priorities in the brief (deeper DB use, RAG tuning,
retrieval quality, ai_usage_logs analysis, image caching, nutrition
determinism) touch the broader architecture and are out of scope for this
minimal-diff fix. The infrastructure they need is already in place:
`resolveNutrition` (nutrition.js) already prefers DB / USDA / OpenFoodFacts
before AI, `retrieveKnowledge` (knowledge.js) already gates RAG chunks,
and `foods`/`nutrition_anchors` are already the first lookup source in
`resolveNutrition`. Extending those is a follow-up.
