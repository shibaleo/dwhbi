// test/tanita/manual/test_sync.ts
// sync_daily の統合テスト（実際にDBに書き込む）
//
// 実行:
//   deno run --allow-env --allow-net --allow-read test/tanita/manual/test_sync.ts
//   TANITA_SYNC_DAYS=3 deno run --allow-env --allow-net --allow-read test/tanita/manual/test_sync.ts
//
// 必要な環境変数:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   TANITA_CLIENT_ID, TANITA_CLIENT_SECRET
//
// ⚠️ 注意: このテストは実際にSupabaseにデータを書き込みます

import "jsr:@std/dotenv/load";
import { syncTanitaDaily } from "../../../src/services/tanita/sync_daily.ts";

const DEFAULT_DAYS = 3;

console.log("=".repeat(60));
console.log("Tanita sync_daily 統合テスト");
console.log("=".repeat(60));
console.log("");
console.log("⚠️  このテストは実際にSupabaseにデータを書き込みます");
console.log("");

try {
  const days = parseInt(Deno.env.get("TANITA_SYNC_DAYS") || String(DEFAULT_DAYS));

  const result = await syncTanitaDaily(days);

  console.log("");
  console.log("=".repeat(60));
  console.log("📊 テスト結果");
  console.log("=".repeat(60));
  console.log(`   成功: ${result.success ? "✓" : "✗"}`);
  console.log(`   タイムスタンプ: ${result.timestamp}`);
  console.log(`   処理時間: ${result.elapsedSeconds.toFixed(1)}秒`);
  console.log("");
  console.log("   保存件数:");
  console.log(`     体組成: ${result.stats.bodyComposition}件`);
  console.log(`     血圧:   ${result.stats.bloodPressure}件`);
  console.log(`     歩数:   ${result.stats.steps}件`);

  if (result.errors.length > 0) {
    console.log("");
    console.log("   エラー:");
    for (const err of result.errors) {
      console.log(`     - ${err}`);
    }
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(result.success ? "✅ 統合テスト成功" : "⚠️  統合テスト完了（エラーあり）");
  console.log("=".repeat(60));

  Deno.exit(result.success ? 0 : 1);
} catch (error) {
  console.error("");
  console.error("=".repeat(60));
  console.error("❌ 統合テスト失敗");
  console.error(`   エラー: ${error instanceof Error ? error.message : error}`);
  console.error("=".repeat(60));
  Deno.exit(1);
}
