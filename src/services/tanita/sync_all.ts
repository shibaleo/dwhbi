// sync_all.ts
// Tanita全件同期（初回移行・リカバリ用）
//
// 使用例:
//   deno run --allow-env --allow-net --allow-read sync_all.ts
//   deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01
//   deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import { ensureValidToken } from "./auth.ts";
import { fetchTanitaData } from "./fetch_data.ts";
import {
  createTanitaDbClient,
  saveBloodPressure,
  saveBodyComposition,
  saveSteps,
} from "./write_db.ts";

// ========== 定数 ==========

const DEFAULT_START_DATE = "2025-03-01"; // Tanita使用開始日

// ========== メイン関数 ==========

export async function syncAllTanitaData(
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const startTime = Date.now();

  console.log("🔄 Tanita Health Planet 全件同期開始");
  console.log(
    `   期間: ${startDate.toISOString().split("T")[0]} 〜 ${
      endDate.toISOString().split("T")[0]
    }\n`,
  );

  // 1. トークン確認
  let accessToken: string;
  try {
    accessToken = await ensureValidToken();
  } catch (error) {
    console.error(
      `❌ 認証エラー: ${error instanceof Error ? error.message : error}`,
    );
    Deno.exit(1);
  }

  // 2. データ取得（3ヶ月チャンクは fetch_data.ts が自動処理）
  console.log("");
  const data = await fetchTanitaData(accessToken, { startDate, endDate });

  // 3. DB保存
  console.log("");
  const supabase = createTanitaDbClient();

  const bodyResult = await saveBodyComposition(supabase, data.bodyComposition);
  const bpResult = await saveBloodPressure(supabase, data.bloodPressure);
  const stepsResult = await saveSteps(supabase, data.steps);

  // 4. サマリー
  const elapsedSeconds = (Date.now() - startTime) / 1000;
  const totalSaved = bodyResult.success + bpResult.success +
    stepsResult.success;
  const totalFailed = bodyResult.failed + bpResult.failed + stepsResult.failed;

  console.log("\n" + "=".repeat(60));
  console.log("✅ 全件同期完了");
  console.log(`   体組成: ${bodyResult.success}件`);
  console.log(`   血圧: ${bpResult.success}件`);
  console.log(`   歩数: ${stepsResult.success}件`);
  console.log(`   合計: ${totalSaved}件保存, ${totalFailed}件失敗`);
  console.log(`   処理時間: ${elapsedSeconds.toFixed(1)}秒`);
  console.log("=".repeat(60));
}

// ========== CLI実行 ==========

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["start", "end"],
    boolean: ["help"],
    alias: { h: "help", s: "start", e: "end" },
  });

  if (args.help) {
    console.log(`
Tanita Health Planet 全件同期

使用法:
  deno run --allow-env --allow-net --allow-read sync_all.ts [オプション]

オプション:
  --help, -h     このヘルプを表示
  --start, -s    開始日（YYYY-MM-DD形式、デフォルト: ${DEFAULT_START_DATE}）
  --end, -e      終了日（YYYY-MM-DD形式、デフォルト: 今日）

例:
  # デフォルト期間で同期
  deno run --allow-env --allow-net --allow-read sync_all.ts

  # 特定期間で同期
  deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31

  # 開始日のみ指定（終了は今日まで）
  deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-06-01

注意:
  - Tanita APIは最大3ヶ月分のデータしか取得できないため、
    長期間の場合は自動的にチャンク分割されます
  - APIレート制限: 60回/時間
`);
    Deno.exit(0);
  }

  const startDate = args.start
    ? new Date(args.start)
    : new Date(DEFAULT_START_DATE);
  const endDate = args.end ? new Date(args.end) : new Date();

  // 日付バリデーション
  if (isNaN(startDate.getTime())) {
    console.error(`❌ 無効な開始日: ${args.start}`);
    Deno.exit(1);
  }
  if (isNaN(endDate.getTime())) {
    console.error(`❌ 無効な終了日: ${args.end}`);
    Deno.exit(1);
  }
  if (startDate >= endDate) {
    console.error("❌ 開始日は終了日より前である必要があります");
    Deno.exit(1);
  }

  await syncAllTanitaData(startDate, endDate);
}

if (import.meta.main) {
  main();
}
