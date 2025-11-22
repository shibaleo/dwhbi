// sync_all_transactions.ts
// 全期間のトランザクションを年次分割で同期
// fetch_data.ts + write_db.ts を使用、年単位チャンク方式

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { fetchZaimData } from './fetch_data.ts';
import {
  createZaimClient,
  syncMasters,
  syncTransactions,
  getExistingTransactionIds,
  type ZaimSchema,
} from './write_db.ts';

// ============================================================
// 型定義
// ============================================================

interface SyncConfig {
  startYear?: number;       // 開始年（デフォルト: 2025）
  startMonth?: number;      // 開始月（デフォルト: 3）
  endYear?: number;         // 終了年（デフォルト: 今年）
  endMonth?: number;        // 終了月（デフォルト: 今月）
  delayBetweenYears?: number;  // 年間の待機時間（デフォルト: 200ms）
  resumeFrom?: number;      // 再開する年
}

interface YearProgress {
  year: number;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
}

interface SyncProgress {
  startYear: number;
  endYear: number;
  currentYear: number;
  totalYears: number;
  completedYears: number;
  totalRecords: number;
  totalInserted: number;
  totalUpdated: number;
  totalSkipped: number;
  startedAt: number;
  yearHistory: YearProgress[];
}

// ============================================================
// ユーティリティ
// ============================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getYearDateRange(
  year: number,
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): { startDate: string; endDate: string } {
  // 開始年の場合は指定月から
  const sMonth = (year === startYear) ? startMonth : 1;
  const startDate = `${year}-${String(sMonth).padStart(2, '0')}-01`;

  // 終了年の場合は指定月まで
  let eMonth: number;
  let eDay: number;
  if (year === endYear) {
    eMonth = endMonth;
    eDay = new Date(year, eMonth, 0).getDate(); // 月末日
  } else {
    eMonth = 12;
    eDay = 31;
  }
  const endDate = `${year}-${String(eMonth).padStart(2, '0')}-${String(eDay).padStart(2, '0')}`;

  return { startDate, endDate };
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}時間${minutes % 60}分`;
  } else if (minutes > 0) {
    return `${minutes}分${seconds % 60}秒`;
  }
  return `${seconds}秒`;
}

// ============================================================
// 進捗表示
// ============================================================

function displayProgress(progress: SyncProgress, currentYear: YearProgress): void {
  const completionRate = ((progress.completedYears / progress.totalYears) * 100).toFixed(1);
  const elapsed = Date.now() - progress.startedAt;
  const avgTimePerYear = elapsed / Math.max(1, progress.completedYears);
  const remaining = avgTimePerYear * (progress.totalYears - progress.completedYears);

  console.log('─'.repeat(60));
  console.log(`📊 進捗: ${progress.completedYears}/${progress.totalYears}年 (${completionRate}%)`);
  console.log(`   ${currentYear.year}年 → ${currentYear.fetched}件（挿入:${currentYear.inserted}, 更新:${currentYear.updated}, スキップ:${currentYear.skipped}）`);
  console.log(`   累計: ${progress.totalRecords.toLocaleString()}件`);
  console.log(`   経過: ${formatTime(elapsed)} / 残り予測: ${formatTime(remaining)}`);
  console.log('─'.repeat(60));
}

// ============================================================
// メイン同期処理
// ============================================================

export async function syncAllTransactions(config: SyncConfig = {}): Promise<void> {
  console.log('='.repeat(70));
  console.log('🚀 全トランザクション同期開始（年単位チャンク方式）');
  console.log('='.repeat(70));

  const zaim = createZaimClient();
  const delayMs = config.delayBetweenYears || 200;

  // 終了年月（デフォルト: 今月）
  const now = new Date();
  const endYear = config.endYear || now.getFullYear();
  const endMonth = config.endMonth || (now.getMonth() + 1);

  // 開始年月（デフォルト: 2025年3月）
  let startYear = config.startYear || 2025;
  let startMonth = config.startMonth || 3;

  // resumeFrom が指定されている場合
  if (config.resumeFrom) {
    startYear = config.resumeFrom;
    startMonth = 1; // 再開時は年の最初から
    console.log(`🔄 再開: ${config.resumeFrom}年から同期を再開`);
  }

  // 年リスト生成
  const years: number[] = [];
  for (let y = startYear; y <= endYear; y++) {
    years.push(y);
  }

  console.log(`\n📆 同期対象: ${years.length}年分`);
  console.log(`   開始: ${startYear}年${startMonth}月`);
  console.log(`   終了: ${endYear}年${endMonth}月`);
  console.log(`   待機時間: ${delayMs}ms/年\n`);

  // プログレス初期化
  const progress: SyncProgress = {
    startYear,
    endYear,
    currentYear: startYear,
    totalYears: years.length,
    completedYears: 0,
    totalRecords: 0,
    totalInserted: 0,
    totalUpdated: 0,
    totalSkipped: 0,
    startedAt: Date.now(),
    yearHistory: [],
  };

  // マスタデータは最初の1回だけ同期
  let zaimUserId: number | null = null;
  let mastersSynced = false;

  // 年次で順次同期
  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    progress.currentYear = year;

    console.log(`\n[${i + 1}/${years.length}] ${year}年を同期中...`);

    try {
      const { startDate, endDate } = getYearDateRange(year, startYear, startMonth, endYear, endMonth);
      console.log(`   期間: ${startDate} 〜 ${endDate}`);

      // データ取得
      const data = await fetchZaimData({ startDate, endDate });
      zaimUserId = data.zaimUserId;

      // 最初の年でマスタデータを同期
      if (!mastersSynced) {
        console.log('  📚 マスタデータを同期中...');

        const masterResult = await syncMasters(
          zaim,
          zaimUserId,
          data.categories,
          data.genres,
          data.accounts
        );

        console.log(`  ✓ マスタ同期完了（カテゴリ:${masterResult.categories}, ジャンル:${masterResult.genres}, 口座:${masterResult.accounts}）`);
        mastersSynced = true;
      }

      // 既存トランザクション確認
      const existingIds = await getExistingTransactionIds(zaim, zaimUserId, startDate, endDate);

      // トランザクション同期
      const txResult = await syncTransactions(
        zaim,
        zaimUserId,
        data.transactions,
        existingIds
      );

      // 年次進捗記録
      const yearProgress: YearProgress = {
        year,
        fetched: txResult.fetched,
        inserted: txResult.inserted,
        updated: txResult.updated,
        skipped: txResult.skipped,
      };

      progress.completedYears++;
      progress.totalRecords += txResult.fetched;
      progress.totalInserted += txResult.inserted;
      progress.totalUpdated += txResult.updated;
      progress.totalSkipped += txResult.skipped;
      progress.yearHistory.push(yearProgress);

      displayProgress(progress, yearProgress);

      // 次年への待機
      if (i < years.length - 1) {
        await delay(delayMs);
      }

    } catch (error) {
      console.error(`❌ ${year}年の同期エラー:`, error);
      console.log(`\n⏸️  再開する場合: --resume=${year}`);
      throw error;
    }
  }

  // 完了サマリー
  const totalTime = Date.now() - progress.startedAt;

  console.log('\n' + '='.repeat(70));
  console.log('✅ 全トランザクション同期完了');
  console.log('='.repeat(70));
  console.log(`  対象期間: ${progress.startYear}年 〜 ${progress.endYear}年`);
  console.log(`  処理年数: ${progress.totalYears}年`);
  console.log(`  総取得件数: ${progress.totalRecords.toLocaleString()}件`);
  console.log(`  挿入: ${progress.totalInserted.toLocaleString()}件`);
  console.log(`  更新: ${progress.totalUpdated.toLocaleString()}件`);
  console.log(`  スキップ: ${progress.totalSkipped.toLocaleString()}件`);
  console.log(`  実行時間: ${formatTime(totalTime)}`);
  console.log('='.repeat(70));
}

// ============================================================
// 便利関数
// ============================================================

export async function syncFromYear(year: number): Promise<void> {
  await syncAllTransactions({ startYear: year, startMonth: 1 });
}

export async function syncRange(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): Promise<void> {
  await syncAllTransactions({ startYear, startMonth, endYear, endMonth });
}

// ============================================================
// CLI実行
// ============================================================

if (import.meta.main) {
  const args = Deno.args;

  let config: SyncConfig = {};

  // --resume=YYYY オプション
  const resumeArg = args.find(a => a.startsWith('--resume='));
  if (resumeArg) {
    config.resumeFrom = parseInt(resumeArg.split('=')[1], 10);
  }

  // --delay=MS オプション
  const delayArg = args.find(a => a.startsWith('--delay='));
  if (delayArg) {
    config.delayBetweenYears = parseInt(delayArg.split('=')[1], 10);
  }

  // --start=YYYY オプション
  const startArg = args.find(a => a.startsWith('--start='));
  if (startArg) {
    config.startYear = parseInt(startArg.split('=')[1], 10);
  }

  // --start-month=MM オプション
  const startMonthArg = args.find(a => a.startsWith('--start-month='));
  if (startMonthArg) {
    config.startMonth = parseInt(startMonthArg.split('=')[1], 10);
  }

  // --end=YYYY オプション
  const endArg = args.find(a => a.startsWith('--end='));
  if (endArg) {
    config.endYear = parseInt(endArg.split('=')[1], 10);
  }

  // --end-month=MM オプション
  const endMonthArg = args.find(a => a.startsWith('--end-month='));
  if (endMonthArg) {
    config.endMonth = parseInt(endMonthArg.split('=')[1], 10);
  }

  // ヘルプ
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Zaim 全トランザクション同期スクリプト（年単位チャンク方式）

使用法:
  deno run --allow-env --allow-net --allow-read sync_all_transactions.ts [オプション]

オプション:
  --start=YYYY       開始年を指定（デフォルト: 2025）
  --start-month=MM   開始月を指定（デフォルト: 3）
  --end=YYYY         終了年を指定（デフォルト: 今年）
  --end-month=MM     終了月を指定（デフォルト: 今月）
  --resume=YYYY      指定した年から再開
  --delay=MS         年間の待機時間（デフォルト: 200ms）
  --help, -h         このヘルプを表示

例:
  # デフォルト（2025年3月〜今月）
  deno run ... sync_all_transactions.ts

  # 2020年から今月まで
  deno run ... sync_all_transactions.ts --start=2020

  # 2023年から再開
  deno run ... sync_all_transactions.ts --resume=2023

  # 特定期間
  deno run ... sync_all_transactions.ts --start=2022 --start-month=6 --end=2024 --end-month=12
`);
    Deno.exit(0);
  }

  try {
    await syncAllTransactions(config);
    console.log('\n✅ 同期が正常に完了しました');
    Deno.exit(0);
  } catch (error) {
    console.error('\n❌ 同期が失敗しました');
    console.error(error);
    Deno.exit(1);
  }
}
