/**
 * Zaim → Supabase 全件同期（初回移行・リカバリ用）
 *
 * 年単位でチャンク分割してデータを取得します。
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_all.ts
 *   deno run --allow-env --allow-net --allow-read sync_all.ts --start=2020-01-01 --end=2024-12-31
 *   deno run --allow-env --allow-net --allow-read sync_all.ts --resume=2023
 */

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import * as log from "../../utils/log.ts";
import { fetchZaimData } from "./fetch_data.ts";
import {
  createZaimDbClient,
  syncMasters,
  syncTransactions,
  getExistingTransactionIds,
} from "./write_db.ts";
import type { SyncResult, SyncStats } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

/** デフォルト開始日（環境変数 ZAIM_SYNC_START_DATE から取得、必須） */
function getDefaultStartDate(): string {
  const startDate = Deno.env.get("ZAIM_SYNC_START_DATE");
  if (!startDate) {
    throw new Error("ZAIM_SYNC_START_DATE is not set");
  }
  return startDate;
}

/** チャンク間の待機時間（ms） */
const DELAY_BETWEEN_YEARS = 200;

// =============================================================================
// Helper Functions
// =============================================================================

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 年単位の日付範囲を取得
 */
function getYearDateRange(
  year: number,
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): { startDate: string; endDate: string } {
  // 開始年の場合は指定月から
  const sMonth = year === startYear ? startMonth : 1;
  const startDate = `${year}-${String(sMonth).padStart(2, "0")}-01`;

  // 終了年の場合は指定月まで
  let eMonth: number;
  let eDay: number;
  if (year === endYear) {
    eMonth = endMonth;
    eDay = new Date(year, eMonth, 0).getDate(); // 月末日
  } else {
    eMonth = 12;
    eDay = 31;
  }
  const endDate = `${year}-${String(eMonth).padStart(2, "0")}-${String(eDay).padStart(2, "0")}`;

  return { startDate, endDate };
}

/**
 * 年リストを生成
 */
function generateYearList(startYear: number, endYear: number): number[] {
  const years: number[] = [];
  for (let y = startYear; y <= endYear; y++) {
    years.push(y);
  }
  return years;
}

// =============================================================================
// Sync Function
// =============================================================================

/**
 * Zaim データを全件同期（年単位チャンク）
 */
