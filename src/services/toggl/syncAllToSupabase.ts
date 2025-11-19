import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { TogglReportsEntry } from "./types.ts";
import { getEntries } from "./getEntries.ts";

// --- Get environment variables ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in .env");
}

// --- Create Supabase client ---
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
 */
async function upsertEntriesToSupabase(entries: TogglReportsEntry[]) {
  if (entries.length === 0) {
    console.log("No entries to upsert");
    return 0;
  }

  console.log(`Upserting ${entries.length} entries to Supabase...`);
  
  const rows = entries.map(transformEntryForDB);
  const chunkSize = 100;
  let totalUpserted = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    
    const { data, error } = await supabase
      .from("toggl_time_entries")
      .upsert(chunk, {
        onConflict: "id",
        ignoreDuplicates: false,
      })
      .select();

    if (error) {
      console.error(`Error upserting chunk:`, error);
      throw error;
    }

    totalUpserted += data?.length || chunk.length;
  }

  console.log(`✓ Successfully upserted ${totalUpserted} entries`);
  return totalUpserted;
}

/**
 * Generate month ranges from start date to end date
 */
function generateMonthRanges(startDate: Date, endDate: Date): Array<{ start: Date; end: Date }> {
  const ranges: Array<{ start: Date; end: Date }> = [];
  
  let currentStart = new Date(startDate);
  currentStart.setDate(1);
  currentStart.setHours(0, 0, 0, 0);
  
  while (currentStart <= endDate) {
    const currentEnd = new Date(currentStart);
    currentEnd.setMonth(currentEnd.getMonth() + 1);
    currentEnd.setDate(0); // Last day of current month
    currentEnd.setHours(23, 59, 59, 999);
    
    if (currentEnd > endDate) {
      currentEnd.setTime(endDate.getTime());
    }
    
    ranges.push({
      start: new Date(currentStart),
      end: new Date(currentEnd),
    });
    
    currentStart.setMonth(currentStart.getMonth() + 1);
  }
  
  return ranges;
}

/**
 * Sync all Toggl entries from 2023-11-01 to present
 */
async function syncAllToSupabase() {
  const startDate = new Date("2024-07-01T00:00:00+09:00");
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  
  console.log("====================================");
  console.log("Starting full sync");
  console.log(`Period: ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`);
  console.log("====================================\n");
  
  const monthRanges = generateMonthRanges(startDate, endDate);
  console.log(`Processing ${monthRanges.length} months\n`);
  
  let totalEntries = 0;
  let totalUpserted = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < monthRanges.length; i++) {
    const range = monthRanges[i];
    console.log(`Month ${i + 1}/${monthRanges.length}: ${range.start.toISOString().split("T")[0]} to ${range.end.toISOString().split("T")[0]}`);
    
    try {
      const entries = await getEntries(range.start, range.end);
      totalEntries += entries.length;
      
      const upserted = await upsertEntriesToSupabase(entries);
      totalUpserted += upserted;
      
      // 10分待機（レート制限回避）
      if (i < monthRanges.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 60*60*1000)); // 60 minutes
      }
      
    } catch (error) {
      console.error(`Failed to process month ${i + 1}:`, error);
      throw error;
    }
  }
  
  const elapsedTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log("\n====================================");
  console.log("Sync completed!");
  console.log(`Total entries: ${totalEntries}`);
  console.log(`Total upserted: ${totalUpserted}`);
  console.log(`Time elapsed: ${elapsedTime} minutes`);
  console.log("====================================");
}

// Execute
if (import.meta.main) {
  try {
    await syncAllToSupabase();
  } catch (error) {
    console.error("Sync failed:", error);
    Deno.exit(1);
  }
}