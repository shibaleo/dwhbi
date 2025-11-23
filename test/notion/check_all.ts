// test/notion/check_all.ts
// Notion 全確認スクリプト一括実行
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/notion/check_all.ts
//   deno run --allow-env --allow-net --allow-read test/notion/check_all.ts --sync
//
// 必要な環境変数:
//   NOTION_INTEGRATION_SECRET, NOTION_METADATA_TABLE_ID
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@std/dotenv/load";
import { getDatabase } from "../../src/services/notion/api.ts";
import { metadataTableId } from "../../src/services/notion/auth.ts";
import { fetchEnabledConfigs } from "../../src/services/notion/fetch_config.ts";
import { syncNotionByDays } from "../../src/services/notion/sync_daily.ts";

const TEST_DAYS = 1;

/**
 * Step 1: API接続確認
 */
async function checkApi(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("[1/4] API Connection Check");
  console.log("=".repeat(60));

  const database = await getDatabase(metadataTableId);
  const title = database.title.map((t) => t.plain_text).join("");
  const propCount = Object.keys(database.properties).length;

  console.log(`   ✅ Database: ${title}`);
  console.log(`   ✅ Properties: ${propCount}`);

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

  let allPresent = true;
  for (const prop of requiredProps) {
    const exists = prop in database.properties;
    if (!exists) {
      console.log(`   ❌ Missing property: ${prop}`);
      allPresent = false;
    }
  }

  if (!allPresent) {
    throw new Error("Missing required properties in metadata table. See README.md for setup instructions.");
  }

  console.log("   ✅ All required properties present");
}

/**
 * Step 2: メタテーブル読み込み確認
 */
async function checkConfig(): Promise<number> {
  console.log("\n" + "=".repeat(60));
  console.log("[2/4] Config Loading Check");
  console.log("=".repeat(60));

  const configs = await fetchEnabledConfigs();

  if (configs.length === 0) {
    throw new Error("No enabled configs found. Enable at least one config in TB__METADATA.");
  }

  console.log(`   ✅ Enabled configs: ${configs.length}`);

  // sync_typeの集計
  const masterCount = configs.filter((c) => c.syncType === "master").length;
  const transactionCount = configs.filter((c) => c.syncType === "transaction").length;

  console.log(`   - master: ${masterCount}`);
  console.log(`   - transaction: ${transactionCount}`);

  // 設定一覧を表示
  console.log("\n   Configurations:");
  for (const config of configs) {
    console.log(`   - ${config.name} (${config.syncType})`);
    console.log(`     → ${config.supabaseSchema}.${config.supabaseTable}`);
  }

  return configs.length;
}

/**
 * Step 3: DB状態確認
 */
async function checkDb(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("[3/4] DB Connection Check");
  console.log("=".repeat(60));

  // Supabase接続確認
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

  if (!url || !key) {
    throw new Error("Missing Supabase credentials (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)");
  }

  console.log(`   ✅ SUPABASE_URL: ${url}`);
  console.log(`   ✅ SUPABASE_SERVICE_ROLE_KEY: configured`);

  // DB接続設定の確認
  const dbPassword = Deno.env.get("SUPABASE_DB_PASSWORD") || Deno.env.get("DB_PASSWORD");
  const projectId = Deno.env.get("SUPABASE_PROJECT_ID");
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");

  if (dbPassword || projectId || dbUrl) {
    console.log("   ✅ DB connection configured (auto-create tables enabled)");
  } else {
    console.log("   ⚠️  DB connection not configured (auto-create tables disabled)");
    console.log("      Set SUPABASE_DB_PASSWORD for automatic table creation");
  }
}

/**
 * Step 4: 同期テスト
 */
async function checkSync(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log(`[4/4] Sync Test (last ${TEST_DAYS} day${TEST_DAYS > 1 ? "s" : ""})`);
  console.log("⚠️  Writing to database");
  console.log("=".repeat(60));

  const result = await syncNotionByDays(TEST_DAYS);

  console.log(`   Tables synced: ${result.stats.tables.length}`);
  console.log(`   Fetched: ${result.stats.totalFetched}`);
  console.log(`   Saved: ${result.stats.totalSaved}`);

  if (result.stats.totalFailed > 0) {
    console.log(`   ⚠️  Failed: ${result.stats.totalFailed}`);
  }

  // テーブル別詳細
  if (result.stats.tables.length > 0) {
    console.log("\n   Details:");
    for (const table of result.stats.tables) {
      console.log(`   - ${table.table}: ${table.saved}/${table.fetched} saved`);
      if (table.failed > 0) {
        console.log(`     ⚠️  ${table.failed} failed`);
      }
    }
  }

  if (result.errors.length > 0) {
    console.log(`\n   ⚠️  Errors (${result.errors.length}):`);
    for (const error of result.errors) {
      console.log(`      - ${error}`);
    }
  }

  if (result.success) {
    console.log("\n   ✅ Sync completed successfully");
  } else {
    throw new Error("Sync failed");
  }
}

/**
 * メイン処理
 */
async function main() {
  const includeSync = Deno.args.includes("--sync");

  console.log("=".repeat(60));
  console.log("Notion Integration Check");
  console.log("=".repeat(60));
  console.log(`Mode: ${includeSync ? "with sync" : "read-only"}`);

  try {
    await checkApi();
    await checkConfig();
    await checkDb();

    if (includeSync) {
      await checkSync();
    } else {
      console.log("\n" + "=".repeat(60));
      console.log("ℹ️  Skipping sync test (use --sync to enable)");
      console.log("=".repeat(60));
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ All checks passed");
    console.log("=".repeat(60));
  } catch (err) {
    console.error("\n" + "=".repeat(60));
    console.error("❌ Check failed");
    console.error("=".repeat(60));
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    console.error("\nTroubleshooting:");
    console.error("  1. Check environment variables in .env");
    console.error("  2. Verify Notion integration permissions");
    console.error("  3. Ensure TB__METADATA is properly configured");
    console.error("  4. Run individual check scripts for detailed diagnostics:");
    console.error("     - test/notion/check_api.ts");
    console.error("     - test/notion/check_config.ts");
    console.error("     - test/notion/check_sync.ts");
    Deno.exit(1);
  }
}

main();
