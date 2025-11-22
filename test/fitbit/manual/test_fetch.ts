// test/fitbit/manual/test_fetch.ts
// Fitbit API データ取得の手動テスト
//
// 実行:
//   deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_fetch.ts
//   FITBIT_TEST_DAYS=7 deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_fetch.ts
//
// 必要な環境変数:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET

import "jsr:@std/dotenv/load";
import { ensureValidToken } from "../../../src/services/fitbit/auth.ts";
import { fetchFitbitData } from "../../../src/services/fitbit/fetch_data.ts";
import { formatFitbitDate } from "../../../src/services/fitbit/api.ts";

const DEFAULT_DAYS = 3;

console.log("=".repeat(60));
console.log("Fitbit API データ取得テスト");
console.log("=".repeat(60));
console.log("");

try {
  // トークン取得
  console.log("🔑 トークン取得中...");
  const token = await ensureValidToken();
  console.log("");

  // データ取得
  const days = parseInt(Deno.env.get("FITBIT_TEST_DAYS") || String(DEFAULT_DAYS));
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

  console.log(`📥 データ取得中（${days}日間）...`);
  console.log(`   期間: ${formatFitbitDate(startDate)} 〜 ${formatFitbitDate(endDate)}`);
  console.log("");

  const data = await fetchFitbitData(token, { startDate, endDate });

  // 結果表示
  console.log("");
  console.log("=".repeat(60));
  console.log("📊 取得結果サマリー");
  console.log("=".repeat(60));
  console.log(`   睡眠データ:     ${data.sleep.length}件`);
  console.log(`   活動データ:     ${data.activity.size}日分`);
  console.log(`   心拍データ:     ${data.heartRate.length}日分`);
  console.log(`   HRVデータ:      ${data.hrv.length}日分`);
  console.log(`   SpO2データ:     ${data.spo2.size}日分`);
  console.log(`   呼吸数データ:   ${data.breathingRate.length}日分`);
  console.log(`   VO2 Maxデータ:  ${data.cardioScore.length}日分`);
  console.log(`   皮膚温度データ: ${data.temperatureSkin.length}日分`);
  console.log(`   AZMデータ:      ${data.azm.length}日分`);
  console.log("");

  // サンプルデータ表示
  if (data.sleep.length > 0) {
    console.log("📋 睡眠サンプル（最新1件）:");
    const sample = data.sleep[data.sleep.length - 1];
    console.log(`   日付: ${sample.dateOfSleep}`);
    console.log(`   開始: ${sample.startTime}`);
    console.log(`   終了: ${sample.endTime}`);
    console.log(`   睡眠時間: ${sample.minutesAsleep}分`);
    console.log(`   効率: ${sample.efficiency}%`);
    console.log("");
  }

  if (data.heartRate.length > 0) {
    console.log("📋 心拍サンプル（最新1件）:");
    const sample = data.heartRate[data.heartRate.length - 1];
    console.log(`   日付: ${sample.dateTime}`);
    console.log(`   安静時心拍: ${sample.value.restingHeartRate ?? "N/A"}bpm`);
    console.log("");
  }

  if (data.hrv.length > 0) {
    console.log("📋 HRVサンプル（最新1件）:");
    const sample = data.hrv[data.hrv.length - 1];
    console.log(`   日付: ${sample.dateTime}`);
    console.log(`   Daily RMSSD: ${sample.value.dailyRmssd}ms`);
    console.log(`   Deep RMSSD: ${sample.value.deepRmssd}ms`);
    console.log("");
  }

  console.log("=".repeat(60));
  console.log("✅ データ取得テスト成功");
  console.log("=".repeat(60));
} catch (error) {
  console.error("");
  console.error("=".repeat(60));
  console.error("❌ データ取得テスト失敗");
  console.error(`   エラー: ${error instanceof Error ? error.message : error}`);
  console.error("=".repeat(60));
  Deno.exit(1);
}
