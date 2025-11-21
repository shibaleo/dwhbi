// sync_all_transactions.ts
// 全期間のトランザクションを月次分割で安全に同期
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { ZaimTransactionSync, type SyncStats } from './sync_transactions.ts';

// 同期進捗の型定義
interface SyncProgress {
  startDate: string;    // 同期開始年月 (YYYY-MM)
  endDate: string;      // 同期終了年月 (YYYY-MM)
  currentMonth: string; // 現在処理中の年月 (YYYY-MM)
  totalMonths: number;  // 総月数
  completedMonths: number; // 完了月数
  totalRecords: number; // 累積取得件数
  startedAt: string;    // 開始時刻
  estimatedEndAt?: string; // 予想終了時刻
}

// 同期設定
interface SyncConfig {
  startYear?: number;      // 開始年（指定しない場合は自動判定）
  startMonth?: number;     // 開始月（指定しない場合は自動判定）
  endYear?: number;        // 終了年（指定しない場合は今月）
  endMonth?: number;       // 終了月（指定しない場合は今月）
  delayBetweenMonths?: number; // 月間の待機時間（ミリ秒、デフォルト1000）
  resumeFrom?: string;     // 再開する年月 (YYYY-MM)
}

class AllTransactionSync {
  private sync: ZaimTransactionSync;
  private progress: SyncProgress | null = null;

  constructor() {
    this.sync = new ZaimTransactionSync();
  }

  /**
   * 開始年月を自動判定（最も古いトランザクションの年月を取得）
   */
  private async detectStartDate(): Promise<{ year: number; month: number }> {
    console.log('📅 開始年月を自動判定中...');
    
    // まず2000年1月から試す（Zaimのサービス開始は2011年）
    // 実際には、ユーザーの最古データを見つけるために数回試行する
    const testYears = [2011, 2015, 2020];
    
    for (const year of testYears) {
      try {
        const stats = await this.sync.syncMonthlyTransactions(year, 1);
        if (stats.fetched > 0) {
          console.log(`✓ ${year}年以降にデータが存在します`);
          // より正確な開始月を見つけるため、月ごとに確認
          for (let month = 1; month <= 12; month++) {
            const monthStats = await this.sync.syncMonthlyTransactions(year, month);
            if (monthStats.fetched > 0) {
              console.log(`✓ 最古のデータ: ${year}年${month}月`);
              return { year, month };
            }
            await this.delay(500); // レート制限対策
          }
        }
      } catch (error) {
        console.warn(`  ${year}年のチェック中にエラー:`, error);
      }
      
      await this.delay(1000); // レート制限対策
    }

    // デフォルト: 5年前から
    const defaultDate = new Date();
    defaultDate.setFullYear(defaultDate.getFullYear() - 5);
    console.log(`⚠️  自動判定失敗、デフォルト: ${defaultDate.getFullYear()}年1月から開始`);
    return { year: defaultDate.getFullYear(), month: 1 };
  }

  /**
   * 待機処理
   */
  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 進捗状況の表示
   */
  private displayProgress(currentStats: SyncStats): void {
    if (!this.progress) return;

    const completionRate = ((this.progress.completedMonths / this.progress.totalMonths) * 100).toFixed(1);
    const elapsedTime = Date.now() - new Date(this.progress.startedAt).getTime();
    const avgTimePerMonth = elapsedTime / Math.max(1, this.progress.completedMonths);
    const remainingMonths = this.progress.totalMonths - this.progress.completedMonths;
    const estimatedRemainingTime = avgTimePerMonth * remainingMonths;

    console.log('\n' + '─'.repeat(60));
    console.log('📊 進捗状況');
    console.log('─'.repeat(60));
    console.log(`  期間: ${this.progress.startDate} 〜 ${this.progress.endDate}`);
    console.log(`  進行: ${this.progress.completedMonths}/${this.progress.totalMonths}月 (${completionRate}%)`);
    console.log(`  現在: ${this.progress.currentMonth}`);
    console.log(`  累計: ${this.progress.totalRecords.toLocaleString()}件取得`);
    console.log(`  今月: +${currentStats.fetched}件 (挿入:${currentStats.inserted}, 更新:${currentStats.updated})`);
    
    if (this.progress.completedMonths > 0) {
      const elapsedMin = (elapsedTime / 60000).toFixed(1);
      const remainingMin = (estimatedRemainingTime / 60000).toFixed(1);
      console.log(`  経過時間: ${elapsedMin}分`);
      console.log(`  予想残り: ${remainingMin}分`);
    }
    console.log('─'.repeat(60));
  }

