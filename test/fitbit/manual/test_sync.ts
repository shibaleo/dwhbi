// test/fitbit/manual/test_sync.ts
// Fitbit同期の手動テスト（実際にDBに書き込む）
//
// 実行:
//   deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_sync.ts
//   FITBIT_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_sync.ts
//
// 必要な環境変数:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET

import "jsr:@std/dotenv/load";
import { syncFitbitDaily } from "../../../src/services/fitbit/sync_daily.ts";

const DEFAULT_DAYS = 3;

console.log("=".repeat(60));
console.log("Fitbit 同期テスト");
console.log("⚠️  実際にDBに書き込みます");
console.log("=".repeat(60));
console.log("");

try {
  const days = parseInt(Deno.env.get("FITBIT_SYNC_DAYS") || String(DEFAULT_DAYS));
  
  console.log(`📝 設定:`);
  console.log(`   同期日数: ${days}日間`);
  console.log("");

  const result = await syncFitbitDaily(days);

  console.log("");
  console.log("=".repeat(60));
  if (result.success) {
    console.log("✅ 同期テスト成功");
  } else {
    console.log("⚠️  同期テスト完了（エラーあり）");
    console.log(`   エラー: ${result.errors.join(", ")}`);
  }
  console.log("=".repeat(60));

  Deno.exit(result.success ? 0 : 1);
} catch (error) {
  console.error("");
  console.error("=".repeat(60));
  console.error("❌ 同期テスト失敗");
  console.error(`   エラー: ${error instanceof Error ? error.message : error}`);
  console.error("=".repeat(60));
  Deno.exit(1);
}
