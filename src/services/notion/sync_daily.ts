/**
 * Notion → Supabase 日次同期
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_daily.ts
 *   NOTION_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts
 */

import "jsr:@std/dotenv/load";
import * as log from "../../utils/log.ts";
import { fetchNotionDataByDays } from "./fetch_data.ts";
import { syncAllTableData } from "./write_db.ts";
import { updateLastSyncedAt } from "./fetch_config.ts";
import { executeSchemaSync } from "./sync_schema.ts";
import { discoverAndRegisterDatabases } from "./discover_databases.ts";
import type { SyncResult, SyncStats, TableSyncStats } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SYNC_DAYS = 3;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * TableSyncStats配列からSyncStatsを集計
 */
function aggregateStats(tableStats: TableSyncStats[]): SyncStats {
  let totalFetched = 0;
  let totalSaved = 0;
  let totalFailed = 0;

  for (const stats of tableStats) {
    totalFetched += stats.fetched;
    totalSaved += stats.saved;
    totalFailed += stats.failed;
  }

  return {
    tables: tableStats,
    totalFetched,
    totalSaved,
    totalFailed,
  };
}

// =============================================================================
// Sync Function
// =============================================================================

/**
 * Notion データを Supabase に同期
 * @param syncDays 同期する日数（transaction同期でlast_synced_atがない場合に使用）
 */
export async function syncNotionByDays(syncDays?: number): Promise<SyncResult> {
  const startTime = Date.now();
  const days = syncDays ??
    parseInt(Deno.env.get("NOTION_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS));
  const errors: string[] = [];

  log.syncStart("Notion", days);

  try {
    // Step 0: データベース検出（オプショナル）
    const enableDiscover = Deno.env.get("NOTION_DISCOVER_DATABASES")?.toLowerCase() === "true";
    
    if (enableDiscover) {
      try {
        const discoverResult = await discoverAndRegisterDatabases();
        
        if (discoverResult.newlyAdded > 0) {
          log.success(`Discovered and registered ${discoverResult.newlyAdded} new database(s)`);
          log.info("Update TB__METADATA to enable sync for new databases");
        } else {
          log.info("No new databases found");
        }
      } catch (discoverErr) {
        const msg = `Database discovery failed: ${discoverErr instanceof Error ? discoverErr.message : discoverErr}`;
        log.warn(msg);
        errors.push(msg);
      }
    }

    // Step 1: スキーマ同期（テーブル自動作成）
    const skipSchemaSync = Deno.env.get("NOTION_SKIP_SCHEMA_SYNC")?.toLowerCase() === "true";
    
    if (!skipSchemaSync) {
      log.section("Ensuring tables exist");
      try {
        await executeSchemaSync();
      } catch (schemaErr) {
        // エラーの詳細情報を取得
        let errorMsg: string;
        if (schemaErr instanceof Error) {
          errorMsg = schemaErr.message;
          // スタックトレースがあれば追加（開発時のみ）
          if (schemaErr.stack && Deno.env.get("DEBUG")) {
            log.error(`Stack trace: ${schemaErr.stack}`);
          }
        } else if (typeof schemaErr === "object" && schemaErr !== null) {
          // オブジェクトの場合はJSON化
          try {
            errorMsg = JSON.stringify(schemaErr, null, 2);
          } catch {
            errorMsg = String(schemaErr);
          }
        } else {
          errorMsg = String(schemaErr);
        }

        // DB接続情報がない場合は警告のみで続行
        if (errorMsg.includes("Database connection configuration missing")) {
          log.warn("Database connection not configured - skipping auto table creation");
          log.warn("Set SUPABASE_DB_PASSWORD to enable auto table creation");
        } else {
          log.error(`Schema sync failed: ${errorMsg}`);
          errors.push(`Schema sync error: ${errorMsg}`);
        }
      }
    }

    // Step 2: データ取得
    log.section("Fetching from Notion API");
    const dataList = await fetchNotionDataByDays(days);

    if (dataList.length === 0) {
      log.warn("No data to sync");
      const elapsedSeconds = (Date.now() - startTime) / 1000;
      log.syncEnd(true, elapsedSeconds);

      return {
        success: true,
        timestamp: new Date().toISOString(),
        stats: {
          tables: [],
          totalFetched: 0,
          totalSaved: 0,
          totalFailed: 0,
        },
        errors,
        elapsedSeconds,
      };
    }

    // 取得結果サマリー
    for (const data of dataList) {
      log.info(`${data.config.name}: ${data.pages.length} pages`);
    }

    // Step 3: DB保存
    log.section("Saving to Supabase");
    const tableStats = await syncAllTableData(dataList);

    // エラー集計
    for (const stats of tableStats) {
      if (stats.failed > 0) {
        errors.push(`${stats.table}: ${stats.failed} failed`);
      }
    }

    // Step 4: 最終同期日時を更新（並列化）
    log.section("Updating last_synced_at");
    const now = new Date().toISOString();

    await Promise.all(
      dataList.map(async (data) => {
        try {
          await updateLastSyncedAt(data.config.pageId, now);
          log.info(`  ${data.config.name}: updated`);
        } catch (err) {
          const msg = `Failed to update last_synced_at for "${data.config.name}": ${err instanceof Error ? err.message : err}`;
          log.error(msg);
          errors.push(msg);
        }
      })
    );

    // 結果集計
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const stats = aggregateStats(tableStats);

    const result: SyncResult = {
      success: errors.length === 0,
      timestamp: now,
      stats,
      errors,
      elapsedSeconds,
    };

    // サマリー表示
    log.syncEnd(result.success, elapsedSeconds);
    log.info(`Tables synced: ${stats.tables.length}`);
    log.info(`Total fetched: ${stats.totalFetched}`);
    log.info(`Total saved: ${stats.totalSaved}`);
    if (stats.totalFailed > 0) {
      log.warn(`Total failed: ${stats.totalFailed}`);
    }
    if (errors.length > 0) {
      log.warn(`Errors: ${errors.join(", ")}`);
    }

    return result;

  } catch (err) {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    log.error(message);

    log.syncEnd(false, elapsedSeconds);

    return {
      success: false,
      timestamp: new Date().toISOString(),
      stats: {
        tables: [],
        totalFetched: 0,
        totalSaved: 0,
        totalFailed: 0,
      },
      errors,
      elapsedSeconds,
    };
  }
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const result = await syncNotionByDays();
  Deno.exit(result.success ? 0 : 1);
}
