// sync_all.ts
// Fitbit全件同期（初回移行・リカバリ用）
//
// 使用例:
//   deno run --allow-env --allow-net --allow-read sync_all.ts
//   deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31
//   deno run --allow-env --allow-net --allow-read sync_all.ts --intraday

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import { ensureValidToken } from "./auth.ts";
import { fetchFitbitData } from "./fetch_data.ts";
import { createFitbitDbClient, saveAllFitbitData } from "./write_db.ts";

// ========== デフォルト設定 ==========

// デフォルト開始日（Fitbitデータの起点）
const DEFAULT_START_DATE = new Date("2019-01-01");

// ========== メイン関数 ==========

export async function syncAllFitbitData(
  startDate: Date,
  endDate: Date,
  includeIntraday: boolean = false,
): Promise<void> {
  const startTime = Date.now();

  console.log("🚀 Fitbit 全件同期開始");
  console.log(`   期間: ${startDate.toISOString().split("T")[0]} 〜 ${endDate.toISOString().split("T")[0]}`);
  console.log(`   Intraday: ${includeIntraday ? "あり" : "なし"}\n`);

  // 1. トークン確認
  console.log("🔑 トークン確認中...");
  const accessToken = await ensureValidToken();

  // 2. データ取得
  console.log("");
  const data = await fetchFitbitData(accessToken, {
    startDate,
    endDate,
    includeIntraday,
  });

  // 3. DB保存
  console.log("");
  const supabase = createFitbitDbClient();
  const results = await saveAllFitbitData(supabase, data);

  // 4. サマリー
  const elapsedSeconds = (Date.now() - startTime) / 1000;

  console.log("\n" + "=".repeat(60));
  console.log("✅ 全件同期完了");
  console.log(`   睡眠: ${results.sleep.success}件`);
  console.log(`   活動: ${results.activity.success}件`);
  console.log(`   心拍: ${results.heartRate.success}件`);
  console.log(`   HRV: ${results.hrv.success}件`);
  console.log(`   SpO2: ${results.spo2.success}件`);
  console.log(`   呼吸数: ${results.breathingRate.success}件`);
  console.log(`   VO2 Max: ${results.cardioScore.success}件`);
  console.log(`   皮膚温度: ${results.temperatureSkin.success}件`);
  console.log(`   処理時間: ${elapsedSeconds.toFixed(1)}秒`);
  console.log("=".repeat(60));
}

// ========== CLI実行 ==========

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
  --start, -s       開始日（YYYY-MM-DD）デフォルト: 1年前
  --end, -e         終了日（YYYY-MM-DD）デフォルト: 今日
  --intraday, -i    Intradayデータも取得（レート制限に注意）

例:
  # デフォルト（過去1年分）
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

注意:
  - Fitbit APIのレート制限は150リクエスト/時間です
  - 長期間の同期は時間がかかります（1日あたり約10リクエスト）
  - Intradayデータは1日ずつ取得するため、さらに時間がかかります
`);
    Deno.exit(0);
  }

  const startDate = args.start
    ? new Date(args.start)
    : DEFAULT_START_DATE;
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
    await syncAllFitbitData(startDate, endDate, args.intraday);
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
