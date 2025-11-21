// test-sync-masters.ts
import { ZaimMasterSync } from "../src/services/zaim/sync_masters.ts";
import type { SyncStats } from "../src/services/zaim/sync_masters.ts";

/**
 * カテゴリマスタ同期テスト
 */
Deno.test({
  name: "カテゴリマスタ同期",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('カテゴリマスタ同期テスト');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const sync = new ZaimMasterSync();
    const categoryStats = await sync.syncCategories();
    
    console.log('\n📊 カテゴリ同期結果:');
    console.log(`   - 取得件数: ${categoryStats.fetched}`);
    console.log(`   - 挿入件数: ${categoryStats.inserted}`);
    console.log(`   - 更新件数: ${categoryStats.updated}`);
    console.log('✅ カテゴリ同期テスト: 成功\n');
  }
});

/**
 * ジャンルマスタ同期テスト
 */
Deno.test({
  name: "ジャンルマスタ同期",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('ジャンルマスタ同期テスト');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const sync = new ZaimMasterSync();
    const genreStats = await sync.syncGenres();
    
    console.log('\n📊 ジャンル同期結果:');
    console.log(`   - 取得件数: ${genreStats.fetched}`);
    console.log(`   - 挿入件数: ${genreStats.inserted}`);
    console.log(`   - 更新件数: ${genreStats.updated}`);
    console.log('✅ ジャンル同期テスト: 成功\n');
  }
});

/**
 * 口座マスタ同期テスト
 */
Deno.test({
  name: "口座マスタ同期",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('口座マスタ同期テスト');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const sync = new ZaimMasterSync();
    const accountStats = await sync.syncAccounts();
    
    console.log('\n📊 口座同期結果:');
    console.log(`   - 取得件数: ${accountStats.fetched}`);
    console.log(`   - 挿入件数: ${accountStats.inserted}`);
    console.log(`   - 更新件数: ${accountStats.updated}`);
    console.log('✅ 口座同期テスト: 成功\n');
  }
});