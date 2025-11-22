// test/fitbit/manual/test_sync_all.ts
// Fitbit 全件同期テスト
//
// 使用例:
//   deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_sync_all.ts
//   FITBIT_TEST_DAYS=30 deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_sync_all.ts

import "jsr:@std/dotenv/load";
import { syncAllFitbitData } from "../../../src/services/fitbit/sync_all.ts";

const LINE = "=".repeat(60);

async function main() {
  console.log(LINE);
  console.log("Fitbit 全件同期テスト");
  console.log("⚠️  実際にDBに書き込みます");
  console.log(LINE);
  console.log("");

  // テスト期間（環境変数で変更可能）
  const startDateStr = Deno.env.get("FITBIT_TEST_START") || "2020-04-01";
  const endDateStr = Deno.env.get("FITBIT_TEST_END") || "2020-10-31";
  const includeIntraday = Deno.env.get("FITBIT_INCLUDE_INTRADAY") === "true";
  
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  const testDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));

  console.log("📝 設定:");
  console.log(`   テスト期間: ${testDays}日間`);
  console.log(`   開始日: ${startDate.toISOString().split("T")[0]}`);
  console.log(`   終了日: ${endDate.toISOString().split("T")[0]}`);
  console.log(`   Intraday: ${includeIntraday ? "あり" : "なし"}`);
  console.log("");

  // レート制限の情報
  const sleepRequests = Math.ceil(testDays / 100);
  const heartRateRequests = Math.ceil(testDays / 30);
  const hrvRequests = Math.ceil(testDays / 30);
  const breathingRateRequests = Math.ceil(testDays / 30);
  const cardioScoreRequests = Math.ceil(testDays / 30);
  const tempRequests = Math.ceil(testDays / 30);
  const azmRequests = Math.ceil(testDays / 30);
  const spo2Requests = testDays; // 1日ずつ
  const activityRequests = testDays; // 1日ずつ
  const intradayRequests = includeIntraday ? testDays : 0;

  const estimatedRequests = 
    sleepRequests + heartRateRequests + hrvRequests + breathingRateRequests +
    cardioScoreRequests + tempRequests + azmRequests + 
    spo2Requests + activityRequests + intradayRequests;

  console.log("⚠️  レート制限情報:");
  console.log(`   推定リクエスト数: 約${estimatedRequests}件`);
  console.log(`   Fitbit制限: 150リクエスト/時間`);
  if (estimatedRequests > 150) {
    console.log(`   ⚠️  制限を超える可能性があります！`);
  }
  console.log("");

  try {
    await syncAllFitbitData(startDate, endDate, includeIntraday);

    console.log("");
    console.log(LINE);
    console.log("✅ 全件同期テスト成功");
    console.log(LINE);
  } catch (error) {
    console.log("");
    console.log(LINE);
    console.log("❌ 全件同期テスト失敗");
    console.log(`   エラー: ${error instanceof Error ? error.message : error}`);
    console.log(LINE);
    Deno.exit(1);
  }
}

main();
