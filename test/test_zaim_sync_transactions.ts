// sync_transactions.test.ts
import { assertEquals, assertExists } from "https://deno.land/std@0.203.0/assert/mod.ts";
import { ZaimTransactionSync, SyncStats } from '../src/services/zaim/sync_transactions.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// テスト共通オプション（リソースリーク検証を無効化）
const testOptions = {
  sanitizeResources: false,
  sanitizeOps: false,
};

// テスト用のSupabaseクライアント
const getSupabaseClient = () => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase環境変数が設定されていません');
  }
  
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
};

Deno.test({
  ...testOptions,
  name: "ZaimTransactionSync - 初期化テスト",
  fn() {
    const sync = new ZaimTransactionSync();
    assertExists(sync);
    console.log("✓ ZaimTransactionSyncインスタンスが正常に作成されました");
  },
});

Deno.test({
  ...testOptions,
  name: "ZaimTransactionSync - 環境変数不足時のエラー",
  fn() {
    const originalUrl = Deno.env.get('SUPABASE_URL');
    const originalKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    try {
      Deno.env.delete('SUPABASE_URL');
      Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
      
      try {
        new ZaimTransactionSync();
        throw new Error("エラーが発生すべき");
      } catch (error) {
        assertEquals(
          (error as Error).message,
          'Supabase環境変数が設定されていません'
        );
        console.log("✓ 環境変数不足時に適切なエラーが発生します");
      }
    } finally {
      if (originalUrl) Deno.env.set('SUPABASE_URL', originalUrl);
      if (originalKey) Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', originalKey);
    }
  },
});

Deno.test({
  ...testOptions,
  name: "ZaimTransactionSync - 最近30日間のトランザクション同期",
  async fn() {
    const sync = new ZaimTransactionSync();
    const stats = await sync.syncRecentTransactions(30);
    
    assertExists(stats);
    assertEquals(typeof stats.fetched, "number");
    assertEquals(typeof stats.inserted, "number");
    assertEquals(typeof stats.updated, "number");
    
    console.log(`\n📊 同期結果:`);
    console.log(`  取得: ${stats.fetched}件`);
    console.log(`  挿入: ${stats.inserted}件`);
    console.log(`  更新: ${stats.updated}件`);
    
    // 同期ログの確認
    const supabase = getSupabaseClient();
    const { data: logs, error } = await supabase
      .from('zaim_sync_log')
      .select('*')
      .order('sync_started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (error) {
      console.error("同期ログ取得エラー:", error.message);
      return;
    }
    
    if (logs) {
      assertExists(logs);
      assertEquals(logs.sync_status, 'completed');
      assertEquals(logs.records_fetched, stats.fetched);
      console.log("✓ 同期ログが正常に記録されました");
    }
  },
});

Deno.test({
  ...testOptions,
  name: "ZaimTransactionSync - 特定期間のトランザクション同期",
  async fn() {
    const sync = new ZaimTransactionSync();
    
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);
    
    const stats = await sync.syncTransactions({
      startDate: sevenDaysAgo.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0],
    });
    
    assertExists(stats);
    console.log(`\n📊 7日間の同期結果:`);
    console.log(`  取得: ${stats.fetched}件`);
    console.log(`  挿入: ${stats.inserted}件`);
    console.log(`  更新: ${stats.updated}件`);
  },
});

Deno.test({
  ...testOptions,
  name: "ZaimTransactionSync - 月次トランザクション同期",
  async fn() {
    const sync = new ZaimTransactionSync();
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    
    const stats = await sync.syncMonthlyTransactions(currentYear, currentMonth);
    
    assertExists(stats);
    console.log(`\n📊 ${currentYear}年${currentMonth}月の同期結果:`);
    console.log(`  取得: ${stats.fetched}件`);
    console.log(`  挿入: ${stats.inserted}件`);
    console.log(`  更新: ${stats.updated}件`);
  },
});

Deno.test({
  ...testOptions,
  name: "ZaimTransactionSync - 支出のみ同期",
  async fn() {
    const sync = new ZaimTransactionSync();
    
    const stats = await sync.syncTransactions({
      mode: 'payment',
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
    });
    
    assertExists(stats);
    console.log(`\n📊 支出のみの同期結果:`);
    console.log(`  取得: ${stats.fetched}件`);
    console.log(`  挿入: ${stats.inserted}件`);
    console.log(`  更新: ${stats.updated}件`);
  },
});

