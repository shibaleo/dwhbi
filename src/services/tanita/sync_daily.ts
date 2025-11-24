/**
 * Tanita → Supabase 日次同期（差分同期対応）
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
import { ensureValidToken } from "./auth.ts";
import { fetchTanitaData } from "./fetch_data.ts";
import {
  createTanitaDbClient,
  saveBloodPressure,
  saveBodyComposition,
  saveSteps,
} from "./write_db.ts";
import type { SyncResult } from "./types.ts";
import {
  getIncrementalQueryParams,
  updateSyncState,
  logSync,
  getLatestRecordDate,
} from "../../utils/sync_state.ts";

// =============================================================================
// Constants
// =============================================================================

const SERVICE_NAME = "tanita";
const ENDPOINT_BODY = "body_composition"; // 代表エンドポイント
const DEFAULT_SYNC_DAYS = 7;

// =============================================================================
// Sync Function
// =============================================================================

/**
 * Tanita データを Supabase に差分同期
 */
export async function syncTanitaIncremental(options?: {
  /** フルリフレッシュを強制 */
  forceFullRefresh?: boolean;
  /** フルリフレッシュ時の日数 */
  defaultDays?: number;
}): Promise<SyncResult> {
  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const errors: string[] = [];

  const defaultDays = options?.defaultDays ?? DEFAULT_SYNC_DAYS;

  // 1. トークン確認（必要ならリフレッシュ）
  let accessToken: string;
  try {
    accessToken = await ensureValidToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Auth error: ${message}`);
    return {
      success: false,
      timestamp: new Date().toISOString(),
      stats: { bodyComposition: 0, bloodPressure: 0, steps: 0 },
      errors: [message],
      elapsedSeconds: (Date.now() - startTime) / 1000,
    };
  }

  try {
    // Step 2: クエリパラメータを取得（last_record_atベース）
    const queryParams = await getIncrementalQueryParams(
      SERVICE_NAME,
      ENDPOINT_BODY,
      {
        forceFullRefresh: options?.forceFullRefresh,
        defaultDays,
        marginDays: 1,
      }
    );

    // ヘッダー表示
    log.syncStart("Tanita", `${queryParams.startDate} ~ ${queryParams.endDate} (${queryParams.mode})`);

    // Step 3: データ取得
    const data = await fetchTanitaData(accessToken, {
      startDate: queryParams.from,
      endDate: queryParams.to,
    });

    // Step 4: DB保存
    log.section("Saving to DB");
    const supabase = createTanitaDbClient();

    const bodyResult = await saveBodyComposition(supabase, data.bodyComposition);
    const bpResult = await saveBloodPressure(supabase, data.bloodPressure);
    const stepsResult = await saveSteps(supabase, data.steps);

    // エラー集計
    if (bodyResult.failed > 0) errors.push(`body composition: ${bodyResult.failed} failed`);
    if (bpResult.failed > 0) errors.push(`blood pressure: ${bpResult.failed} failed`);
    if (stepsResult.failed > 0) errors.push(`steps: ${stepsResult.failed} failed`);

    // Step 5: 同期状態を更新
    const completedAt = new Date();
    const elapsedMs = Date.now() - startTime;

    // 最新の体組成データの日付をDBから取得（代表）
    // rawテーブルのtimestamptzは既にUTC
    const lastRecordAt = await getLatestRecordDate("tanita_body_composition", "measured_at") ?? queryParams.to;

    await updateSyncState(SERVICE_NAME, ENDPOINT_BODY, {
      last_synced_at: completedAt,
      last_record_at: lastRecordAt,
    });

    // 同期ログを記録
    const totalRecords = bodyResult.success + bpResult.success + stepsResult.success;

    await logSync({
      service_name: SERVICE_NAME,
      endpoint_name: ENDPOINT_BODY,
      run_id: runId,
      sync_mode: queryParams.mode,
      query_from: queryParams.startDate,
      query_to: queryParams.endDate,
      status: errors.length === 0 ? "success" : "partial",
      records_fetched: totalRecords,
      records_inserted: totalRecords,
      started_at: new Date(startTime).toISOString(),
      completed_at: completedAt.toISOString(),
      elapsed_ms: elapsedMs,
      api_calls: 3, // body + bp + steps
    });

    // 結果集計
    const elapsedSeconds = elapsedMs / 1000;

    const result: SyncResult = {
      success: errors.length === 0,
      timestamp: completedAt.toISOString(),
      stats: {
        bodyComposition: bodyResult.success,
        bloodPressure: bpResult.success,
        steps: stepsResult.success,
      },
      errors,
      elapsedSeconds,
    };

    // サマリー表示
    log.syncEnd(result.success, result.elapsedSeconds);
    log.info(`Body composition: ${result.stats.bodyComposition}`);
    log.info(`Blood pressure: ${result.stats.bloodPressure}`);
    log.info(`Steps: ${result.stats.steps}`);
    if (errors.length > 0) {
      log.warn(`Errors: ${errors.join(", ")}`);
    }

    return result;

  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    log.error(message);

    await logSync({
      service_name: SERVICE_NAME,
      endpoint_name: ENDPOINT_BODY,
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
      stats: { bodyComposition: 0, bloodPressure: 0, steps: 0 },
      errors,
      elapsedSeconds: elapsedMs / 1000,
    };
  }
}

/**
 * 日数指定での同期（後方互換性用）
 */
export async function syncTanitaByDays(syncDays?: number): Promise<SyncResult> {
  return syncTanitaIncremental({
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
Tanita 差分同期

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

  const result = await syncTanitaIncremental({
    forceFullRefresh: args.full,
    defaultDays: args.days ? parseInt(args.days) : undefined,
  });

  Deno.exit(result.success ? 0 : 1);
}
