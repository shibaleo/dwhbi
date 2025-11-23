/**
 * Notion → Supabase 全件同期
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_all.ts
 *   deno run --allow-env --allow-net --allow-read sync_all.ts --table GCAL_MAPPING
 *   deno run --allow-env --allow-net --allow-read sync_all.ts --force
 */

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import * as log from "../../utils/log.ts";
import { fetchAllNotionData } from "./fetch_data.ts";
import { syncAllTableData } from "./write_db.ts";
import { updateLastSyncedAt } from "./fetch_config.ts";
import type { SyncResult, SyncStats, TableSyncStats } from "./types.ts";

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

function printUsage(): void {
  console.log(`
Notion Full Sync

Usage:
  deno run --allow-env --allow-net --allow-read sync_all.ts [options]

Options:
  -h, --help      Show this help
  -t, --table     Sync specific table by name (e.g., GCAL_MAPPING)
  -f, --force     Sync even if disabled in metadata table

Examples:
  # Sync all enabled tables
  deno run --allow-env --allow-net --allow-read sync_all.ts

  # Sync specific table
  deno run --allow-env --allow-net --allow-read sync_all.ts --table SAUNA

  # Force sync disabled table
  deno run --allow-env --allow-net --allow-read sync_all.ts --table ARCHIVED --force
`);
}

// =============================================================================
// Sync Function
// =============================================================================

/**
 * Notion 全件同期
 */
export async function syncAllNotionData(options?: {
  tableName?: string;
  force?: boolean;
}): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  log.header("Notion Full Sync", options);

  try {
    // Step 1: データ取得
    log.section("Fetching all data from Notion API");
    const dataList = await fetchAllNotionData({
      tableName: options?.tableName,
      force: options?.force,
    });

    if (dataList.length === 0) {
      log.warn("No data to sync");
      const elapsedSeconds = (Date.now() - startTime) / 1000;
      log.footer(true);

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

    // Step 2: DB保存
    log.section("Saving to Supabase");
    const tableStats = await syncAllTableData(dataList);

    // エラー集計
    for (const stats of tableStats) {
      if (stats.failed > 0) {
        errors.push(`${stats.table}: ${stats.failed} failed`);
      }
    }

    // Step 3: 最終同期日時を更新
    log.section("Updating last_synced_at");
    const now = new Date().toISOString();

    for (const data of dataList) {
      try {
        await updateLastSyncedAt(data.config.pageId, now);
        log.info(`  ${data.config.name}: updated`);
      } catch (err) {
        const msg = `Failed to update last_synced_at for "${data.config.name}": ${err instanceof Error ? err.message : err}`;
        log.error(msg);
        errors.push(msg);
      }
    }

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
    log.footer(result.success);
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

    log.footer(false);

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
  const args = parseArgs(Deno.args, {
    alias: {
      h: "help",
      t: "table",
      f: "force",
    },
    boolean: ["help", "force"],
    string: ["table"],
  });

  if (args.help) {
    printUsage();
    Deno.exit(0);
  }

  const result = await syncAllNotionData({
    tableName: args.table,
    force: args.force,
  });

  Deno.exit(result.success ? 0 : 1);
}
