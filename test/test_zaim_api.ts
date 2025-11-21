// zaim/test_api.ts

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { ZaimAPI } from "../src/services/zaim/api.ts";

async function testAPI() {
  console.log("=== Zaim API Test ===\n");

  const api = new ZaimAPI();
  console.log("✓ ZaimAPI instance created\n");

  // 1. ユーザー情報確認
  try {
    console.log("1. Testing verifyUser()");
    const userInfo = await api.verifyUser();
    console.log("✓ User verified");
    console.log(`   User: ${userInfo.me.name} (ID: ${userInfo.me.id})`);
    console.log(`   Input count: ${userInfo.me.input_count}, Day count: ${userInfo.me.day_count}\n`);
  } catch (error) {
    console.error("❌ verifyUser() failed:", error);
    Deno.exit(1);
  }

  // 2. カテゴリ一覧取得
  try {
    console.log("2. Testing getCategories()");
    const result = await api.getCategories();
    console.log(`✓ Categories retrieved: ${result.categories.length} items`);
    console.log("   Sample categories:");
    result.categories.slice(0, 3).forEach(cat => {
      console.log(`   - ${cat.name} (ID: ${cat.id}, mode: ${cat.mode})`);
    });
    console.log();
  } catch (error) {
    console.error("❌ getCategories() failed:", error);
    Deno.exit(1);
  }

  // 3. ジャンル一覧取得
  try {
    console.log("3. Testing getGenres()");
    const result = await api.getGenres();
    console.log(`✓ Genres retrieved: ${result.genres.length} items`);
    console.log("   Sample genres:");
    result.genres.slice(0, 3).forEach(genre => {
      console.log(`   - ${genre.name} (ID: ${genre.id}, category_id: ${genre.category_id})`);
    });
    console.log();
  } catch (error) {
    console.error("❌ getGenres() failed:", error);
    Deno.exit(1);
  }

  // 4. 口座一覧取得
  try {
    console.log("4. Testing getAccounts()");
    const result = await api.getAccounts();
    console.log(`✓ Accounts retrieved: ${result.accounts.length} items`);
    console.log("   Sample accounts:");
    result.accounts.slice(0, 3).forEach(acc => {
      console.log(`   - ${acc.name} (ID: ${acc.id})`);
    });
    console.log();
  } catch (error) {
    console.error("❌ getAccounts() failed:", error);
    Deno.exit(1);
  }

  // 5. 取引データ取得（パラメータなし）
  try {
    console.log("5. Testing getMoney() without parameters");
    const result = await api.getMoney();
    console.log(`✓ Money data retrieved: ${result.money.length} transactions`);
    if (result.money.length > 0) {
      const sample = result.money[0];
      console.log("   Sample transaction:");
      console.log(`   - Date: ${sample.date}`);
      console.log(`   - Mode: ${sample.mode}`);
      console.log(`   - Amount: ${sample.amount}`);
      console.log(`   - Comment: ${sample.comment || "N/A"}`);
    }
    console.log();
  } catch (error) {
    console.error("❌ getMoney() failed:", error);
    Deno.exit(1);
  }

  // 6. 取引データ取得（パラメータあり - 最近7日間、支出のみ）
  try {
    console.log("6. Testing getMoney() with parameters (last 7 days, payment only)");
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    
    const startDate = sevenDaysAgo.toISOString().split('T')[0];
    const endDate = today.toISOString().split('T')[0];
    
    const result = await api.getMoney({
      mode: "payment",
      start_date: startDate,
      end_date: endDate,
      limit: 10,
    });
    console.log(`✓ Filtered money data retrieved: ${result.money.length} transactions`);
    console.log(`   Period: ${startDate} to ${endDate}`);
    console.log(`   Mode: payment only\n`);
  } catch (error) {
    console.error("❌ getMoney() with parameters failed:", error);
    Deno.exit(1);
  }

  console.log("=== All tests passed ===");
}

if (import.meta.main) {
  testAPI();
}