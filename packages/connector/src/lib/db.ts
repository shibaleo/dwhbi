/**
 * Supabase database connection
 *
 * Singleton client for Supabase interactions.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

// Load .env for local development
config();

let supabaseClient: SupabaseClient | null = null;

/**
 * Get Supabase client (singleton)
 *
 * @returns Supabase client instance
 * @throws Error if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient !== null) {
    return supabaseClient;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"
    );
  }

  supabaseClient = createClient(url, key);
  return supabaseClient;
}

/**
 * Reset client (for testing)
 */
export function resetClient(): void {
  supabaseClient = null;
}