  /**
   * 年月の配列を生成
   */
  private generateMonthRange(
    startYear: number,
    startMonth: number,
    endYear: number,
    endMonth: number
  ): Array<{ year: number; month: number; key: string }> {
    const months: Array<{ year: number; month: number; key: string }> = [];
    
    let currentDate = new Date(startYear, startMonth - 1, 1);
    const endDate = new Date(endYear, endMonth - 1, 1);

    while (currentDate <= endDate) {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const key = `${year}-${String(month).padStart(2, '0')}`;
      
      months.push({ year, month, key });
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    return months;
  }

  /**
   * 全トランザクションを同期
   */
  async syncAll(config: SyncConfig = {}): Promise<void> {
    console.log('='.repeat(70));
    console.log('🚀 全トランザクション同期開始');
    console.log('='.repeat(70));

    const startTime = Date.now();
    const delayMs = config.delayBetweenMonths || 1000;

    try {
      // 終了年月の設定（デフォルト: 今月）
      const now = new Date();
      const endYear = config.endYear || now.getFullYear();
      const endMonth = config.endMonth || (now.getMonth() + 1);

      // 開始年月の設定
      let startYear: number;
      let startMonth: number;

      if (config.startYear && config.startMonth) {
        startYear = config.startYear;
        startMonth = config.startMonth;
        console.log(`📅 指定された開始日: ${startYear}年${startMonth}月`);
      } else {
        const detected = await this.detectStartDate();
        startYear = detected.year;
        startMonth = detected.month;
      }

      // 再開ポイントの確認
      if (config.resumeFrom) {
        const [year, month] = config.resumeFrom.split('-').map(Number);
        startYear = year;
        startMonth = month;
        console.log(`🔄 再開: ${config.resumeFrom}から同期を再開します`);
      }

      // 月次リストの生成
      const months = this.generateMonthRange(startYear, startMonth, endYear, endMonth);
      
      console.log(`\n📆 同期対象: ${months.length}ヶ月分`);
      console.log(`   開始: ${months[0].key}`);
      console.log(`   終了: ${months[months.length - 1].key}`);
      console.log(`   待機時間: ${delayMs}ms/月\n`);

      // プログレス初期化
      this.progress = {
        startDate: months[0].key,
        endDate: months[months.length - 1].key,
        currentMonth: months[0].key,
        totalMonths: months.length,
        completedMonths: 0,
        totalRecords: 0,
        startedAt: new Date().toISOString(),
      };

      // 月次で順次同期
      for (let i = 0; i < months.length; i++) {
        const { year, month, key } = months[i];
        
        this.progress.currentMonth = key;
        
        console.log(`\n[${i + 1}/${months.length}] ${year}年${month}月を同期中...`);
        
        try {
          const stats = await this.sync.syncMonthlyTransactions(year, month);
          
          this.progress.completedMonths++;
          this.progress.totalRecords += stats.fetched;
          
          // 進捗表示
          this.displayProgress(stats);
          
          // レート制限対策: 月間の待機
          if (i < months.length - 1) {
            console.log(`⏳ 待機中... (${delayMs}ms)`);
            await this.delay(delayMs);
          }
          
        } catch (error) {
          console.error(`❌ ${year}年${month}月の同期エラー:`, error);
          console.log(`⏸️  エラーが発生しました。再開する場合は resumeFrom: "${key}" を指定してください`);
          throw error;
        }
      }

      // 完了サマリー
      const totalTime = Date.now() - startTime;
      const totalMinutes = (totalTime / 60000).toFixed(2);
      
      console.log('\n' + '='.repeat(70));
      console.log('✅ 全トランザクション同期完了');
      console.log('='.repeat(70));
      console.log(`  対象期間: ${this.progress.startDate} 〜 ${this.progress.endDate}`);
      console.log(`  処理月数: ${this.progress.totalMonths}ヶ月`);
      console.log(`  総取得件数: ${this.progress.totalRecords.toLocaleString()}件`);
      console.log(`  実行時間: ${totalMinutes}分`);
      console.log(`  平均速度: ${(this.progress.totalRecords / parseFloat(totalMinutes) * 60).toFixed(0)}件/分`);
      console.log('='.repeat(70));

    } catch (error) {
      console.error('\n❌ 同期処理が中断されました:', error);
      throw error;
    }
  }

  /**
   * 特定期間の同期（カスタム範囲）
   */
  async syncRange(startYear: number, startMonth: number, endYear: number, endMonth: number): Promise<void> {
    await this.syncAll({
      startYear,
      startMonth,
      endYear,
      endMonth,
    });
  }

  /**
   * 直近N年間の同期
   */
  async syncRecentYears(years: number): Promise<void> {
    const now = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);

    await this.syncAll({
      startYear: startDate.getFullYear(),
      startMonth: startDate.getMonth() + 1,
      endYear: now.getFullYear(),
      endMonth: now.getMonth() + 1,
    });
  }
}

// メイン実行
async function main() {
  const allSync = new AllTransactionSync();
  
  // デフォルト: 全期間同期（自動判定）
  await allSync.syncAll();
  
  // カスタム例:
  // await allSync.syncAll({ startYear: 2020, startMonth: 1 }); // 2020年1月から
  // await allSync.syncRecentYears(3); // 直近3年間
  // await allSync.syncAll({ resumeFrom: '2022-06' }); // 2022年6月から再開
}

if (import.meta.main) {
  main().catch(error => {
    console.error('致命的エラー:', error);
    Deno.exit(1);
  });
}

export { AllTransactionSync };