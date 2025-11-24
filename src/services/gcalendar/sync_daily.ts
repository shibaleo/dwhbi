/**
 * Google Calendar → Supabase 日次同期（差分同期対応）
 *
 * operations.sync_state のlast_record_atを起点に、
 * その日以降のデータのみを取得してupsert。
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_daily.ts
 *   deno run --allow-env --allow-net --allow-read sync_daily.ts --full  # フルリフレッシュ
 */

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import * as log from "../../utils/log.ts";
import { fetchEvents } from "./api.ts";
import { getCalendarId } from "./auth.ts";
import { createGCalendarDbClient, upsertEvents, transformEvents } from "./write_db.ts";
import type { SyncResult } from "./types.ts";
import {
  getIncrementalQueryParams,
  updateSyncState,
  logSync,
  extractLatestDate,
} from "../../utils/sync_state.ts";

// =============================================================================
// Constants
// =============================================================================

const SERVICE_NAME = "gcalendar";
const ENDPOINT_EVENTS = "events";
const DEFAULT_SYNC_DAYS = 7;

// =============================================================================
// Sync Function
// =============================================================================

/**
 * Google Calendar データを Supabase に差分同期
 */
export async function syncGCalIncremental(options?: {
  /** フルリフレッシュを強制 */
  forceFullRefresh?: boolean;
  /** フルリフレッシュ時の日数 */
  defaultDays?: number;
}): Promise<SyncResult> {
  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const errors: string[] = [];

  const defaultDays = options?.defaultDays ?? DEFAULT_SYNC_DAYS;

  try {
    // Step 1: クエリパラメータを取得（last_record_atベース）
    const queryParams = await getIncrementalQueryParams(
      SERVICE_NAME,
      ENDPOINT_EVENTS,
      {
        forceFullRefresh: options?.forceFullRefresh,
        defaultDays,
        marginDays: 1,
      }
    );

    // ヘッダー表示
    log.syncStart("Google Calendar", `${queryParams.startDate} ~ ${queryParams.endDate} (${queryParams.mode})`);

    // Step 2: データ取得
    log.section("Fetching from Google Calendar API");

    const calendarId = await getCalendarId();
    const rawEvents = await fetchEvents({
      calendarId,
      timeMin: queryParams.from.toISOString(),
      timeMax: queryParams.to.toISOString(),
    });

    const events = transformEvents(rawEvents, calendarId);

    log.info(`Mode: ${queryParams.mode}`);
    log.info(`Period: ${queryParams.startDate} ~ ${queryParams.endDate}`);
    log.info(`Events: ${events.length}`);

    // Step 3: DB書き込み
    log.section("Saving to DB");
    const client = createGCalendarDbClient();
    const result = await upsertEvents(client, events);

    if (result.failed > 0) {
      errors.push(`events: ${result.failed} failed`);
    }

    // Step 4: 同期状態を更新
    const completedAt = new Date();
    const elapsedMs = Date.now() - startTime;

    // 最新イベントの開始日を取得
    const lastRecordAt = extractLatestDate(events, "start_time");

    await updateSyncState(SERVICE_NAME, ENDPOINT_EVENTS, {
      last_synced_at: completedAt,
      last_record_at: lastRecordAt,
    });

    // 同期ログを記録
    await logSync({
      service_name: SERVICE_NAME,
      endpoint_name: ENDPOINT_EVENTS,
      run_id: runId,
      sync_mode: queryParams.mode,
      query_from: queryParams.startDate,
      query_to: queryParams.endDate,
      status: errors.length === 0 ? "success" : "partial",
      records_fetched: events.length,
      records_inserted: result.success,
      started_at: new Date(startTime).toISOString(),
      completed_at: completedAt.toISOString(),
      elapsed_ms: elapsedMs,
      api_calls: 1,
    });

    // 結果集計
    const elapsedSeconds = elapsedMs / 1000;

    const syncResult: SyncResult = {
      success: errors.length === 0,
      timestamp: completedAt.toISOString(),
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
    if (errors.length > 0) {
      log.warn(`Errors: ${errors.join(", ")}`);
    }

    return syncResult;

  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    log.error(message);

    await logSync({
      service_name: SERVICE_NAME,
      endpoint_name: ENDPOINT_EVENTS,
      run_id: runId,
      sync_mode: "incremental",
      status: "failed",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      elapsed_ms: elapsedMs,
      error_message: message,
    });

    log.syncEnd(false, elapsedMs / 1000);

    return {
      success: false,
      timestamp: new Date().toISOString(),
      stats: { fetched: 0, upserted: 0, skipped: 0 },
      errors,
      elapsedSeconds: elapsedMs / 1000,
    };
  }
}

/**
 * 日数指定での同期（後方互換性用）
 */
export async function syncGCalByDays(syncDays?: number): Promise<SyncResult> {
  return syncGCalIncremental({
    defaultDays: syncDays ?? DEFAULT_SYNC_DAYS,
  });
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ["full", "help"],
    string: ["days"],
    alias: { f: "full", h: "help", d: "days" },
  });

  if (args.help) {
    console.log(`
Google Calendar 差分同期

使用法:
  deno run --allow-env --allow-net --allow-read sync_daily.ts [オプション]

オプション:
  --help, -h    このヘルプを表示
  --full, -f    フルリフレッシュ（過去N日分を取得）
  --days, -d    フルリフレッシュ時の日数（デフォルト: 7）

動作:
  - 初回実行時: 過去N日分をフル取得
  - 2回目以降: last_record_at以降のデータのみ取得（差分同期）
  - --full 指定時: 強制的にフル取得

同期状態は operations.sync_state テーブルに保存されます。
`);
    Deno.exit(0);
  }

  const result = await syncGCalIncremental({
    forceFullRefresh: args.full,
    defaultDays: args.days ? parseInt(args.days) : undefined,
  });

  Deno.exit(result.success ? 0 : 1);
}
