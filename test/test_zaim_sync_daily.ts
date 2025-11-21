// test_daily_sync.ts
// sync_daily.tsの動作確認用テストスクリプト
import { ZaimDailySync } from "../src/services/zaim/sync_daily.ts";

async function testDailySync() {
  console.log('🧪 日次同期テスト開始\n');
  
  try {
    const dailySync = new ZaimDailySync();
    
    // 直近1日間でテスト（データ量を抑える）
    console.log('⚠️  このテストは直近1日間のデータのみ同期します\n');
    
    const result = await dailySync.run(1);
    
    // 結果の検証
    console.log('\n📋 テスト結果の検証:');
    
    const checks = [
      {
        name: 'ステータス',
        passed: result.success,
        detail: result.success ? '✅ 成功' : '❌ 失敗'
      },
      {
        name: 'マスタデータ同期',
        passed: result.masters.categories > 0 || result.masters.genres > 0,
        detail: `カテゴリ:${result.masters.categories}, ジャンル:${result.masters.genres}, 口座:${result.masters.accounts}`
      },
      {
        name: 'トランザクション取得',
        passed: result.transactions.fetched >= 0,
        detail: `${result.transactions.fetched}件取得`
      },
      {
        name: 'エラーなし',
        passed: result.errors.length === 0,
        detail: result.errors.length === 0 ? 'エラーなし' : `${result.errors.length}件のエラー`
      }
    ];
    
    console.log('─'.repeat(60));
    checks.forEach(check => {
      const status = check.passed ? '✅' : '❌';
      console.log(`${status} ${check.name}: ${check.detail}`);
    });
    console.log('─'.repeat(60));
    
    const allPassed = checks.every(c => c.passed);
    
    if (allPassed) {
      console.log('\n✅ すべてのテストが成功しました');
      console.log('\n次のステップ:');
      console.log('1. GitHub Secrets の設定');
      console.log('2. .github/workflows/zaim_daily_sync.yml の配置');
      console.log('3. GitHub Actionsで手動実行テスト');
      return true;
    } else {
      console.log('\n⚠️  一部のテストが失敗しました');
      if (result.errors.length > 0) {
        console.log('\nエラー詳細:');
        result.errors.forEach(error => console.log(`  - ${error}`));
      }
      return false;
    }
    
  } catch (error) {
    console.error('\n❌ テスト実行エラー:', error);
    return false;
  }
}

// メイン実行
if (import.meta.main) {
  const success = await testDailySync();
  Deno.exit(success ? 0 : 1);
}