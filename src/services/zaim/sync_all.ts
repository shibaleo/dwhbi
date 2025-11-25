/**
 * Zaim → Supabase 全件同期（初回移行・リカバリ用）
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_all.ts
 *   deno run --allow-env --allow-net --allow-read sync_all.ts --start=2020-01-01 --end=2024-12-31
 *   deno run --allow-env --allow-net --allow-read sync_all.ts --metadata-only
 */

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import * as log from "../../utils/log.ts";
import { fetchZaimMetadata, fetchZaimDataWithChunks } from "./fetch_data.ts";
import {
  createZaimDbClient,
  upsertMetadata,
  syncTransactions,
  getExistingTransactionIds,
} from "./write_db.ts";
import type { SyncResult, SyncStats } from "./types.ts";
import {
  updateSyncState,
  logSync,
  extractLatestDate,
} from "../../utils/sync_state.ts";

// =============================================================================
// Constants
// =============================================================================

const SERVICE_NAME = "zaim";
const ENDPOINT_CATEGORIES = "categories";
const ENDPOINT_GENRES = "genres";
const ENDPOINT_ACCOUNTS = "accounts";
const ENDPOINT_TRANSACTIONS = "transactions";

/** デフォルト開始日（環境変数 ZAIM_SYNC_START_DATE から取得、必須） */
function getDefaultStartDate(): string {
  const startDate = Deno.env.get("ZAIM_SYNC_START_DATE");
  if (!startDate) {
    throw new Error("ZAIM_SYNC_START_DATE is not set");
  }
  return startDate;
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// =============================================================================
// Sync Functions
// =============================================================================

/**
 * メタデータのみ同期
 */
async function syncMetadataOnly(runId: string): Promise<{
  zaimUserId: number;
  categories: number;
  genres: number;
  accounts: number;
}> {
  const startTime = Date.now();
  
  // メタデータ取得
  const metadata = await fetchZaimMetadata();

  // DB保存
  log.section("Saving metadata to DB");
  const zaim = createZaimDbClient();
  const masterResult = await upsertMetadata(
    zaim,
    metadata.zaimUserId,
    metadata.categories,
    metadata.genres,
    metadata.accounts
  );

  const completedAt = new Date();
  const elapsedMs = Date.now() - startTime;

  // sync_state更新（マスタデータなのでlast_record_atはnull）
  await updateSyncState(SERVICE_NAME, ENDPOINT_CATEGORIES, {
    last_synced_at: completedAt,
    last_record_at: null,
  });

  await updateSyncState(SERVICE_NAME, ENDPOINT_GENRES, {
    last_synced_at: completedAt,
    last_record_at: null,
  });

  await updateSyncState(SERVICE_NAME, ENDPOINT_ACCOUNTS, {
    last_synced_at: completedAt,
    last_record_at: null,
  });

  // sync_logs記録
  await logSync({
    service_name: SERVICE_NAME,
    endpoint_name: ENDPOINT_CATEGORIES,
    run_id: runId,
    sync_mode: "full",
    status: "success",
    records_fetched: metadata.categories.length,
    records_inserted: masterResult.categories.success,
    records_updated: 0,
    records_skipped: 0,
    started_at: new Date(startTime).toISOString(),
    completed_at: completedAt.toISOString(),
    elapsed_ms: elapsedMs,
    api_calls: 1,
  });

  await logSync({
    service_name: SERVICE_NAME,
    endpoint_name: ENDPOINT_GENRES,
    run_id: runId,
    sync_mode: "full",
    status: "success",
    records_fetched: metadata.genres.length,
    records_inserted: masterResult.genres.success,
    records_updated: 0,
    records_skipped: 0,
    started_at: new Date(startTime).toISOString(),
    completed_at: completedAt.toISOString(),
    elapsed_ms: elapsedMs,
    api_calls: 1,
  });

  await logSync({
    service_name: SERVICE_NAME,
    endpoint_name: ENDPOINT_ACCOUNTS,
    run_id: runId,
    sync_mode: "full",
    status: "success",
    records_fetched: metadata.accounts.length,
    records_inserted: masterResult.accounts.success,
    records_updated: 0,
    records_skipped: 0,
    started_at: new Date(startTime).toISOString(),
    completed_at: completedAt.toISOString(),
    elapsed_ms: elapsedMs,
    api_calls: 1,
  });

  return {
    zaimUserId: metadata.zaimUserId,
    categories: masterResult.categories.success,
    genres: masterResult.genres.success,
    accounts: masterResult.accounts.success,
  };
}

/**
 * Zaim データを全件同期
 */
export async function syncAllZaimData(options: {
  startDate: Date;
  endDate: Date;
  metadataOnly?: boolean;
}): Promise<SyncResult> {
  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const errors: string[] = [];

  const startStr = formatDate(options.startDate);
  const endStr = formatDate(options.endDate);

  log.syncStart("Zaim (Full)", 0);
  console.log(`   期間: ${startStr} 〜 ${endStr}`);
  console.log(`   メタデータのみ: ${options.metadataOnly ? "Yes" : "No"}\n`);

  const zaim = createZaimDbClient();
  let masterStats = { categories: 0, genres: 0, accounts: 0 };
  let transactionStats = { fetched: 0, inserted: 0, updated: 0, skipped: 0 };
  let zaimUserId: number | null = null;
  let data: any = null;

  try {
    if (options.metadataOnly) {
      // メタデータのみ同期
      const result = await syncMetadataOnly(runId);
      zaimUserId = result.zaimUserId;
      masterStats = {
        categories: result.categories,
        genres: result.genres,
        accounts: result.accounts,
      };
    } else {
      // 全データ取得（fetch_data.tsがチャンク処理を担当）
      log.section("Step 1: Fetching all data");
      data = await fetchZaimDataWithChunks(
        options.startDate,
        options.endDate,
        (progress) => {
          // 進捗は fetch_data.ts 内でログ出力されるのでここでは何もしない
        }
      );
      zaimUserId = data.zaimUserId;

      // Step 2: メタデータ upsert
      log.section("Step 2: Saving metadata");
      const metadataStartTime = Date.now();
      const masterResult = await upsertMetadata(
        zaim,
        zaimUserId,
        data.categories,
        data.genres,
        data.accounts
      );
      masterStats = {
        categories: masterResult.categories.success,
        genres: masterResult.genres.success,
        accounts: masterResult.accounts.success,
      };
      log.success(
        `Masters: categories=${masterStats.categories}, genres=${masterStats.genres}, accounts=${masterStats.accounts}`
      );

      const metadataCompletedAt = new Date();
      const metadataElapsedMs = Date.now() - metadataStartTime;

      // メタデータのsync_state更新
      await updateSyncState(SERVICE_NAME, ENDPOINT_CATEGORIES, {
        last_synced_at: metadataCompletedAt,
        last_record_at: null,
      });

      await updateSyncState(SERVICE_NAME, ENDPOINT_GENRES, {
        last_synced_at: metadataCompletedAt,
        last_record_at: null,
      });

      await updateSyncState(SERVICE_NAME, ENDPOINT_ACCOUNTS, {
        last_synced_at: metadataCompletedAt,
        last_record_at: null,
      });

      // メタデータのsync_logs記録
      await logSync({
        service_name: SERVICE_NAME,
        endpoint_name: ENDPOINT_CATEGORIES,
        run_id: runId,
        sync_mode: "full",
        status: masterResult.categories.failed === 0 ? "success" : "partial",
        records_fetched: data.categories.length,
        records_inserted: masterResult.categories.success,
        records_updated: 0,
        records_skipped: 0,
        started_at: new Date(metadataStartTime).toISOString(),
        completed_at: metadataCompletedAt.toISOString(),
        elapsed_ms: metadataElapsedMs,
        api_calls: 1,
      });

      await logSync({
        service_name: SERVICE_NAME,
        endpoint_name: ENDPOINT_GENRES,
        run_id: runId,
        sync_mode: "full",
        status: masterResult.genres.failed === 0 ? "success" : "partial",
        records_fetched: data.genres.length,
        records_inserted: masterResult.genres.success,
        records_updated: 0,
        records_skipped: 0,
        started_at: new Date(metadataStartTime).toISOString(),
        completed_at: metadataCompletedAt.toISOString(),
        elapsed_ms: metadataElapsedMs,
        api_calls: 1,
      });

      await logSync({
        service_name: SERVICE_NAME,
        endpoint_name: ENDPOINT_ACCOUNTS,
        run_id: runId,
        sync_mode: "full",
        status: masterResult.accounts.failed === 0 ? "success" : "partial",
        records_fetched: data.accounts.length,
        records_inserted: masterResult.accounts.success,
        records_updated: 0,
        records_skipped: 0,
        started_at: new Date(metadataStartTime).toISOString(),
        completed_at: metadataCompletedAt.toISOString(),
        elapsed_ms: metadataElapsedMs,
        api_calls: 1,
      });

      // Step 3: トランザクション保存
      log.section("Step 3: Saving transactions");
      const transactionStartTime = Date.now();
      const existingIds = await getExistingTransactionIds(
        zaim,
        zaimUserId,
        startStr,
        endStr
      );

      const txResult = await syncTransactions(
        zaim,
        zaimUserId,
        data.transactions,
        existingIds
      );

      transactionStats = {
        fetched: txResult.fetched,
        inserted: txResult.inserted,
        updated: txResult.updated,
        skipped: txResult.skipped,
      };
      log.success(
        `Transactions: inserted=${txResult.inserted}, updated=${txResult.updated}, skipped=${txResult.skipped}`
      );

      // Step 4: トランザクションのsync_state更新
      log.section("Step 4: Updating sync state");
      const transactionCompletedAt = new Date();
      const transactionElapsedMs = Date.now() - transactionStartTime;
      const lastRecordAt = extractLatestDate(data.transactions, "date");
      
      await updateSyncState(SERVICE_NAME, ENDPOINT_TRANSACTIONS, {
        last_synced_at: transactionCompletedAt,
        last_record_at: lastRecordAt,
      });
      log.success(`Sync state updated: last_record_at=${lastRecordAt}`);

      // Step 5: トランザクションのsync_logs記録
      await logSync({
        service_name: SERVICE_NAME,
        endpoint_name: ENDPOINT_TRANSACTIONS,
        run_id: runId,
        sync_mode: "full",
        query_from: startStr,
        query_to: endStr,
        status: txResult.failed === 0 ? "success" : "partial",
        records_fetched: txResult.fetched,
        records_inserted: txResult.inserted,
        records_updated: txResult.updated,
        records_skipped: txResult.skipped,
        started_at: new Date(transactionStartTime).toISOString(),
        completed_at: transactionCompletedAt.toISOString(),
        elapsed_ms: transactionElapsedMs,
      });
    }

    const completedAt = new Date();
    const elapsedMs = Date.now() - startTime;
    const elapsedSeconds = elapsedMs / 1000;

    const stats: SyncStats = {
      categories: masterStats.categories,
      genres: masterStats.genres,
      accounts: masterStats.accounts,
      transactions: transactionStats,
    };

    const result: SyncResult = {
      success: true,
      timestamp: completedAt.toISOString(),
      stats,
      errors: [],
      elapsedSeconds,
    };

    // サマリー表示
    console.log("\n" + "=".repeat(60));
    log.syncEnd(true, elapsedSeconds);
    log.info(`Categories: ${stats.categories}`);
    log.info(`Genres: ${stats.genres}`);
    log.info(`Accounts: ${stats.accounts}`);
    if (!options.metadataOnly) {
      log.info(`Transactions: ${stats.transactions.fetched}`);
      log.info(`  Inserted: ${stats.transactions.inserted}`);
      log.info(`  Updated: ${stats.transactions.updated}`);
      log.info(`  Skipped: ${stats.transactions.skipped}`);
    }
    console.log("=".repeat(60));

    return result;

  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    const elapsedSeconds = elapsedMs / 1000;
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    log.error(message);

    // エラー時のログ記録（トランザクションのみ）
    await logSync({
      service_name: SERVICE_NAME,
      endpoint_name: ENDPOINT_TRANSACTIONS,
      run_id: runId,
      sync_mode: "full",
      query_from: startStr,
      query_to: endStr,
      status: "failed",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      elapsed_ms: elapsedMs,
      error_message: message,
    });

    log.syncEnd(false, elapsedSeconds);

    return {
      success: false,
      timestamp: new Date().toISOString(),
      stats: {
        categories: masterStats.categories,
        genres: masterStats.genres,
        accounts: masterStats.accounts,
        transactions: transactionStats,
      },
      errors,
      elapsedSeconds,
    };
  }
}

// =============================================================================
// CLI Entry Point
// =============================================================================

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["start", "end"],
    boolean: ["help", "metadata-only"],
    alias: { h: "help", s: "start", e: "end", m: "metadata-only" },
  });

  if (args.help) {
    console.log(`
Zaim 全件同期（初回移行・リカバリ用）

使用法:
  deno run --allow-env --allow-net --allow-read sync_all.ts [オプション]

オプション:
  --help, -h           このヘルプを表示
  --start, -s          開始日（YYYY-MM-DD）デフォルト: 環境変数 ZAIM_SYNC_START_DATE
  --end, -e            終了日（YYYY-MM-DD）デフォルト: 今日
  --metadata-only, -m  メタデータ（categories/genres/accounts）のみ同期

例:
  # デフォルト（ZAIM_SYNC_START_DATEから今日まで）
  deno run --allow-env --allow-net --allow-read sync_all.ts

  # 特定期間
  deno run --allow-env --allow-net --allow-read sync_all.ts --start=2020-01-01 --end=2024-12-31

  # メタデータのみ
  deno run --allow-env --allow-net --allow-read sync_all.ts --metadata-only

環境変数:
  SUPABASE_URL              Supabase URL
  SUPABASE_SERVICE_ROLE_KEY Supabase Service Role Key
  ZAIM_CONSUMER_KEY         Zaim Consumer Key
  ZAIM_CONSUMER_SECRET      Zaim Consumer Secret
  ZAIM_ACCESS_TOKEN         Zaim Access Token
  ZAIM_ACCESS_TOKEN_SECRET  Zaim Access Token Secret
  ZAIM_SYNC_START_DATE      デフォルト開始日（必須、--start未指定時）

注意:
  - 12ヶ月単位でチャンク分割して取得します
  - レート制限エラー時は自動で待機・リトライします
  - categories/genres/accounts/transactionsそれぞれのsync_stateとsync_logsを記録します
`);
    Deno.exit(0);
  }

  const startDate = args.start
    ? new Date(args.start)
    : new Date(getDefaultStartDate());
  const endDate = args.end ? new Date(args.end) : new Date();

  // 日付の妥当性チェック
  if (isNaN(startDate.getTime())) {
    console.error("❌ 無効な開始日です");
    Deno.exit(1);
  }
  if (isNaN(endDate.getTime())) {
    console.error("❌ 無効な終了日です");
    Deno.exit(1);
  }
  if (startDate > endDate) {
    console.error("❌ 開始日は終了日より前である必要があります");
    Deno.exit(1);
  }

  try {
    const result = await syncAllZaimData({
      startDate,
      endDate,
      metadataOnly: args["metadata-only"],
    });

    Deno.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
