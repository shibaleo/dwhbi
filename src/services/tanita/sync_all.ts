/**
 * Tanita Health Planet → Supabase 全件同期（初回移行・リカバリ用）
 *
 * Tanita APIは最大3ヶ月分のデータしか取得できないため、
 * 長期間の場合は自動的にチャンク分割されます。
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_all.ts
 *   deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31
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

// =============================================================================
// Constants
// =============================================================================

/** デフォルト開始日（環境変数 TANITA_SYNC_START_DATE から取得、必須） */
function getDefaultStartDate(): string {
  const startDate = Deno.env.get("TANITA_SYNC_START_DATE");
  if (!startDate) {
    throw new Error("TANITA_SYNC_START_DATE is not set");
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
 * Tanita データを全件同期
 */
export async function syncAllTanitaData(options: {
  startDate: Date;
  endDate: Date;
}): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const startStr = formatDate(options.startDate);
  const endStr = formatDate(options.endDate);

  log.syncStart("Tanita Health Planet (Full)", 0);
  console.log(`   期間: ${startStr} 〜 ${endStr}\n`);

  try {
    // Step 1: トークン確認
    log.section("Step 1: Checking token");
    const accessToken = await ensureValidToken();
    log.success("Token valid");

    // Step 2: データ取得（3ヶ月チャンクは fetch_data.ts が自動処理）
    log.section("Step 2: Fetching data from Tanita API");
    const data = await fetchTanitaData(accessToken, {
      startDate: options.startDate,
      endDate: options.endDate,
    });
    log.success(`Body composition: ${data.bodyComposition.length} records`);
    log.success(`Blood pressure: ${data.bloodPressure.length} records`);
    log.success(`Steps: ${data.steps.length} records`);

    // Step 3: DB保存
    log.section("Step 3: Saving data to DB");
    const supabase = createTanitaDbClient();

    const bodyResult = await saveBodyComposition(supabase, data.bodyComposition);
    const bpResult = await saveBloodPressure(supabase, data.bloodPressure);
    const stepsResult = await saveSteps(supabase, data.steps);

    const elapsedSeconds = (Date.now() - startTime) / 1000;

    const result: SyncResult = {
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        bodyComposition: bodyResult.success,
        bloodPressure: bpResult.success,
        steps: stepsResult.success,
      },
      errors: [],
      elapsedSeconds,
    };

    // サマリー表示
    console.log("\n" + "=".repeat(60));
    log.syncEnd(true, elapsedSeconds);
    log.info(`Body Composition: ${result.stats.bodyComposition}`);
    log.info(`Blood Pressure: ${result.stats.bloodPressure}`);
    log.info(`Steps: ${result.stats.steps}`);
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
        bodyComposition: 0,
        bloodPressure: 0,
        steps: 0,
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
    boolean: ["help"],
    alias: { h: "help", s: "start", e: "end" },
  });

  if (args.help) {
    console.log(`
Tanita Health Planet 全件同期（初回移行・リカバリ用）

使用法:
  deno run --allow-env --allow-net --allow-read sync_all.ts [オプション]

オプション:
  --help, -h     このヘルプを表示
  --start, -s    開始日（YYYY-MM-DD）デフォルト: 環境変数 TANITA_SYNC_START_DATE
  --end, -e      終了日（YYYY-MM-DD）デフォルト: 今日

例:
  # デフォルト（TANITA_SYNC_START_DATEから今日まで）
  deno run --allow-env --allow-net --allow-read sync_all.ts

  # 特定期間
  deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31

  # 開始日のみ指定（終了は今日まで）
  deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-06-01

環境変数:
  SUPABASE_URL              Supabase URL
  SUPABASE_SERVICE_ROLE_KEY Supabase Service Role Key
  TANITA_CLIENT_ID          Tanita Client ID
  TANITA_CLIENT_SECRET      Tanita Client Secret
  TANITA_SYNC_START_DATE    デフォルト開始日（必須、--start未指定時）

注意:
  - Tanita APIは最大3ヶ月分のデータしか取得できないため、
    長期間の場合は自動的にチャンク分割されます
  - APIレート制限: 60回/時間
  - レート制限エラー時は自動でリセットまで待機します
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
    const result = await syncAllTanitaData({
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
