/**
 * Supabase client for MCP endpoints
 * Uses anon key without cookie-based auth (MCP requests come from Claude, not browser)
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
