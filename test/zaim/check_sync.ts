// test/zaim/check_sync.ts
// 同期動作確認スクリプト（⚠️ DB書き込みあり）
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/zaim/check_sync.ts
//
// 必要な環境変数:
//   ZAIM_CONSUMER_KEY, ZAIM_CONSUMER_SECRET
//   ZAIM_ACCESS_TOKEN, ZAIM_ACCESS_TOKEN_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@std/dotenv/load";
import { fetchZaimData } from "../../src/services/zaim/fetch_data.ts";
import {
  createZaimClient,
  syncMasters,
  syncTransactions,
  getExistingTransactionIds,
} from "../../src/services/zaim/write_db.ts";

async function main() {
  console.log("=".repeat(60));
  console.log("Zaim 同期確認（直近1日分）");
  console.log("⚠️  実際にDBに書き込みます");
  console.log("=".repeat(60));

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const startDate = yesterday.toISOString().split("T")[0];
  const endDate = today.toISOString().split("T")[0];

  console.log(`\n📅 対象期間: ${startDate} 〜 ${endDate}`);

  try {
    // データ取得
    console.log("\n📥 Zaim APIからデータ取得...");
    const data = await fetchZaimData({
      startDate,
      endDate,
    });

    console.log(`   ✅ zaim_user_id: ${data.zaimUserId}`);
    console.log(`   ✅ カテゴリ: ${data.categories.length} 件`);
    console.log(`   ✅ ジャンル: ${data.genres.length} 件`);
    console.log(`   ✅ 口座: ${data.accounts.length} 件`);
    console.log(`   ✅ 取引: ${data.transactions.length} 件`);

    // DB接続
    console.log("\n📤 Supabaseに接続...");
    const zaim = createZaimClient();
    console.log("   ✅ 接続成功");

    // マスタ同期
    console.log("\n📤 マスタデータ同期...");
    const masterResult = await syncMasters(
      zaim,
      data.zaimUserId,
      data.categories,
      data.genres,
      data.accounts
    );
    console.log(`   ✅ カテゴリ: ${masterResult.categories} 件`);
    console.log(`   ✅ ジャンル: ${masterResult.genres} 件`);
    console.log(`   ✅ 口座: ${masterResult.accounts} 件`);

    // 既存ID取得
    console.log("\n📋 既存トランザクションID取得...");
    const existingIds = await getExistingTransactionIds(
      zaim,
      data.zaimUserId,
      startDate,
      endDate
    );
    console.log(`   ✅ 既存: ${existingIds.size} 件`);

    // トランザクション同期
    console.log("\n📤 トランザクション同期...");
    const txResult = await syncTransactions(
      zaim,
      data.zaimUserId,
      data.transactions,
      existingIds
    );
    console.log(`   📊 取得: ${txResult.fetched} 件`);
    console.log(`   ➕ 新規: ${txResult.inserted} 件`);
    console.log(`   🔄 更新: ${txResult.updated} 件`);
    console.log(`   ⏭️  スキップ: ${txResult.skipped} 件`);
    if (txResult.failed > 0) {
      console.log(`   ❌ 失敗: ${txResult.failed} 件`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ 同期確認完了");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ エラー:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

main();
