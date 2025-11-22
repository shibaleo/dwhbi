/**
 * Google Calendar → Supabase 全件同期（初回移行・リカバリ用）
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_all.ts
 *   deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31
 */

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import * as log from "../../utils/log.ts";
import { fetchAllEvents } from "./fetch_data.ts";
import { createGCalendarDbClient, upsertEvents } from "./write_db.ts";
import type { SyncResult, SyncStats } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

/** デフォルト開始日（環境変数 GCALENDAR_SYNC_START_DATE から取得、必須） */
function getDefaultStartDate(): string {
  const startDate = Deno.env.get("GCALENDAR_SYNC_START_DATE");
  if (!startDate) {
    throw new Error("GCALENDAR_SYNC_START_DATE is not set");
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
// Sync Function
// =============================================================================

/**
 * Google Calendar イベントを全件同期
 */
export async function syncAllGCalEvents(options: {
  startDate: Date;
  endDate: Date;
}): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const startStr = formatDate(options.startDate);
  const endStr = formatDate(options.endDate);

  log.syncStart("Google Calendar (Full)", 0);
  console.log(`   期間: ${startStr} 〜 ${endStr}\n`);

  try {
    // Step 1: データ取得
    log.section("Step 1: Fetching events from Google Calendar API");
    const { events } = await fetchAllEvents({
      timeMin: `${startStr}T00:00:00+09:00`,
      timeMax: `${endStr}T23:59:59+09:00`,
    });
    log.success(`Fetched ${events.length} events`);

    // Step 2: DB書き込み
    log.section("Step 2: Upserting events to Supabase");
    const client = createGCalendarDbClient();
    const result = await upsertEvents(client, events);
    log.success(`Upserted ${result.success} events`);

    const elapsedSeconds = (Date.now() - startTime) / 1000;

    const stats: SyncStats = {
      fetched: events.length,
      upserted: result.success,
      skipped: events.length - result.success,
    };

    const syncResult: SyncResult = {
      success: true,
      timestamp: new Date().toISOString(),
      stats,
      errors: [],
      elapsedSeconds,
    };

    // サマリー表示
    console.log("\n" + "=".repeat(60));
    log.syncEnd(true, elapsedSeconds);
    log.info(`Fetched: ${stats.fetched}`);
    log.info(`Upserted: ${stats.upserted}`);
    log.info(`Skipped: ${stats.skipped}`);
    console.log("=".repeat(60));

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
  --start, -s       開始日（YYYY-MM-DD）デフォルト: 環境変数 GCALENDAR_SYNC_START_DATE
  --end, -e         終了日（YYYY-MM-DD）デフォルト: 今日

例:
  # デフォルト（GCALENDAR_SYNC_START_DATEから今日まで）
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
  GCALENDAR_SYNC_START_DATE     デフォルト開始日（必須、--start未指定時）
`);
    Deno.exit(0);
  }

  const startDate = args.start
    ? new Date(args.start)
    : new Date(getDefaultStartDate());
  const endDate = args.end
    ? new Date(args.end)
    : new Date();

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
    const result = await syncAllGCalEvents({
      startDate,
      endDate,
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
