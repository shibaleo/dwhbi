/**
 * Zaim → Supabase 日次同期
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_daily.ts
 *   ZAIM_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts
 */

import "jsr:@std/dotenv/load";
import * as log from "../../utils/log.ts";
import { fetchZaimData } from "./fetch_data.ts";
import {
  createZaimDbClient,
  startSyncLog,
  completeSyncLog,
  syncMasters,
  syncTransactions,
  getExistingTransactionIds,
} from "./write_db.ts";
import type { SyncResult } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SYNC_DAYS = 3;

// =============================================================================
// Sync Function
// =============================================================================

/**
 * Zaim データを Supabase に同期
 * @param syncDays 同期する日数（デフォルト: 3）
 */
export async function syncZaimByDays(syncDays?: number): Promise<SyncResult> {
  const startTime = Date.now();
  const days = syncDays ??
    parseInt(Deno.env.get("ZAIM_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS));
  const errors: string[] = [];

  log.syncStart("Zaim", days);

  // 日付範囲計算
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 1);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days - 1);

  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  const zaim = createZaimDbClient();
  let logId: string | null = null;

  // 結果初期化
  let stats = {
    categories: 0,
    genres: 0,
    accounts: 0,
    transactions: { fetched: 0, inserted: 0, updated: 0, skipped: 0 },
  };

  try {
    // Step 1: データ取得
    log.section("Fetching from Zaim API");
    const data = await fetchZaimData({ startDate: startDateStr, endDate: endDateStr });
    logId = await startSyncLog(zaim, data.zaimUserId, "/v2/home/*");

    log.info(`Categories: ${data.categories.length}`);
    log.info(`Genres: ${data.genres.length}`);
    log.info(`Accounts: ${data.accounts.length}`);
    log.info(`Transactions: ${data.transactions.length}`);

    // Step 2: 既存データ確認
    log.section("Checking existing data");
    const existingIds = await getExistingTransactionIds(
      zaim,
      data.zaimUserId,
      startDateStr,
      endDateStr
    );
    log.info(`Existing transactions: ${existingIds.size}`);

    // Step 3: マスタデータ同期
    log.section("Saving masters to DB");
    const masterResult = await syncMasters(
      zaim,
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

    // Step 4: トランザクション同期
    log.section("Saving transactions to DB");
    const txResult = await syncTransactions(
      zaim,
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

    // Step 5: 同期ログ完了
    await completeSyncLog(zaim, logId, "completed", {
      fetched: txResult.fetched,
      inserted: txResult.inserted,
      updated: txResult.updated,
    });

    // 結果集計
    const elapsedSeconds = (Date.now() - startTime) / 1000;

    const result: SyncResult = {
      success: errors.length === 0,
      timestamp: new Date().toISOString(),
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
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    log.error(message);

    if (logId) {
      await completeSyncLog(zaim, logId, "failed", {
        fetched: stats.transactions.fetched,
        inserted: stats.transactions.inserted,
        updated: stats.transactions.updated,
      }, message);
    }

    log.syncEnd(false, elapsedSeconds);

    return {
      success: false,
      timestamp: new Date().toISOString(),
      stats,
      errors,
      elapsedSeconds,
    };
  }
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const result = await syncZaimByDays();
  Deno.exit(result.success ? 0 : 1);
}
