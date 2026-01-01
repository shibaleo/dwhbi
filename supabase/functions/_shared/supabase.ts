import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function createClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  return createSupabaseClient(supabaseUrl, supabaseKey);
}