export async function syncAllZaimData(options: {
  startDate: Date;
  endDate: Date;
  resumeFromYear?: number;
}): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const startYear = options.resumeFromYear ?? options.startDate.getFullYear();
  const startMonth = options.resumeFromYear ? 1 : options.startDate.getMonth() + 1;
  const endYear = options.endDate.getFullYear();
  const endMonth = options.endDate.getMonth() + 1;

  const years = generateYearList(startYear, endYear);

  log.syncStart("Zaim (Full)", 0);
  console.log(`   期間: ${startYear}年${startMonth}月 〜 ${endYear}年${endMonth}月`);
  console.log(`   チャンク: ${years.length}年分\n`);

  const zaim = createZaimDbClient();
  let totalTransactions = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let zaimUserId: number | null = null;
  let mastersSynced = false;
  let masterStats = { categories: 0, genres: 0, accounts: 0 };

  try {
    for (let i = 0; i < years.length; i++) {
      const year = years[i];
      log.section(`Chunk ${i + 1}/${years.length}: ${year}年`);

      const { startDate, endDate } = getYearDateRange(
        year,
        startYear,
        startMonth,
        endYear,
        endMonth
      );
      log.info(`Period: ${startDate} 〜 ${endDate}`);

      // データ取得
      const data = await fetchZaimData({ startDate, endDate });
      zaimUserId = data.zaimUserId;
      log.success(`Fetched ${data.transactions.length} transactions`);

      // 最初の年でマスタデータを同期
      if (!mastersSynced) {
        log.info("Syncing master data...");
        const masterResult = await syncMasters(
          zaim,
          zaimUserId,
          data.categories,
          data.genres,
          data.accounts
        );
        log.success(
          `Masters: categories=${masterResult.categories}, genres=${masterResult.genres}, accounts=${masterResult.accounts}`
        );
        masterStats = {
          categories: masterResult.categories,
          genres: masterResult.genres,
          accounts: masterResult.accounts,
        };
        mastersSynced = true;
      }

      // 既存トランザクション確認
      const existingIds = await getExistingTransactionIds(
        zaim,
        zaimUserId,
        startDate,
        endDate
      );

      // トランザクション同期
      const txResult = await syncTransactions(
        zaim,
        zaimUserId,
        data.transactions,
        existingIds
      );

      totalTransactions += txResult.fetched;
      totalInserted += txResult.inserted;
      totalUpdated += txResult.updated;
      totalSkipped += txResult.skipped;

      log.success(
        `Transactions: inserted=${txResult.inserted}, updated=${txResult.updated}, skipped=${txResult.skipped}`
      );

      // 次年への待機（最後のチャンク以外）
      if (i < years.length - 1) {
        await delay(DELAY_BETWEEN_YEARS);
      }
    }

    const elapsedSeconds = (Date.now() - startTime) / 1000;

    const stats: SyncStats = {
      categories: masterStats.categories,
      genres: masterStats.genres,
      accounts: masterStats.accounts,
      transactions: {
        fetched: totalTransactions,
        inserted: totalInserted,
        updated: totalUpdated,
        skipped: totalSkipped,
      },
    };

    const result: SyncResult = {
      success: true,
      timestamp: new Date().toISOString(),
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
    log.info(`Transactions: ${stats.transactions.fetched}`);
    log.info(`  Inserted: ${stats.transactions.inserted}`);
    log.info(`  Updated: ${stats.transactions.updated}`);
    log.info(`  Skipped: ${stats.transactions.skipped}`);
    console.log("=".repeat(60));

    return result;

  } catch (err) {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    log.error(message);
    log.warn(`再開する場合: --resume=${years[Math.max(0, years.indexOf(startYear))]}`);

    log.syncEnd(false, elapsedSeconds);

    return {
      success: false,
      timestamp: new Date().toISOString(),
      stats: {
        categories: masterStats.categories,
        genres: masterStats.genres,
        accounts: masterStats.accounts,
        transactions: {
          fetched: totalTransactions,
          inserted: totalInserted,
          updated: totalUpdated,
          skipped: totalSkipped,
        },
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
    string: ["start", "end", "resume"],
    boolean: ["help"],
    alias: { h: "help", s: "start", e: "end", r: "resume" },
  });

  if (args.help) {
    console.log(`
Zaim 全件同期（初回移行・リカバリ用）

年単位でチャンク分割してデータを取得します。

使用法:
  deno run --allow-env --allow-net --allow-read sync_all.ts [オプション]

オプション:
  --help, -h      このヘルプを表示
  --start, -s     開始日（YYYY-MM-DD）デフォルト: 環境変数 ZAIM_SYNC_START_DATE
  --end, -e       終了日（YYYY-MM-DD）デフォルト: 今日
  --resume, -r    指定した年から再開（YYYY）

例:
  # デフォルト（ZAIM_SYNC_START_DATEから今日まで）
  deno run --allow-env --allow-net --allow-read sync_all.ts

  # 特定期間
  deno run --allow-env --allow-net --allow-read sync_all.ts --start=2020-01-01 --end=2024-12-31

  # 2023年から再開
  deno run --allow-env --allow-net --allow-read sync_all.ts --resume=2023

環境変数:
  SUPABASE_URL              Supabase URL
  SUPABASE_SERVICE_ROLE_KEY Supabase Service Role Key
  ZAIM_CONSUMER_KEY         Zaim Consumer Key
  ZAIM_CONSUMER_SECRET      Zaim Consumer Secret
  ZAIM_ACCESS_TOKEN         Zaim Access Token
  ZAIM_ACCESS_TOKEN_SECRET  Zaim Access Token Secret
  ZAIM_SYNC_START_DATE      デフォルト開始日（必須、--start未指定時）

注意:
  - 年単位でチャンク分割して取得します
  - エラー時は --resume オプションで中断した年から再開できます
`);
    Deno.exit(0);
  }

  const startDate = args.start
    ? new Date(args.start)
    : new Date(getDefaultStartDate());
  const endDate = args.end ? new Date(args.end) : new Date();
  const resumeFromYear = args.resume ? parseInt(args.resume, 10) : undefined;

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
  if (resumeFromYear !== undefined && isNaN(resumeFromYear)) {
    console.error("❌ 無効な再開年です");
    Deno.exit(1);
  }

  try {
    const result = await syncAllZaimData({
      startDate,
      endDate,
      resumeFromYear,
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
