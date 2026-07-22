/**
 * kb-base-store.js — Postgres access for the BUILT-IN disease-routed
 * knowledge base (table `kb_base_chunks`).
 *
 * This is the "diabetes / gout / fatty liver / high cholesterol / kidney /
 * gastrointestinal" corpus that ships with the app. It used to live only in
 * knowledge/knowledge-base.json and get ranked in JS. It's now ALSO seeded
 * into Postgres (see scripts/seed-base-knowledge.mjs) so it can be searched
 * with the exact same engine as the admin-uploaded PDFs: PostgreSQL Full
 * Text Search (tsvector + GIN index + ts_rank) — see migrations/fulltext_search.sql.
 *
 * No embeddings anywhere. Every function is defensive: on error or before
 * the migration/seed has run, it returns an empty array so the chat flow
 * degrades gracefully instead of breaking.
 */
import { supabaseAdmin } from "../supabase.js";

const TABLE = "kb_base_chunks";

let _readyCache = null;

/** Is the kb_base_chunks table present + reachable? (cached) */
export async function baseStoreReady() {
  if (_readyCache !== null) return _readyCache;
  try {
    if (!process.env.SUPABASE_URL) {
      _readyCache = false;
      return false;
    }
    const { error } = await supabaseAdmin.from(TABLE).select("id", { count: "exact", head: true }).limit(1);
    _readyCache = !error;
    if (error) console.warn(`⚠️ [kb-base-store] table not ready: ${error.message}`);
    return _readyCache;
  } catch (err) {
    console.warn(`⚠️ [kb-base-store] baseStoreReady error: ${err.message}`);
    _readyCache = false;
    return false;
  }
}

export function resetBaseStoreCache() {
  _readyCache = null;
}

/** Count rows (for admin diagnostics). */
export async function countBaseChunks() {
  try {
    const { count, error } = await supabaseAdmin.from(TABLE).select("id", { count: "exact", head: true });
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

/**
 * Full Text Search over the built-in disease-routed base layer via the
 * `search_base_kb_chunks` Postgres RPC (tsvector + GIN + ts_rank).
 * @param {string} queryText
 * @param {number} [limit=12]
 * @returns {Promise<Array<{id, disease_key, disease_title, section, text, rank}>>}
 */
export async function searchBaseChunks(queryText, limit = 12) {
  const q = String(queryText || "").trim();
  if (!q) return [];
  try {
    const { data, error } = await supabaseAdmin.rpc("search_base_kb_chunks", {
      query_text: q,
      match_count: limit,
    });
    if (error) {
      console.warn(`⚠️ [kb-base-store] searchBaseChunks: ${error.message}`);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn(`⚠️ [kb-base-store] searchBaseChunks error: ${err.message}`);
    return [];
  }
}

/** Distinct {disease_key, labels} pairs — used for profile.disease routing. */
export async function listDiseaseLabels() {
  try {
    const { data, error } = await supabaseAdmin.from(TABLE).select("disease_key, labels");
    if (error || !Array.isArray(data)) return [];
    const seen = new Map();
    for (const row of data) {
      if (row.disease_key && !seen.has(row.disease_key)) {
        seen.set(row.disease_key, row.labels || []);
      }
    }
    return [...seen.entries()].map(([disease_key, labels]) => ({ disease_key, labels }));
  } catch (err) {
    console.warn(`⚠️ [kb-base-store] listDiseaseLabels error: ${err.message}`);
    return [];
  }
}

export default {
  baseStoreReady,
  resetBaseStoreCache,
  countBaseChunks,
  searchBaseChunks,
  listDiseaseLabels,
};
