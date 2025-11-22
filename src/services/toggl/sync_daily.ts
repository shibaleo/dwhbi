// sync_daily.ts - Togglデータの日次同期

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { fetchAllData } from "./api.ts";
import {
  createTogglClient,
  upsertMetadata,
  upsertEntries,
} from "./write_db.ts";
import type { SyncResult, SyncStats } from "./types.ts";

// --- Logging utilities ---

/**
 * JST形式の日時文字列を生成（YYYY-MM-DD HH:mm:ss）
 */
function formatDateTime(): string {
  const now = new Date();
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));

  const year = jst.getFullYear();
  const month = String(jst.getMonth() + 1).padStart(2, "0");
  const day = String(jst.getDate()).padStart(2, "0");
  const hours = String(jst.getHours()).padStart(2, "0");
  const minutes = String(jst.getMinutes()).padStart(2, "0");
  const seconds = String(jst.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function logInfo(message: string) {
  console.log(`${"[INFO]".padEnd(9)} ${formatDateTime()} - ${message}`);
}

function logSuccess(message: string) {
  console.log(`${"[SUCCESS]".padEnd(9)} ${formatDateTime()} - ${message}`);
}

function logError(message: string, error?: unknown) {
  console.error(`${"[ERROR]".padEnd(9)} ${formatDateTime()} - ${message}`);
  if (error) {
    console.error(error);
  }
}

// --- Main sync function ---

/**
 * TogglデータをSupabaseに同期
 * @param days 同期する日数（デフォルト: 1）
 */
export async function syncTogglToSupabase(days: number = 1): Promise<SyncResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  logInfo("=== Starting Toggl to Supabase sync ===");

  try {
    // Step 1: Fetch all data from Toggl
    logInfo(`Step 1: Fetching data from Toggl API (last ${days} day(s))...`);
    const data = await fetchAllData(days);

    logSuccess(
      `Fetched: ${data.clients.length} clients, ${data.projects.length} projects, ` +
      `${data.tags.length} tags, ${data.entries.length} entries`
    );

    // Step 2: Create Supabase client
    const toggl = createTogglClient();

    // Step 3: Sync metadata (parallel)
    logInfo("Step 2: Syncing metadata to Supabase...");
    const metadataStats = await upsertMetadata(
      toggl,
      data.clients,
      data.projects,
      data.tags
    );

    logSuccess(
      `Metadata synced: ${metadataStats.clients} clients, ` +
      `${metadataStats.projects} projects, ${metadataStats.tags} tags`
    );

    // Step 4: Sync entries (after metadata due to foreign key constraints)
    logInfo("Step 3: Syncing entries to Supabase...");
    const entriesCount = await upsertEntries(toggl, data.entries);

    logSuccess(`Entries synced: ${entriesCount} entries`);

    // Summary
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const stats: SyncStats = {
      clients: metadataStats.clients,
      projects: metadataStats.projects,
      tags: metadataStats.tags,
      entries: entriesCount,
    };

    logSuccess(`=== Sync completed in ${elapsedSeconds.toFixed(2)}s ===`);
    logSuccess(
      `Summary: ${stats.clients} clients, ${stats.projects} projects, ` +
      `${stats.tags} tags, ${stats.entries} entries`
    );

    return {
      success: true,
      timestamp,
      stats,
      elapsedSeconds,
    };

  } catch (error) {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logError("Sync failed", error);

    return {
      success: false,
      timestamp,
      stats: { clients: 0, projects: 0, tags: 0, entries: 0 },
      elapsedSeconds,
      error: errorMessage,
    };
  }
}

// --- CLI execution ---

if (import.meta.main) {
  const syncDays = parseInt(Deno.env.get("TOGGL_SYNC_DAYS") || "1", 10);

  try {
    const result = await syncTogglToSupabase(syncDays);
    Deno.exit(result.success ? 0 : 1);
  } catch (error) {
    logError("Fatal error", error);
    Deno.exit(1);
  }
}
