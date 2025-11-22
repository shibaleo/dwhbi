/**
 * Google Calendar 全件同期（初回移行・リカバリ用）
 * 
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_all.ts
 *   deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31
 */

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { parse as parseArgs } from "https://deno.land/std@0.203.0/flags/mod.ts";
import { fetchAllEvents } from "./fetch_events.ts";
import { createGCalClient, upsertEvents } from "./write_db.ts";
import { SyncStats } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

/** デフォルト開始日（Togglデータと合わせる） */
const DEFAULT_START_DATE = "2019-01-01";

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
// Sync Function
// =============================================================================

/**
 * 指定期間のGoogle Calendarイベントを全件同期
 */
export async function syncAllGCalEvents(
  startDate: string,
  endDate: string,
): Promise<{ success: boolean; stats: SyncStats; elapsedSeconds: number }> {
  const startTime = Date.now();

  console.log("🚀 Google Calendar 全件同期開始");
  console.log(`   期間: ${startDate} 〜 ${endDate}\n`);

  try {
    // Step 1: データ取得
    log("INFO", "Step 1: Fetching events from Google Calendar...");
    const { events } = await fetchAllEvents({
      timeMin: `${startDate}T00:00:00+09:00`,
      timeMax: `${endDate}T23:59:59+09:00`,
    });
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

    // サマリー
    console.log("\n" + "=".repeat(60));
    console.log("✅ 全件同期完了");
    console.log(`   取得: ${stats.fetched} 件`);
    console.log(`   upsert: ${stats.upserted} 件`);
    console.log(`   処理時間: ${elapsedSeconds.toFixed(1)}秒`);
    console.log("=".repeat(60));

    return { success: true, stats, elapsedSeconds };

  } catch (error) {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log("ERROR", `Sync failed: ${errorMessage}`);

    return {
      success: false,
      stats: { fetched: 0, upserted: 0, skipped: 0 },
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
    boolean: ["help"],
    alias: { h: "help", s: "start", e: "end" },
  });

  if (args.help) {
    console.log(`
Google Calendar 全件同期（初回移行・リカバリ用）

使用法:
  deno run --allow-env --allow-net --allow-read sync_all.ts [オプション]

オプション:
  --help, -h        このヘルプを表示
  --start, -s       開始日（YYYY-MM-DD）デフォルト: 2019-01-01
  --end, -e         終了日（YYYY-MM-DD）デフォルト: 今日

例:
  # デフォルト（2019-01-01から今日まで）
  deno run --allow-env --allow-net --allow-read sync_all.ts

  # 特定期間
  deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31

  # 今年分のみ
  deno run --allow-env --allow-net --allow-read sync_all.ts --start=2025-01-01

環境変数:
  SUPABASE_URL                  Supabase URL
  SUPABASE_SERVICE_ROLE_KEY     Supabase Service Role Key
  GOOGLE_CALENDAR_ID            Google Calendar ID
  GOOGLE_SERVICE_ACCOUNT_JSON   サービスアカウントJSON
`);
    Deno.exit(0);
  }

  const startDate = args.start || DEFAULT_START_DATE;
  const endDate = args.end || new Date().toISOString().split("T")[0];

  // 日付フォーマットの簡易チェック
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(startDate)) {
    console.error("❌ 無効な開始日です（YYYY-MM-DD形式で指定してください）");
    Deno.exit(1);
  }
  if (!datePattern.test(endDate)) {
    console.error("❌ 無効な終了日です（YYYY-MM-DD形式で指定してください）");
    Deno.exit(1);
  }
  if (startDate > endDate) {
    console.error("❌ 開始日は終了日より前である必要があります");
    Deno.exit(1);
  }

  const result = await syncAllGCalEvents(startDate, endDate);
  Deno.exit(result.success ? 0 : 1);
}

if (import.meta.main) {
  main();
}
