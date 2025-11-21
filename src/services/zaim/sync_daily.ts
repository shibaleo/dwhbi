// sync_daily.ts
// 日次でZaimデータを同期するスクリプト
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { ZaimMasterSync } from './sync_masters.ts';
import { ZaimTransactionSync } from './sync_transactions.ts';

interface DailySyncResult {
  success: boolean;
  timestamp: string;
  masters: {
    categories: number;
    genres: number;
    accounts: number;
  };
  transactions: {
    fetched: number;
    inserted: number;
    updated: number;
  };
  errors: string[];
}

class ZaimDailySync {
  private masterSync: ZaimMasterSync;
  private transactionSync: ZaimTransactionSync;
  private result: DailySyncResult;

  constructor() {
    this.masterSync = new ZaimMasterSync();
    this.transactionSync = new ZaimTransactionSync();
    this.result = {
      success: true,
      timestamp: new Date().toISOString(),
      masters: {
        categories: 0,
        genres: 0,
        accounts: 0,
      },
      transactions: {
        fetched: 0,
        inserted: 0,
        updated: 0,
      },
      errors: [],
    };
  }

  /**
   * マスタデータの同期（カテゴリ、ジャンル、口座）
   */
  private async syncMasters(): Promise<void> {
    console.log('📚 マスタデータ同期開始');
    console.log('─'.repeat(60));

    try {
      // カテゴリ
      const categoryStats = await this.masterSync.syncCategories();
      this.result.masters.categories = categoryStats.inserted + categoryStats.updated;
      
      // ジャンル
      const genreStats = await this.masterSync.syncGenres();
      this.result.masters.genres = genreStats.inserted + genreStats.updated;
      
      // 口座
      const accountStats = await this.masterSync.syncAccounts();
      this.result.masters.accounts = accountStats.inserted + accountStats.updated;
      
      console.log('✅ マスタデータ同期完了');
      console.log(`   カテゴリ: ${this.result.masters.categories}件`);
      console.log(`   ジャンル: ${this.result.masters.genres}件`);
      console.log(`   口座: ${this.result.masters.accounts}件`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.result.errors.push(`マスタ同期エラー: ${errorMessage}`);
      console.error('❌ マスタデータ同期エラー:', errorMessage);
      // マスタ同期失敗でも続行
    }
  }

  /**
   * トランザクションデータの同期（直近N日間）
   */
  private async syncTransactions(days: number = 3): Promise<void> {
    console.log(`\n💰 トランザクションデータ同期開始（直近${days}日間）`);
    console.log('─'.repeat(60));

    try {
      const stats = await this.transactionSync.syncRecentTransactions(days);
      
      this.result.transactions = {
        fetched: stats.fetched,
        inserted: stats.inserted,
        updated: stats.updated,
      };
      
      console.log('✅ トランザクションデータ同期完了');
      console.log(`   取得: ${stats.fetched}件`);
      console.log(`   挿入: ${stats.inserted}件`);
      console.log(`   更新: ${stats.updated}件`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.result.errors.push(`トランザクション同期エラー: ${errorMessage}`);
      this.result.success = false;
      console.error('❌ トランザクションデータ同期エラー:', errorMessage);
      throw error; // トランザクション同期は必須なので例外を投げる
    }
  }

  /**
   * 結果サマリーの表示
   */
  private displaySummary(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 日次同期結果サマリー');
    console.log('='.repeat(60));
    console.log(`実行時刻: ${new Date(this.result.timestamp).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    console.log(`ステータス: ${this.result.success ? '✅ 成功' : '❌ 失敗'}`);
    
    console.log('\nマスタデータ:');
    console.log(`  カテゴリ: ${this.result.masters.categories}件`);
    console.log(`  ジャンル: ${this.result.masters.genres}件`);
    console.log(`  口座: ${this.result.masters.accounts}件`);
    
    console.log('\nトランザクションデータ:');
    console.log(`  取得: ${this.result.transactions.fetched}件`);
    console.log(`  挿入: ${this.result.transactions.inserted}件`);
    console.log(`  更新: ${this.result.transactions.updated}件`);
    
    if (this.result.errors.length > 0) {
      console.log('\n⚠️  エラー:');
      this.result.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    console.log('='.repeat(60));
  }

  /**
   * 日次同期の実行
   */
  async run(days: number = 3): Promise<DailySyncResult> {
    const startTime = Date.now();
    
    console.log('🚀 Zaim日次同期開始');
    console.log('='.repeat(60));
    console.log(`対象期間: 直近${days}日間`);
    console.log(`開始時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    console.log('='.repeat(60) + '\n');

    try {
      // 1. マスタデータ同期
      await this.syncMasters();
      
      // 2. トランザクションデータ同期
      await this.syncTransactions(days);
      
      // 3. 結果表示
      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\n⏱️  実行時間: ${elapsedTime}秒`);
      this.displaySummary();
      
      return this.result;
      
    } catch (error) {
      this.result.success = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (!this.result.errors.some(e => e.includes(errorMessage))) {
        this.result.errors.push(`致命的エラー: ${errorMessage}`);
      }
      
      this.displaySummary();
      throw error;
    }
  }
}

// メイン実行
async function main() {
  const dailySync = new ZaimDailySync();
  
  // 環境変数から同期日数を取得（デフォルト: 3日）
  const syncDays = parseInt(Deno.env.get('ZAIM_SYNC_DAYS') || '3', 10);
  
  try {
    const result = await dailySync.run(syncDays);
    
    if (result.success) {
      console.log('\n✅ 日次同期が正常に完了しました');
      Deno.exit(0);
    } else {
      console.error('\n⚠️  同期は完了しましたが、一部エラーがありました');
      Deno.exit(1);
    }
  } catch (error) {
    console.error('\n❌ 日次同期が失敗しました');
    console.error(error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}

export { ZaimDailySync };
export type { DailySyncResult };