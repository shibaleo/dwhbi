// test/notion/check_config.ts
// メタテーブル読み込み確認スクリプト
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/notion/check_config.ts
//
// 必要な環境変数:
//   NOTION_INTEGRATION_SECRET, NOTION_METADATA_TABLE_ID

import "jsr:@std/dotenv/load";
import { fetchEnabledConfigs } from "../../src/services/notion/fetch_config.ts";

async function main() {
  console.log("=".repeat(60));
  console.log("Notion Config Loading Check");
  console.log("=".repeat(60));

  try {
    // enabled=trueの設定を取得
    console.log("\n📋 Loading enabled configurations...");
    const configs = await fetchEnabledConfigs();

    if (configs.length === 0) {
      console.log("\n⚠️  No enabled configurations found");
      console.log("   Enable at least one config in TB__METADATA");
      console.log("   Set 'enabled' checkbox to true for desired databases");
      Deno.exit(1);
    }

    console.log(`   ✅ Found ${configs.length} enabled configuration${configs.length > 1 ? "s" : ""}`);

    // 設定詳細を表示
    console.log("\n📋 Enabled configurations:");
    for (const config of configs) {
      console.log(`\n  【${config.name}】`);
      console.log(`    Database ID: ${config.databaseId}`);
      console.log(`    Target: ${config.supabaseSchema}.${config.supabaseTable}`);
      console.log(`    Sync Type: ${config.syncType}`);
      console.log(`    Last Synced: ${config.lastSyncedAt ?? "never"}`);
      if (config.description) {
        console.log(`    Description: ${config.description}`);
      }
    }

    // sync_typeの集計
    const masterCount = configs.filter((c) => c.syncType === "master").length;
    const transactionCount = configs.filter((c) => c.syncType === "transaction").length;

    console.log("\n📊 Sync type summary:");
    console.log(`   master: ${masterCount} configuration${masterCount !== 1 ? "s" : ""}`);
    console.log(`   transaction: ${transactionCount} configuration${transactionCount !== 1 ? "s" : ""}`);

    // 検証
    console.log("\n📋 Validation:");
    let hasIssues = false;

    for (const config of configs) {
      // 必須フィールドの確認
      const missingFields = [];
      if (!config.databaseId) missingFields.push("database_id");
      if (!config.supabaseTable) missingFields.push("supabase_table");
      if (!config.supabaseSchema) missingFields.push("supabase_schema");
      if (!config.syncType) missingFields.push("sync_type");

      if (missingFields.length > 0) {
        console.log(`   ⚠️  ${config.name}: missing ${missingFields.join(", ")}`);
        hasIssues = true;
      } else {
        console.log(`   ✅ ${config.name}: all required fields present`);
      }
    }

    if (hasIssues) {
      console.log("\n⚠️  Some configurations have missing required fields");
      console.log("   Fix them in TB__METADATA before syncing");
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Config loading successful");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n" + "=".repeat(60));
    console.error("❌ Config loading failed");
    console.error("=".repeat(60));
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);

    console.error("\nTroubleshooting:");
    console.error("  1. Verify NOTION_INTEGRATION_SECRET is correct");
    console.error("  2. Verify NOTION_METADATA_TABLE_ID is correct");
    console.error("  3. Ensure TB__METADATA has at least one configuration");
    console.error("  4. Verify all required fields are filled:");
    console.error("     - Name (Title)");
    console.error("     - database_id (Text)");
    console.error("     - supabase_table (Text)");
    console.error("     - supabase_schema (Text)");
    console.error("     - sync_type (Select: master/transaction)");
    console.error("     - enabled (Checkbox: true)");
    console.error("\nSee README.md > トラブルシューティング for more details");
    Deno.exit(1);
  }
}

main();
