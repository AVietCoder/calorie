import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Service-role client for server-side writes that must bypass RLS
 * (e.g. the admin knowledge-base ingestion). Falls back to the anon client
 * when SUPABASE_SERVICE_ROLE_KEY isn't configured — in that case make sure RLS
 * on the knowledge_* tables is disabled or permissive (see
 * scripts/supabase-knowledge.sql).
 */
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabaseAdmin = serviceKey
  ? createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : supabase;

export const hasServiceRole = !!serviceKey;
