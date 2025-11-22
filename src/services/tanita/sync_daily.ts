// sync_daily.ts
// Tanita日次同期（直近N日間）
//
// 使用例:
//   deno run --allow-env --allow-net --allow-read sync_daily.ts
//   TANITA_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts

import "jsr:@std/dotenv/load";
import { ensureValidToken } from "./auth.ts";
import { fetchTanitaData } from "./fetch_data.ts";
import {
  createTanitaDbClient,
  saveBloodPressure,
  saveBodyComposition,
  saveSteps,
} from "./write_db.ts";
import type { SyncResult } from "./types.ts";

// ========== 定数 ==========

const DEFAULT_SYNC_DAYS = 3;

// ========== メイン関数 ==========

export async function syncTanitaByDays(syncDays?: number): Promise<SyncResult> {
  const startTime = Date.now();
  const days = syncDays ??
    parseInt(Deno.env.get("TANITA_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS));
  const errors: string[] = [];

  console.log("🔄 Tanita Health Planet 日次同期開始");
  console.log(`   同期日数: ${days}日間\n`);

  // 1. トークン確認（必要ならリフレッシュ）
  let accessToken: string;
  try {
    accessToken = await ensureValidToken();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ 認証エラー: ${message}`);
    return {
      success: false,
      timestamp: new Date().toISOString(),
      stats: { bodyComposition: 0, bloodPressure: 0, steps: 0 },
      errors: [message],
      elapsedSeconds: (Date.now() - startTime) / 1000,
    };
  }

  // 2. データ取得
  // 日付範囲: days日前から今日までを取得
  // endDate = 明日（APIは排他的終点のため、今日を含めるには明日を指定）
  // startDate = endDate - (days + 1)
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 1);

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days - 1);

  console.log("");
  const data = await fetchTanitaData(accessToken, { startDate, endDate });

  // 3. DB保存
  console.log("");
  const supabase = createTanitaDbClient();

  const bodyResult = await saveBodyComposition(supabase, data.bodyComposition);
  const bpResult = await saveBloodPressure(supabase, data.bloodPressure);
  const stepsResult = await saveSteps(supabase, data.steps);

  // 4. 結果集計
  const elapsedSeconds = (Date.now() - startTime) / 1000;

  if (bodyResult.failed > 0) errors.push(`体組成: ${bodyResult.failed}件失敗`);
  if (bpResult.failed > 0) errors.push(`血圧: ${bpResult.failed}件失敗`);
  if (stepsResult.failed > 0) errors.push(`歩数: ${stepsResult.failed}件失敗`);

  const result: SyncResult = {
    success: errors.length === 0,
    timestamp: new Date().toISOString(),
    stats: {
      bodyComposition: bodyResult.success,
      bloodPressure: bpResult.success,
      steps: stepsResult.success,
    },
    errors,
    elapsedSeconds,
  };

  // 5. サマリー表示
  console.log("\n" + "=".repeat(60));
  console.log(result.success ? "✅ 同期完了" : "⚠️  同期完了（エラーあり）");
  console.log(`   体組成: ${result.stats.bodyComposition}件`);
  console.log(`   血圧: ${result.stats.bloodPressure}件`);
  console.log(`   歩数: ${result.stats.steps}件`);
  console.log(`   処理時間: ${result.elapsedSeconds.toFixed(1)}秒`);
  if (errors.length > 0) {
    console.log(`   エラー: ${errors.join(", ")}`);
  }
  console.log("=".repeat(60));

  return result;
}

// ========== CLI実行 ==========

if (import.meta.main) {
  const result = await syncTanitaByDays();
  Deno.exit(result.success ? 0 : 1);
}