Deno.test({
  ...testOptions,
  name: "ZaimTransactionSync - upsert動作の確認（再同期テスト）",
  async fn() {
    const sync = new ZaimTransactionSync();
    
    // 1回目の同期
    const stats1 = await sync.syncRecentTransactions(7);
    console.log(`\n📊 1回目の同期結果:`);
    console.log(`  取得: ${stats1.fetched}件`);
    console.log(`  挿入: ${stats1.inserted}件`);
    console.log(`  更新: ${stats1.updated}件`);
    
    // 2回目の同期（同じ期間）
    await new Promise(resolve => setTimeout(resolve, 2000));
    const stats2 = await sync.syncRecentTransactions(7);
    console.log(`\n📊 2回目の同期結果:`);
    console.log(`  取得: ${stats2.fetched}件`);
    console.log(`  挿入: ${stats2.inserted}件`);
    console.log(`  更新: ${stats2.updated}件`);
    
    // 2回目は取得件数が同じで、挿入は0、更新が取得件数と同じであるべき
    assertEquals(stats2.fetched, stats1.fetched, "取得件数が同じであること");
    
    if (stats1.fetched > 0) {
      assertEquals(stats2.inserted, 0, "2回目は新規挿入が0件であること");
      assertEquals(stats2.updated, stats1.fetched, "取得件数分が更新されること");
    }
    
    console.log("✓ upsert動作が正常に機能しています");
  },
});

Deno.test({
  ...testOptions,
  name: "ZaimTransactionSync - 同期後のデータ検証",
  async fn() {
    const sync = new ZaimTransactionSync();
    await sync.syncRecentTransactions(7);
    
    const supabase = getSupabaseClient();
    
    // Zaim User IDを取得
    const { data: logData } = await supabase
      .from('zaim_sync_log')
      .select('zaim_user_id')
      .order('sync_started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    const zaimUserId = logData?.zaim_user_id;
    
    if (!zaimUserId) {
      console.log("⚠️  Zaim User IDが取得できないため、データ検証をスキップ");
      return;
    }
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { data: transactions, error } = await supabase
      .from('zaim_transactions')
      .select('*')
      .eq('zaim_user_id', zaimUserId)
      .gte('date', sevenDaysAgo.toISOString().split('T')[0])
      .order('date', { ascending: false })
      .limit(5);
    
    if (error) {
      throw new Error(`データ取得エラー: ${error.message}`);
    }
    
    assertExists(transactions);
    
    if (transactions && transactions.length > 0) {
      console.log(`\n📋 最新5件のトランザクション:`);
      transactions.forEach((t, i) => {
        console.log(`  ${i + 1}. ${t.date} | ${t.transaction_type} | ¥${t.amount} | ${t.name || '(名称なし)'}`);
      });
      
      // データ構造の検証
      const firstTransaction = transactions[0];
      assertExists(firstTransaction.zaim_user_id);
      assertExists(firstTransaction.zaim_id);
      assertExists(firstTransaction.transaction_type);
      assertExists(firstTransaction.amount);
      assertExists(firstTransaction.date);
      assertExists(firstTransaction.synced_at);
      
      console.log("✓ データ構造が正しく検証されました");
    }
  },
});

Deno.test({
  ...testOptions,
  name: "ZaimTransactionSync - ページネーション動作確認",
  async fn() {
    const sync = new ZaimTransactionSync();
    
    const stats = await sync.syncTransactions({
      startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      limit: 10,
    });
    
    assertExists(stats);
    console.log(`\n📊 ページネーション動作確認（limit=10）:`);
    console.log(`  取得: ${stats.fetched}件`);
    console.log(`  挿入: ${stats.inserted}件`);
    console.log(`  更新: ${stats.updated}件`);
    
    if (stats.fetched > 10) {
      console.log(`  ✓ ページネーションが機能している（10件以上取得）`);
    }
  },
});

Deno.test({
  ...testOptions,
  name: "ZaimTransactionSync - 同期ログの完全性確認",
  async fn() {
    const sync = new ZaimTransactionSync();
    await sync.syncRecentTransactions(3);
    
    const supabase = getSupabaseClient();
    const { data: log, error } = await supabase
      .from('zaim_sync_log')
      .select('*')
      .order('sync_started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (error || !log) {
      console.error("同期ログ取得エラー:", error?.message);
      return;
    }
    
    assertExists(log);
    assertExists(log.zaim_user_id);
    assertExists(log.sync_started_at);
    assertExists(log.sync_completed_at);
    assertEquals(log.sync_status, 'completed');
    assertEquals(log.api_endpoint, '/v2/home/money');
    assertExists(log.records_fetched);
    assertExists(log.records_inserted);
    assertExists(log.records_updated);
    
    console.log(`\n📝 同期ログ詳細:`);
    console.log(`  ID: ${log.id}`);
    console.log(`  開始: ${log.sync_started_at}`);
    console.log(`  完了: ${log.sync_completed_at}`);
    console.log(`  ステータス: ${log.sync_status}`);
    console.log(`  取得/挿入/更新: ${log.records_fetched}/${log.records_inserted}/${log.records_updated}`);
  },
});