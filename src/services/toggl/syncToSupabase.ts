import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getEntries, getLatestEntries } from "./getEntries.ts";
import { TogglReportsEntry } from "./types.ts";

// Get environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in .env");
}

// Create Supabase client with service role key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Transform TogglReportsEntry to database row format
 */
function transformEntryForDB(entry: TogglReportsEntry) {
  return {
    id: entry.id,
    pid: entry.pid,
    tid: entry.tid,
    uid: entry.uid,
    description: entry.description,
    start: entry.start,
    end: entry.end,
    updated: entry.updated,
    dur: entry.dur,
    user: entry.user,
    use_stop: entry.use_stop,
    client: entry.client,
    project: entry.project,
    project_color: entry.project_color,
    project_hex_color: entry.project_hex_color,
    billable: entry.billable,
    is_billable: entry.is_billable,
    cur: entry.cur,
    tags: entry.tags,
    synced_at: new Date().toISOString(),
  };
}

/**
 * Upsert Toggl entries to Supabase
 * @param entries Array of Toggl entries to upsert
 * @returns Number of entries successfully upserted
 */
export async function upsertEntriesToSupabase(entries: TogglReportsEntry[]) {
  if (entries.length === 0) {
    console.log("No entries to upsert");
    return 0;
  }

  console.log(`Upserting ${entries.length} entries to Supabase...`);

  // Transform entries to database format
  const rows = entries.map(transformEntryForDB);

  // Upsert to Supabase (insert or update based on id)
  const { data, error } = await supabase
    .from("toggl_time_entries")
    .upsert(rows, {
      onConflict: "id", // Use id as the conflict resolution column
      ignoreDuplicates: false, // Update existing rows instead of ignoring
    })
    .select();

  if (error) {
    console.error("Error upserting entries:", error);
    throw error;
  }

  console.log(`✓ Successfully upserted ${data?.length || entries.length} entries`);
  return data?.length || entries.length;
}

/**
 * Sync Toggl entries for a date range to Supabase
 */
export async function syncEntriesByDateRange(startDate: Date, endDate: Date) {
  console.log(`Syncing entries from ${startDate.toISOString()} to ${endDate.toISOString()}`);

  const entries = await getEntries(startDate, endDate);
  const count = await upsertEntriesToSupabase(entries);

  return count;
}

/**
 * Sync latest Toggl entries to Supabase
 */
export async function syncLatestEntries(start: Date, end: Date) {
  console.log("Syncing latest entries...");

  const entries = await getLatestEntries(start, end);
  const count = await upsertEntriesToSupabase(entries);

  return count;
}

// Example execution
if (import.meta.main) {
  // Example 1: Sync specific date range
  const end = new Date();
  const start = new Date(end.getTime() - 2 * 24 * 60 * 60 * 1000); // past 2 days
  
  // await syncEntriesByDateRange(start, end);

  // Example 2: Sync latest entries
  await syncLatestEntries(start, end);
}
