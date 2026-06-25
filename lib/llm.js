/**
 * lib/llm.js — Local LLM client (vLLM) with an OpenAI-compatible interface.
 *
 * vLLM exposes the SAME HTTP protocol as OpenAI (`/v1/chat/completions`,
 * `/v1/embeddings`, ...). So we keep using the official `openai` SDK that the
 * project already depends on — we just point its `baseURL` at our own vLLM
 * server instead of api.openai.com, and pass any string as the API key
 * (vLLM ignores it unless you start vLLM with `--api-key`).
 *
 * Everything is driven by environment variables so you never have to touch
 * the code again when you change model or server address:
 *
 *   LLM_BASE_URL      e.g. http://103.73.232.112:4444/v1   (REQUIRED in prod)
 *                     For local dev over an SSH tunnel:    http://localhost:8000/v1
 *   LLM_API_KEY       any string. Use "EMPTY" if vLLM was started without
 *                     --api-key, or the real token if you started vLLM with one.
 *   LLM_MODEL         the value you passed to `--served-model-name`, e.g. "qwen3-vl"
 *   LLM_VISION_MODEL  (optional) model used for image requests. Defaults to LLM_MODEL,
 *                     which is correct when you serve a single vision-language model
 *                     (Qwen3-VL handles both text and images).
 *
 * Backwards-compatible: if LLM_* are not set it falls back to OPENAI_* so the
 * original OpenAI-cloud setup still works without any changes.
 */
import OpenAI from "openai";

const BASE_URL =
  process.env.LLM_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  "http://localhost:8000/v1";

// vLLM requires *some* non-empty string here even when auth is disabled.
const API_KEY =
  process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "EMPTY";

/** Model name for text chat completions (meal plans, coach replies, JSON). */
export const LLM_MODEL = process.env.LLM_MODEL || "qwen3-vl";

/** Model name for vision requests (analyzing food photos). Same model by default. */
export const LLM_VISION_MODEL = process.env.LLM_VISION_MODEL || LLM_MODEL;

/**
 * A single shared OpenAI-compatible client pointed at vLLM.
 * Import it as `openai` so the rest of the codebase reads unchanged:
 *   import { llm as openai } from "../lib/llm.js";
 */
export const llm = new OpenAI({
  baseURL: BASE_URL,
  apiKey: API_KEY,
});

export default llm;
