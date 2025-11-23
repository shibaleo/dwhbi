// test/notion/check_sync.ts
// 同期動作確認スクリプト（⚠️ DB書き込みあり）
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/notion/check_sync.ts
//
// 必要な環境変数:
//   NOTION_INTEGRATION_SECRET, NOTION_METADATA_TABLE_ID
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// オプション（テーブル自動作成用）:
//   SUPABASE_DB_PASSWORD (推奨)
//   または SUPABASE_PROJECT_ID + DB_PASSWORD
//   または SUPABASE_DB_URL

import "jsr:@std/dotenv/load";
import { syncNotionByDays } from "../../src/services/notion/sync_daily.ts";

async function main() {
  const days = 1;

  console.log("=".repeat(60));
  console.log(`Notion Sync Check (last ${days} day${days > 1 ? "s" : ""})`);
  console.log("⚠️  Writing to database");
  console.log("=".repeat(60));

  // 環境変数の確認
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dbPassword = Deno.env.get("SUPABASE_DB_PASSWORD") || Deno.env.get("DB_PASSWORD");

  console.log("\n📋 Environment check:");
  console.log(`   SUPABASE_URL: ${url ? "✅" : "❌"}`);
  console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${key ? "✅" : "❌"}`);
  console.log(`   DB connection: ${dbPassword ? "✅ (auto-create enabled)" : "⚠️  (auto-create disabled)"}`);

  if (!dbPassword) {
    console.log("\n⚠️  Database connection not configured");
    console.log("   Set SUPABASE_DB_PASSWORD to enable automatic table creation");
    console.log("   See README.md > テーブル自動作成 for details");
  }

  try {
    // 同期実行
    console.log("\n📥 Starting sync: Notion → Supabase\n");
    const result = await syncNotionByDays(days);

    // 結果表示
    console.log("\n" + "=".repeat(60));
    if (result.success) {
      console.log("✅ Sync completed successfully");
    } else {
      console.log("⚠️  Sync completed with errors");
    }
    console.log("=".repeat(60));

    console.log("\n📊 Sync summary:");
    console.log(`   Tables synced: ${result.stats.tables.length}`);
    console.log(`   Total fetched: ${result.stats.totalFetched}`);
    console.log(`   Total saved: ${result.stats.totalSaved}`);
    if (result.stats.totalFailed > 0) {
      console.log(`   Total failed: ${result.stats.totalFailed}`);
    }
    console.log(`   Elapsed time: ${result.elapsedSeconds.toFixed(2)}s`);

    // テーブル別詳細
    if (result.stats.tables.length > 0) {
      console.log("\n📋 Details by table:");
      for (const table of result.stats.tables) {
        console.log(`\n  【${table.table}】`);
        console.log(`    Fetched: ${table.fetched}`);
        console.log(`    Saved: ${table.saved}`);
        if (table.failed > 0) {
          console.log(`    Failed: ${table.failed}`);
        }
      }
    }

    // エラー表示
    if (result.errors.length > 0) {
      console.log("\n⚠️  Errors:");
      for (const error of result.errors) {
        console.log(`   - ${error}`);
      }
    }

    // 成功時のメッセージ
    if (result.success && result.stats.totalSaved > 0) {
      console.log("\n✅ All data synced successfully");
      console.log("   Check Supabase dashboard to verify the data");
    }

    // 終了コード
    if (!result.success) {
      Deno.exit(1);
    }
  } catch (error) {
    console.error("\n" + "=".repeat(60));
    console.error("❌ Sync failed");
    console.error("=".repeat(60));
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);

    console.error("\nTroubleshooting:");
    console.error("  1. Verify all environment variables are set correctly");
    console.error("  2. Ensure TB__METADATA has enabled configurations");
    console.error("  3. Verify Integration has access to all databases");
    console.error("  4. Check if Supabase tables exist:");
    console.error("     - Set SUPABASE_DB_PASSWORD for auto-creation");
    console.error("     - Or manually create tables using sync_schema.ts");
    console.error("  5. Check Notion API rate limits (3 req/sec)");
    console.error("\nSee README.md > トラブルシューティング for more details");
    Deno.exit(1);
  }
}

main();
