// test/zaim/manual/check_sync.ts
// 少量データでの同期動作確認スクリプト
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/zaim/manual/check_sync.ts

import { fetchZaimData } from "../../../src/services/zaim/fetch_data.ts";
import {
  createZaimClient,
  syncMasters,
  syncTransactions,
  getExistingTransactionIds,
} from "../../../src/services/zaim/write_db.ts";

async function main() {
  console.log("=".repeat(50));
  console.log("Zaim 同期動作確認（直近1日分）");
  console.log("=".repeat(50));

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const startDate = yesterday.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  console.log(`\n📅 対象期間: ${startDate} 〜 ${endDate}`);

  try {
    // 1. データ取得
    console.log("\n📥 Zaim APIからデータ取得...");
    const data = await fetchZaimData({
      startDate,
      endDate,
    });

    console.log(`  ✅ zaim_user_id: ${data.zaimUserId}`);
    console.log(`  ✅ カテゴリ: ${data.categories.length} 件`);
    console.log(`  ✅ ジャンル: ${data.genres.length} 件`);
    console.log(`  ✅ 口座: ${data.accounts.length} 件`);
    console.log(`  ✅ 取引: ${data.transactions.length} 件`);

    // 2. DB接続
    console.log("\n📤 Supabaseに接続...");
    const zaim = createZaimClient();
    console.log("  ✅ 接続成功");

    // 3. マスタ同期
    console.log("\n📤 マスタデータ同期...");
    const masterResult = await syncMasters(
      zaim,
      data.zaimUserId,
      data.categories,
      data.genres,
      data.accounts
    );
    console.log(`  ✅ カテゴリ: ${masterResult.categories} 件`);
    console.log(`  ✅ ジャンル: ${masterResult.genres} 件`);
    console.log(`  ✅ 口座: ${masterResult.accounts} 件`);

    // 4. 既存ID取得
    console.log("\n📋 既存トランザクションID取得...");
    const existingIds = await getExistingTransactionIds(
      zaim,
      data.zaimUserId,
      startDate,
      endDate
    );
    console.log(`  ✅ 既存: ${existingIds.size} 件`);

    // 5. トランザクション同期
    console.log("\n📤 トランザクション同期...");
    const txResult = await syncTransactions(
      zaim,
      data.zaimUserId,
      data.transactions,
      existingIds
    );
    console.log(`  📊 取得: ${txResult.fetched} 件`);
    console.log(`  ➕ 新規: ${txResult.inserted} 件`);
    console.log(`  🔄 更新: ${txResult.updated} 件`);
    console.log(`  ⏭️ スキップ: ${txResult.skipped} 件`);
    if (txResult.failed > 0) {
      console.log(`  ❌ 失敗: ${txResult.failed} 件`);
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ 同期動作確認完了");
    console.log("=".repeat(50));

  } catch (error) {
    console.error("\n❌ エラー発生:", error.message);
    console.error(error.stack);
    Deno.exit(1);
  }
}

main();
