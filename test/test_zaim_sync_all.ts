// test_zaim_sync_all.ts
// 全トランザクション同期のテストスクリプト
import { ZaimTransactionSync } from "../src/services/zaim/sync_transactions.ts";
import { AllTransactionSync } from "../src/services/zaim/sync_all_transactions.ts";

/**
 * テストシナリオ:
 * 1. 直近1ヶ月のデータで同期テスト
 * 2. API呼び出し回数とレート制限の確認
 * 3. 処理時間の測定
 */
async function testSyncRecent() {
  console.log('='.repeat(60));
  console.log('テスト1: 直近30日間の同期テスト');
  console.log('='.repeat(60));

  const sync = new ZaimTransactionSync();
  const startTime = Date.now();

  try {
    const stats = await sync.syncRecentTransactions(30);
    
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n📊 テスト結果:');
    console.log(`  実行時間: ${elapsedTime}秒`);
    console.log(`  取得件数: ${stats.fetched}件`);
    console.log(`  挿入件数: ${stats.inserted}件`);
    console.log(`  更新件数: ${stats.updated}件`);
    
    if (stats.fetched > 0) {
      const recordsPerSecond = (stats.fetched / parseFloat(elapsedTime)).toFixed(2);
      console.log(`  処理速度: ${recordsPerSecond}件/秒`);
      
      // 全期間の推定時間を計算（仮に5年分、月30日、1日5件として）
      const estimatedTotal = 5 * 12 * 30 * 5; // 9000件
      const estimatedTime = (estimatedTotal / parseFloat(recordsPerSecond) / 60).toFixed(2);
      console.log(`\n💡 推定: 全期間(約${estimatedTotal}件)の同期には約${estimatedTime}分かかる見込み`);
    }
    
    console.log('\n✅ テスト成功');
    return true;
  } catch (error) {
    console.error('\n❌ テスト失敗:', error);
    return false;
  }
}

/**
 * 特定月のテスト（データ量が少ない月を選択）
 */
async function testSyncSingleMonth() {
  console.log('\n' + '='.repeat(60));
  console.log('テスト2: 単月同期テスト (今月)');
  console.log('='.repeat(60));

  const sync = new ZaimTransactionSync();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const startTime = Date.now();

  try {
    const stats = await sync.syncMonthlyTransactions(year, month);
    
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n📊 テスト結果:');
    console.log(`  対象月: ${year}年${month}月`);
    console.log(`  実行時間: ${elapsedTime}秒`);
    console.log(`  取得件数: ${stats.fetched}件`);
    console.log(`  挿入件数: ${stats.inserted}件`);
    console.log(`  更新件数: ${stats.updated}件`);
    
    console.log('\n✅ テスト成功');
    return true;
  } catch (error) {
    console.error('\n❌ テスト失敗:', error);
    return false;
  }
}

/**
 * レート制限テスト（連続API呼び出し）
 */
async function testRateLimit() {
  console.log('\n' + '='.repeat(60));
  console.log('テスト3: レート制限確認');
  console.log('='.repeat(60));
  console.log('⚠️  このテストは複数回API呼び出しを行います');

  const sync = new ZaimTransactionSync();
  const now = new Date();
  const results: number[] = [];

  try {
    // 直近3ヶ月を連続で同期
    for (let i = 0; i < 3; i++) {
      const testDate = new Date(now);
      testDate.setMonth(testDate.getMonth() - i);
      const year = testDate.getFullYear();
      const month = testDate.getMonth() + 1;

      console.log(`\n  ${i + 1}/3: ${year}年${month}月を同期中...`);
      const startTime = Date.now();
      
      await sync.syncMonthlyTransactions(year, month);
      
      const elapsed = Date.now() - startTime;
      results.push(elapsed);
      console.log(`    完了 (${(elapsed / 1000).toFixed(2)}秒)`);
      
      // 次の同期前に少し待機
      if (i < 2) {
        console.log('    待機中... (1秒)');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log('\n📊 レート制限テスト結果:');
    results.forEach((time, index) => {
      console.log(`  ${index + 1}回目: ${(time / 1000).toFixed(2)}秒`);
    });
    console.log('\n✅ レート制限エラーなし');
    return true;
  } catch (error) {
    console.error('\n❌ レート制限に到達した可能性:', error);
    return false;
  }
}

/**
 * AllTransactionSyncの軽量テスト
 */
async function testAllTransactionSync() {
  console.log('\n' + '='.repeat(60));
  console.log('テスト4: AllTransactionSync 動作確認');
  console.log('='.repeat(60));
  console.log('⚠️  このテストは直近2ヶ月のみ同期します');

  const allSync = new AllTransactionSync();
  const now = new Date();
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - 1); // 1ヶ月前

  try {
    console.log(`\n  期間: ${startDate.getFullYear()}年${startDate.getMonth() + 1}月 〜 ${now.getFullYear()}年${now.getMonth() + 1}月`);
    
    await allSync.syncRange(
      startDate.getFullYear(),
      startDate.getMonth() + 1,
      now.getFullYear(),
      now.getMonth() + 1
    );
    
    console.log('\n✅ テスト成功');
    return true;
  } catch (error) {
    console.error('\n❌ テスト失敗:', error);
    return false;
  }
}

// メイン実行
async function main() {
  console.log('\n🧪 全トランザクション同期テスト開始\n');

  const test1 = await testSyncRecent();
  
  if (test1) {
    const test2 = await testSyncSingleMonth();
    
    if (test2) {
      const test3 = await testRateLimit();
      
      if (test3) {
        const test4 = await testAllTransactionSync();
        
        if (test4) {
          console.log('\n' + '='.repeat(60));
          console.log('✅ すべてのテストが成功しました');
          console.log('='.repeat(60));
          console.log('\n次のステップ: sync_all_transactions.ts で全期間同期が可能です');
          console.log('実行コマンド例:');
          console.log('  deno task test:zaim:sync_all');
        }
      }
    }
  }
}

if (import.meta.main) {
  main().catch(console.error);
}