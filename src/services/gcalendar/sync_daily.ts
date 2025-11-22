/**
 * Google Calendar → Supabase 日次同期
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_daily.ts
 *   GCAL_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts
 */

import "jsr:@std/dotenv/load";
import * as log from "../../utils/log.ts";
import { fetchEventsByDays } from "./fetch_data.ts";
import { createGCalendarDbClient, upsertEvents } from "./write_db.ts";
import type { SyncResult } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SYNC_DAYS = 3;

// =============================================================================
// Sync Function
// =============================================================================

/**
 * Google Calendar データを Supabase に同期
 * @param syncDays 同期する日数（デフォルト: 3）
 */
export async function syncGCalByDays(syncDays?: number): Promise<SyncResult> {
  const startTime = Date.now();
  const days = syncDays ??
    parseInt(Deno.env.get("GCAL_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS));
  const errors: string[] = [];

  log.syncStart("Google Calendar", days);

  try {
    // Step 1: データ取得
    log.section("Fetching from Google Calendar API");
    const { events } = await fetchEventsByDays(days);
    log.info(`Fetched: ${events.length} events`);

    // Step 2: DB書き込み
    log.section("Saving to DB");
    const client = createGCalendarDbClient();
    const result = await upsertEvents(client, events);

    if (result.failed > 0) {
      errors.push(`events: ${result.failed} failed`);
    }

    // 結果集計
    const elapsedSeconds = (Date.now() - startTime) / 1000;

    const syncResult: SyncResult = {
      success: errors.length === 0,
      timestamp: new Date().toISOString(),
      stats: {
        fetched: events.length,
        upserted: result.success,
        skipped: events.length - result.success,
      },
      errors,
      elapsedSeconds,
    };

    // サマリー表示
    log.syncEnd(syncResult.success, elapsedSeconds);
    log.info(`Fetched: ${syncResult.stats.fetched}`);
    log.info(`Upserted: ${syncResult.stats.upserted}`);
    log.info(`Skipped: ${syncResult.stats.skipped}`);
    if (errors.length > 0) {
      log.warn(`Errors: ${errors.join(", ")}`);
    }

    return syncResult;

  } catch (err) {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    log.error(message);

    log.syncEnd(false, elapsedSeconds);

    return {
      success: false,
      timestamp: new Date().toISOString(),
      stats: { fetched: 0, upserted: 0, skipped: 0 },
      errors,
      elapsedSeconds,
    };
  }
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const result = await syncGCalByDays();
  Deno.exit(result.success ? 0 : 1);
}
