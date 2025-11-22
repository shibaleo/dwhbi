/**
 * Google Calendar → Supabase 同期オーケストレーター
 * 
 * 認証 → データ取得 → DB書き込み の一連のフローを実行
 */

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { fetchAllEvents, fetchEventsByDays } from "./fetch_events.ts";
import { createGCalClient, upsertEvents } from "./write_db.ts";
import { SyncOptions, SyncResult, SyncStats } from "./types.ts";

// =============================================================================
// Logging Utilities
// =============================================================================

/**
 * JST形式で現在時刻を取得
 */
function getJstTimestamp(): string {
  return new Date().toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).replace(/\//g, "-");
}

/**
 * ログ出力
 */
function log(level: string, message: string): void {
  const timestamp = getJstTimestamp();
  console.log(`${timestamp} [${level.padEnd(7)}] ${message}`);
}

// =============================================================================
// Sync Functions
// =============================================================================

/**
 * Google Calendar → Supabase 同期を実行
 */
export async function syncGCalToSupabase(options?: SyncOptions): Promise<SyncResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  log("INFO", "=== Google Calendar Sync Started ===");
  
  try {
    // Step 1: データ取得
    log("INFO", "Step 1: Fetching events from Google Calendar...");
    const { events } = await fetchAllEvents(options);
    log("SUCCESS", `Fetched ${events.length} events`);
    
    // Step 2: DB書き込み
    log("INFO", "Step 2: Upserting events to Supabase...");
    const client = createGCalClient();
    const upsertedCount = await upsertEvents(client, events);
    log("SUCCESS", `Upserted ${upsertedCount} events`);
    
    // 統計
    const stats: SyncStats = {
      fetched: events.length,
      upserted: upsertedCount,
      skipped: events.length - upsertedCount,
    };
    
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    
    log("INFO", `=== Sync Completed in ${elapsedSeconds.toFixed(2)}s ===`);
    
    return {
      success: true,
      timestamp,
      stats,
      elapsedSeconds,
    };
    
  } catch (error) {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    log("ERROR", `Sync failed: ${errorMessage}`);
    
    return {
      success: false,
      timestamp,
      stats: { fetched: 0, upserted: 0, skipped: 0 },
      elapsedSeconds,
      error: errorMessage,
    };
  }
}

/**
 * 日数指定で同期を実行（他サービスとの統一インターフェース）
 * @param days 同期する日数（デフォルト: 3）
 */
export async function syncGCalByDays(days: number = 3): Promise<SyncResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  log("INFO", `=== Google Calendar Sync Started (last ${days} days) ===`);
  
  try {
    // Step 1: データ取得
    log("INFO", "Step 1: Fetching events from Google Calendar...");
    const { events } = await fetchEventsByDays(days);
    log("SUCCESS", `Fetched ${events.length} events`);
    
    // Step 2: DB書き込み
    log("INFO", "Step 2: Upserting events to Supabase...");
    const client = createGCalClient();
    const upsertedCount = await upsertEvents(client, events);
    log("SUCCESS", `Upserted ${upsertedCount} events`);
    
    // 統計
    const stats: SyncStats = {
      fetched: events.length,
      upserted: upsertedCount,
      skipped: events.length - upsertedCount,
    };
    
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    
    log("INFO", `=== Sync Completed in ${elapsedSeconds.toFixed(2)}s ===`);
    
    return {
      success: true,
      timestamp,
      stats,
      elapsedSeconds,
    };
    
  } catch (error) {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    log("ERROR", `Sync failed: ${errorMessage}`);
    
    return {
      success: false,
      timestamp,
      stats: { fetched: 0, upserted: 0, skipped: 0 },
      elapsedSeconds,
      error: errorMessage,
    };
  }
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  // 環境変数から同期日数を取得（デフォルト: 3日）
  const syncDaysEnv = Deno.env.get("GCAL_SYNC_DAYS");
  const syncDays = syncDaysEnv ? parseInt(syncDaysEnv, 10) : 3;
  
  if (isNaN(syncDays) || syncDays <= 0) {
    console.error("Invalid GCAL_SYNC_DAYS value. Must be a positive integer.");
    Deno.exit(1);
  }
  
  const result = await syncGCalByDays(syncDays);
  
  // 結果出力
  console.log("\n" + JSON.stringify(result, null, 2));
  
  // 終了コード
  Deno.exit(result.success ? 0 : 1);
}
