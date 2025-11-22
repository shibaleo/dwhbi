// sync_daily.ts
// Fitbit日次同期（直近N日間）
//
// 使用例:
//   deno run --allow-env --allow-net --allow-read sync_daily.ts
//   FITBIT_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts

import "jsr:@std/dotenv/load";
import { ensureValidToken } from "./auth.ts";
import { fetchFitbitData } from "./fetch_data.ts";
import { createFitbitDbClient, saveAllFitbitData } from "./write_db.ts";
import type { SyncResult } from "./types.ts";

// ========== 定数 ==========

const DEFAULT_SYNC_DAYS = 3;

// ========== メイン関数 ==========

export async function syncFitbitByDays(syncDays?: number): Promise<SyncResult> {
  const startTime = Date.now();
  const days = syncDays ??
    parseInt(Deno.env.get("FITBIT_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS));
  const errors: string[] = [];

  console.log("🔄 Fitbit 日次同期開始");
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
  const data = await fetchFitbitData(accessToken, { startDate, endDate });

  // 3. DB保存
  console.log("");
  const supabase = createFitbitDbClient();
  const results = await saveAllFitbitData(supabase, data);

  // 4. 結果集計
  const elapsedSeconds = (Date.now() - startTime) / 1000;

  if (results.sleep.failed > 0) errors.push(`睡眠: ${results.sleep.failed}件失敗`);
  if (results.activity.failed > 0) errors.push(`活動: ${results.activity.failed}件失敗`);
  if (results.heartRate.failed > 0) errors.push(`心拍: ${results.heartRate.failed}件失敗`);
  if (results.hrv.failed > 0) errors.push(`HRV: ${results.hrv.failed}件失敗`);
  if (results.spo2.failed > 0) errors.push(`SpO2: ${results.spo2.failed}件失敗`);
  if (results.breathingRate.failed > 0) errors.push(`呼吸数: ${results.breathingRate.failed}件失敗`);
  if (results.cardioScore.failed > 0) errors.push(`VO2Max: ${results.cardioScore.failed}件失敗`);
  if (results.temperatureSkin.failed > 0) errors.push(`皮膚温度: ${results.temperatureSkin.failed}件失敗`);

  const result: SyncResult = {
    success: errors.length === 0,
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
    errors,
    elapsedSeconds,
  };

  // 5. サマリー表示
  console.log("\n" + "=".repeat(60));
  console.log(result.success ? "✅ 同期完了" : "⚠️  同期完了（エラーあり）");
  console.log(`   睡眠: ${result.stats.sleep}件`);
  console.log(`   活動: ${result.stats.activity}件`);
  console.log(`   心拍: ${result.stats.heartRate}件`);
  console.log(`   HRV: ${result.stats.hrv}件`);
  console.log(`   SpO2: ${result.stats.spo2}件`);
  console.log(`   呼吸数: ${result.stats.breathingRate}件`);
  console.log(`   VO2 Max: ${result.stats.cardioScore}件`);
  console.log(`   皮膚温度: ${result.stats.temperatureSkin}件`);
  console.log(`   処理時間: ${result.elapsedSeconds.toFixed(1)}秒`);
  if (errors.length > 0) {
    console.log(`   エラー: ${errors.join(", ")}`);
  }
  console.log("=".repeat(60));

  return result;
}

// ========== CLI実行 ==========

if (import.meta.main) {
  const result = await syncFitbitByDays();
  Deno.exit(result.success ? 0 : 1);
}
