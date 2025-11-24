/**
 * Zaim → Supabase 日次同期（差分同期対応）
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
import { fetchZaimData } from "./fetch_data.ts";
import {
  createZaimDbClient,
  upsertMetadata,
  syncTransactions,
  getExistingTransactionIds,
} from "./write_db.ts";
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

const SERVICE_NAME = "zaim";
const ENDPOINT_TRANSACTIONS = "transactions";
const DEFAULT_SYNC_DAYS = 14;

// =============================================================================
// Sync Function
// =============================================================================

/**
 * Zaim データを Supabase に差分同期
 */
export async function syncZaimIncremental(options?: {
  /** フルリフレッシュを強制 */
  forceFullRefresh?: boolean;
  /** フルリフレッシュ時の日数 */
  defaultDays?: number;
}): Promise<SyncResult> {
  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const errors: string[] = [];

  const defaultDays = options?.defaultDays ?? DEFAULT_SYNC_DAYS;

  // 結果初期化
  let stats = {
    categories: 0,
    genres: 0,
    accounts: 0,
    transactions: { fetched: 0, inserted: 0, updated: 0, skipped: 0 },
  };

  try {
    // Step 1: クエリパラメータを取得（last_record_atベース）
    const queryParams = await getIncrementalQueryParams(
      SERVICE_NAME,
      ENDPOINT_TRANSACTIONS,
      {
        forceFullRefresh: options?.forceFullRefresh,
        defaultDays,
        marginDays: 1,
      }
    );

    // ヘッダー表示
    log.syncStart("Zaim", `${queryParams.startDate} ~ ${queryParams.endDate} (${queryParams.mode})`);

    // Step 2: データ取得
    log.section("Fetching from Zaim API");
    const data = await fetchZaimData({
      startDate: queryParams.startDate,
      endDate: queryParams.endDate,
    });

    log.info(`Mode: ${queryParams.mode}`);
    log.info(`Period: ${queryParams.startDate} ~ ${queryParams.endDate}`);
    log.info(`Categories: ${data.categories.length}`);
    log.info(`Genres: ${data.genres.length}`);
    log.info(`Accounts: ${data.accounts.length}`);
    log.info(`Transactions: ${data.transactions.length}`);

    // Step 3: 既存データ確認
    log.section("Checking existing data");
    const raw = createZaimDbClient();
    const existingIds = await getExistingTransactionIds(
      raw,
      data.zaimUserId,
      queryParams.startDate,
      queryParams.endDate
    );
    log.info(`Existing transactions: ${existingIds.size}`);

    // Step 4: メタデータ upsert
    log.section("Saving metadata to DB");
    const masterResult = await upsertMetadata(
      raw,
      data.zaimUserId,
      data.categories,
      data.genres,
      data.accounts
    );

    stats.categories = masterResult.categories.success;
    stats.genres = masterResult.genres.success;
    stats.accounts = masterResult.accounts.success;

    if (masterResult.categories.failed > 0) {
      errors.push(`categories: ${masterResult.categories.failed} failed`);
    }
    if (masterResult.genres.failed > 0) {
      errors.push(`genres: ${masterResult.genres.failed} failed`);
    }
    if (masterResult.accounts.failed > 0) {
      errors.push(`accounts: ${masterResult.accounts.failed} failed`);
    }

    // Step 5: トランザクション同期
    log.section("Saving transactions to DB");
    const txResult = await syncTransactions(
      raw,
      data.zaimUserId,
      data.transactions,
      existingIds
    );

    stats.transactions = {
      fetched: txResult.fetched,
      inserted: txResult.inserted,
      updated: txResult.updated,
      skipped: txResult.skipped,
    };

    if (txResult.failed > 0) {
      errors.push(`transactions: ${txResult.failed} failed`);
    }

    // Step 6: 同期状態を更新
    const completedAt = new Date();
    const elapsedMs = Date.now() - startTime;

    // 最新トランザクションの日付を取得
    const lastRecordAt = extractLatestDate(data.transactions, "date");

    await updateSyncState(SERVICE_NAME, ENDPOINT_TRANSACTIONS, {
      last_synced_at: completedAt,
      last_record_at: lastRecordAt,
    });

    // 同期ログを記録
    await logSync({
      service_name: SERVICE_NAME,
      endpoint_name: ENDPOINT_TRANSACTIONS,
      run_id: runId,
      sync_mode: queryParams.mode,
      query_from: queryParams.startDate,
      query_to: queryParams.endDate,
      status: errors.length === 0 ? "success" : "partial",
      records_fetched: txResult.fetched,
      records_inserted: txResult.inserted,
      records_updated: txResult.updated,
      records_skipped: txResult.skipped,
      started_at: new Date(startTime).toISOString(),
      completed_at: completedAt.toISOString(),
      elapsed_ms: elapsedMs,
      api_calls: 5, // verify + categories + genres + accounts + money
    });

    // 結果集計
    const elapsedSeconds = elapsedMs / 1000;

    const result: SyncResult = {
      success: errors.length === 0,
      timestamp: completedAt.toISOString(),
      stats,
      errors,
      elapsedSeconds,
    };

    // サマリー表示
    log.syncEnd(result.success, elapsedSeconds);
    log.info(`Categories: ${stats.categories}`);
    log.info(`Genres: ${stats.genres}`);
    log.info(`Accounts: ${stats.accounts}`);
    log.info(`Transactions: fetched=${stats.transactions.fetched}, inserted=${stats.transactions.inserted}, updated=${stats.transactions.updated}, skipped=${stats.transactions.skipped}`);
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
      endpoint_name: ENDPOINT_TRANSACTIONS,
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
      stats,
      errors,
      elapsedSeconds: elapsedMs / 1000,
    };
  }
}

/**
 * 日数指定での同期（後方互換性用）
 */
export async function syncZaimByDays(syncDays?: number): Promise<SyncResult> {
  return syncZaimIncremental({
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
Zaim 差分同期

使用法:
  deno run --allow-env --allow-net --allow-read sync_daily.ts [オプション]

オプション:
  --help, -h    このヘルプを表示
  --full, -f    フルリフレッシュ（過去N日分を取得）
  --days, -d    フルリフレッシュ時の日数（デフォルト: 14）

動作:
  - 初回実行時: 過去N日分をフル取得
  - 2回目以降: last_record_at以降のデータのみ取得（差分同期）
  - --full 指定時: 強制的にフル取得

同期状態は operations.sync_state テーブルに保存されます。
`);
    Deno.exit(0);
  }

  const result = await syncZaimIncremental({
    forceFullRefresh: args.full,
    defaultDays: args.days ? parseInt(args.days) : undefined,
  });

  Deno.exit(result.success ? 0 : 1);
}
