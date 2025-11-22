// test/fitbit/check_sync_all.ts
// 全件同期の確認スクリプト（⚠️ DB書き込みあり）
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/fitbit/check_sync_all.ts
//
// 環境変数で期間指定:
//   FITBIT_TEST_START=2020-04-01 FITBIT_TEST_END=2020-10-31 deno run ...
//   FITBIT_INCLUDE_INTRADAY=true deno run ...
//
// 必要な環境変数:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET

import "jsr:@std/dotenv/load";
import { syncAllFitbitData } from "../../src/services/fitbit/sync_all.ts";

async function main() {
  console.log("=".repeat(60));
  console.log("Fitbit 全件同期確認");
  console.log("⚠️  実際にDBに書き込みます");
  console.log("=".repeat(60));

  try {
    // 期間設定（環境変数で変更可能）
    const startDateStr = Deno.env.get("FITBIT_TEST_START") || "2020-04-01";
    const endDateStr = Deno.env.get("FITBIT_TEST_END") || "2020-10-31";
    const includeIntraday = Deno.env.get("FITBIT_INCLUDE_INTRADAY") === "true";

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);
    const testDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));

    console.log("\n📝 設定:");
    console.log(`   テスト期間: ${testDays}日間`);
    console.log(`   開始日: ${startDate.toISOString().split("T")[0]}`);
    console.log(`   終了日: ${endDate.toISOString().split("T")[0]}`);
    console.log(`   Intraday: ${includeIntraday ? "あり" : "なし"}`);

    // レート制限情報
    const sleepRequests = Math.ceil(testDays / 100);
    const heartRateRequests = Math.ceil(testDays / 30);
    const hrvRequests = Math.ceil(testDays / 30);
    const breathingRateRequests = Math.ceil(testDays / 30);
    const cardioScoreRequests = Math.ceil(testDays / 30);
    const tempRequests = Math.ceil(testDays / 30);
    const azmRequests = Math.ceil(testDays / 30);
    const spo2Requests = testDays;
    const activityRequests = testDays;
    const intradayRequests = includeIntraday ? testDays : 0;

    const estimatedRequests =
      sleepRequests + heartRateRequests + hrvRequests + breathingRateRequests +
      cardioScoreRequests + tempRequests + azmRequests +
      spo2Requests + activityRequests + intradayRequests;

    console.log("\n⚠️  レート制限情報:");
    console.log(`   推定リクエスト数: 約${estimatedRequests}件`);
    console.log(`   Fitbit制限: 150リクエスト/時間`);
    if (estimatedRequests > 150) {
      console.log(`   ⚠️  制限を超える可能性があります！`);
    }

    await syncAllFitbitData(startDate, endDate, includeIntraday);

    console.log("\n" + "=".repeat(60));
    console.log("✅ 全件同期確認成功");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ エラー:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

main();
