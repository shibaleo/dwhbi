// test/notion/check_api.ts
// API 疎通確認スクリプト
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/notion/check_api.ts
//
// 必要な環境変数:
//   NOTION_INTEGRATION_SECRET, NOTION_METADATA_TABLE_ID

import "jsr:@std/dotenv/load";
import { getDatabase } from "../../src/services/notion/api.ts";
import { metadataTableId } from "../../src/services/notion/auth.ts";

async function main() {
  console.log("=".repeat(60));
  console.log("Notion API Connection Check");
  console.log("=".repeat(60));

  try {
    // メタテーブルのデータベース構造を取得
    console.log("\n📋 Fetching metadata table structure...");
    console.log(`   Database ID: ${metadataTableId}`);

    const database = await getDatabase(metadataTableId);
    const title = database.title.map((t) => t.plain_text).join("");

    console.log(`   ✅ Database name: ${title}`);
    console.log(`   ✅ Properties: ${Object.keys(database.properties).length}`);

    // プロパティ一覧を表示
    console.log("\n📋 Properties:");
    for (const [name, prop] of Object.entries(database.properties)) {
      console.log(`   - ${name} (${prop.type})`);
    }

    // 必須プロパティの存在確認
    const requiredProps = [
      "Name",
      "database_id",
      "supabase_table",
      "supabase_schema",
      "sync_type",
      "enabled",
      "last_synced_at",
    ];

    console.log("\n📋 Required properties check:");
    let allPresent = true;
    for (const prop of requiredProps) {
      const exists = prop in database.properties;
      console.log(`   ${exists ? "✅" : "❌"} ${prop}`);
      if (!exists) allPresent = false;
    }

    if (!allPresent) {
      console.log("\n⚠️  Some required properties are missing");
      console.log("   See README.md > メタテーブルセットアップ for setup instructions");
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ API connection successful");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n" + "=".repeat(60));
    console.error("❌ API connection failed");
    console.error("=".repeat(60));
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    
    console.error("\nTroubleshooting:");
    console.error("  1. Verify NOTION_INTEGRATION_SECRET is correct");
    console.error("  2. Verify NOTION_METADATA_TABLE_ID is correct");
    console.error("  3. Ensure Integration has access to TB__METADATA");
    console.error("  4. Check Notion API status: https://status.notion.so/");
    console.error("\nSee README.md > トラブルシューティング for more details");
    Deno.exit(1);
  }
}

main();
