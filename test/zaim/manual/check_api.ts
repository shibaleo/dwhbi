// test/zaim/manual/check_api.ts
// Zaim API 疎通確認スクリプト
//
// 実行方法:
//   deno run --allow-env --allow-net test/zaim/manual/check_api.ts

import { ZaimAPI } from "../../../src/services/zaim/api.ts";

async function main() {
  console.log("=".repeat(50));
  console.log("Zaim API 疎通確認");
  console.log("=".repeat(50));

  try {
    const api = new ZaimAPI();

    // 1. ユーザー認証確認
    console.log("\n📋 ユーザー認証確認...");
    const user = await api.verifyUser();
    console.log(`  ✅ 認証成功: user_id=${user.me.id}, name=${user.me.name}`);

    // 2. カテゴリ取得
    console.log("\n📋 カテゴリ取得...");
    const categories = await api.getCategories();
    console.log(`  ✅ ${categories.categories.length} 件のカテゴリを取得`);
    if (categories.categories.length > 0) {
      const sample = categories.categories[0];
      console.log(`     例: id=${sample.id}, name=${sample.name}`);
    }

    // 3. ジャンル取得
    console.log("\n📋 ジャンル取得...");
    const genres = await api.getGenres();
    console.log(`  ✅ ${genres.genres.length} 件のジャンルを取得`);
    if (genres.genres.length > 0) {
      const sample = genres.genres[0];
      console.log(`     例: id=${sample.id}, name=${sample.name}`);
    }

    // 4. 口座取得
    console.log("\n📋 口座取得...");
    const accounts = await api.getAccounts();
    console.log(`  ✅ ${accounts.accounts.length} 件の口座を取得`);
    if (accounts.accounts.length > 0) {
      const sample = accounts.accounts[0];
      console.log(`     例: id=${sample.id}, name=${sample.name}`);
    }

    // 5. 取引取得（直近1件）
    console.log("\n📋 取引取得（直近1件）...");
    const money = await api.getMoney({ limit: 1 });
    console.log(`  ✅ ${money.money.length} 件の取引を取得`);
    if (money.money.length > 0) {
      const sample = money.money[0];
      console.log(`     例: id=${sample.id}, date=${sample.date}, amount=${sample.amount}`);
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ すべてのAPIエンドポイントに正常接続");
    console.log("=".repeat(50));

  } catch (error) {
    console.error("\n❌ エラー発生:", error.message);
    console.error("\n環境変数を確認してください:");
    console.error("  - ZAIM_CONSUMER_KEY");
    console.error("  - ZAIM_CONSUMER_SECRET");
    console.error("  - ZAIM_ACCESS_TOKEN");
    console.error("  - ZAIM_ACCESS_TOKEN_SECRET");
    Deno.exit(1);
  }
}

main();
