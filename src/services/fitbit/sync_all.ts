/**
 * Fitbit → Supabase 全件同期（初回移行・リカバリ用）
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_all.ts
 *   deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31
 *   deno run --allow-env --allow-net --allow-read sync_all.ts --intraday
 */

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import * as log from "../../utils/log.ts";
import { ensureValidToken } from "./auth.ts";
import { fetchFitbitData } from "./fetch_data.ts";
import { createFitbitDbClient, saveAllFitbitData } from "./write_db.ts";
import type { SyncResult } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

/** デフォルト開始日（環境変数 FITBIT_SYNC_START_DATE から取得、必須） */
function getDefaultStartDate(): string {
  const startDate = Deno.env.get("FITBIT_SYNC_START_DATE");
  if (!startDate) {
    throw new Error("FITBIT_SYNC_START_DATE is not set");
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
 * Fitbit データを全件同期
 */
export async function syncAllFitbitData(options: {
  startDate: Date;
  endDate: Date;
  includeIntraday?: boolean;
}): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const startStr = formatDate(options.startDate);
  const endStr = formatDate(options.endDate);

  log.syncStart("Fitbit (Full)", 0);
  console.log(`   期間: ${startStr} 〜 ${endStr}`);
  console.log(`   Intraday: ${options.includeIntraday ? "あり" : "なし"}\n`);

  try {
    // Step 1: トークン確認
    log.section("Step 1: Checking token");
    const accessToken = await ensureValidToken();
    log.success("Token valid");

    // Step 2: データ取得
    log.section("Step 2: Fetching data from Fitbit API");
    const data = await fetchFitbitData(accessToken, {
      startDate: options.startDate,
      endDate: options.endDate,
      includeIntraday: options.includeIntraday,
    });

    // Step 3: DB保存
    log.section("Step 3: Saving data to DB");
    const supabase = createFitbitDbClient();
    const results = await saveAllFitbitData(supabase, data);

    const elapsedSeconds = (Date.now() - startTime) / 1000;

    const result: SyncResult = {
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        sleep: results.sleep.success,
        activity: results.activity.success,
        heartRate: results.heartRate.success,
        hrv: results.hrv.success,
        spo2: results.spo2.success,
        breathingRate: results.breathingRate.success,
        cardioScore: results.cardioScore.success,
        temperatureSkin: results.temperatureSkin.success,
      },
      errors: [],
      elapsedSeconds,
    };

    // サマリー表示
    console.log("\n" + "=".repeat(60));
    log.syncEnd(true, elapsedSeconds);
    log.info(`Sleep: ${result.stats.sleep}`);
    log.info(`Activity: ${result.stats.activity}`);
    log.info(`Heart Rate: ${result.stats.heartRate}`);
    log.info(`HRV: ${result.stats.hrv}`);
    log.info(`SpO2: ${result.stats.spo2}`);
    log.info(`Breathing Rate: ${result.stats.breathingRate}`);
    log.info(`Cardio Score: ${result.stats.cardioScore}`);
    log.info(`Temperature Skin: ${result.stats.temperatureSkin}`);
    console.log("=".repeat(60));

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
        sleep: 0,
        activity: 0,
        heartRate: 0,
        hrv: 0,
        spo2: 0,
        breathingRate: 0,
        cardioScore: 0,
        temperatureSkin: 0,
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
    boolean: ["help", "intraday"],
    alias: { h: "help", s: "start", e: "end", i: "intraday" },
  });

  if (args.help) {
    console.log(`
Fitbit 全件同期（初回移行・リカバリ用）

使用法:
  deno run --allow-env --allow-net --allow-read sync_all.ts [オプション]

オプション:
  --help, -h        このヘルプを表示
  --start, -s       開始日（YYYY-MM-DD）デフォルト: 環境変数 FITBIT_SYNC_START_DATE
  --end, -e         終了日（YYYY-MM-DD）デフォルト: 今日
  --intraday, -i    Intradayデータも取得（レート制限に注意）

例:
  # デフォルト（FITBIT_SYNC_START_DATEから今日まで）
  deno run --allow-env --allow-net --allow-read sync_all.ts

  # 特定期間
  deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31

  # Intradayデータ込み
  deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-11-01 --end=2024-11-30 --intraday

環境変数:
  SUPABASE_URL              Supabase URL
  SUPABASE_SERVICE_ROLE_KEY Supabase Service Role Key
  FITBIT_CLIENT_ID          Fitbit Client ID
  FITBIT_CLIENT_SECRET      Fitbit Client Secret
  FITBIT_SYNC_START_DATE    デフォルト開始日（必須、--start未指定時）

注意:
  - Fitbit APIのレート制限は150リクエスト/時間です
  - レート制限エラー時は自動でリセットまで待機します
  - 長期間の同期は時間がかかります（1日あたり約10リクエスト）
  - Intradayデータは1日ずつ取得するため、さらに時間がかかります
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
    const result = await syncAllFitbitData({
      startDate,
      endDate,
      includeIntraday: args.intraday,
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
