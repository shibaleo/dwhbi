// sync_daily.ts
// Zaim データを Supabase に日次同期するオーケストレーター

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { fetchZaimData, type FetchOptions } from './fetch_data.ts';
import {
  createZaimClient,
  startSyncLog,
  completeSyncLog,
  syncMasters,
  syncTransactions,
  getExistingTransactionIds,
  type SyncStatus,
} from './write_db.ts';

// ============================================================
// 型定義
// ============================================================

interface SyncStats {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
}

interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: {
    categories: number;
    genres: number;
    accounts: number;
    transactions: SyncStats;
  };
  errors: string[];
  elapsedSeconds: number;
}

// ============================================================
// 定数
// ============================================================

const DEFAULT_SYNC_DAYS = 3;

// ============================================================
// メイン同期処理
// ============================================================

/**
 * 日数指定でZaimデータを同期（他サービスとの統一インターフェース）
 * @param syncDays 同期する日数（デフォルト: 3）
 */
export async function syncZaimByDays(syncDays?: number): Promise<SyncResult> {
  const days = syncDays ??
    parseInt(Deno.env.get('ZAIM_SYNC_DAYS') || String(DEFAULT_SYNC_DAYS), 10);

  // 日付範囲: days日前から今日までを取得
  // endDate = 明日（APIは排他的終点のため、今日を含めるには明日を指定）
  // startDate = endDate - (days + 1)
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 1);

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days - 1);

  return syncZaimData({
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  });
}

/**
 * Zaimデータを同期（内部実装）
 */
export async function syncZaimData(options: FetchOptions = {}): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    success: true,
    timestamp: new Date().toISOString(),
    stats: {
      categories: 0,
      genres: 0,
      accounts: 0,
      transactions: { fetched: 0, inserted: 0, updated: 0, skipped: 0 },
    },
    errors: [],
    elapsedSeconds: 0,
  };

  const zaim = createZaimClient();
  let logId: string | null = null;

  try {
    // ============================================================
    // Step 1: Zaim APIからデータ取得
    // ============================================================
    console.log('🚀 Zaim日次同期開始');
    console.log('='.repeat(60));

    const data = await fetchZaimData(options);
    logId = await startSyncLog(zaim, data.zaimUserId, '/v2/home/*');

    // ============================================================
    // Step 2: 既存データの確認（transactions用）
    // ============================================================
    console.log('\n🔍 既存トランザクションを確認中...');

    const startDate = options.startDate || (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toISOString().split('T')[0];
    })();
    const endDate = options.endDate || new Date().toISOString().split('T')[0];

    const existingIds = await getExistingTransactionIds(zaim, data.zaimUserId, startDate, endDate);
    console.log(`✓ 既存データ: ${existingIds.size}件`);

    // ============================================================
    // Step 3: マスタデータ同期
    // ============================================================
    console.log('\n💾 マスタデータを同期中...');

    const masterResult = await syncMasters(
      zaim,
      data.zaimUserId,
      data.categories,
      data.genres,
      data.accounts
    );

    result.stats.categories = masterResult.categories;
    result.stats.genres = masterResult.genres;
    result.stats.accounts = masterResult.accounts;

    console.log(`  ✓ カテゴリ: ${masterResult.categories}件`);
    console.log(`  ✓ ジャンル: ${masterResult.genres}件`);
    console.log(`  ✓ 口座: ${masterResult.accounts}件`);

    // ============================================================
    // Step 4: トランザクション同期
    // ============================================================
    console.log('\n💾 トランザクションを同期中...');

    const txResult = await syncTransactions(
      zaim,
      data.zaimUserId,
      data.transactions,
      existingIds
    );

    result.stats.transactions = {
      fetched: txResult.fetched,
      inserted: txResult.inserted,
      updated: txResult.updated,
      skipped: txResult.skipped,
    };

    if (txResult.failed > 0) {
      result.errors.push(`トランザクション ${txResult.failed}件の保存に失敗`);
    }

    console.log(`  ✓ トランザクション: ${txResult.fetched - txResult.skipped}件（挿入: ${txResult.inserted}, 更新: ${txResult.updated}, スキップ: ${txResult.skipped}）`);

    // ============================================================
    // Step 5: 完了
    // ============================================================
    await completeSyncLog(zaim, logId, 'completed', {
      fetched: txResult.fetched,
      inserted: txResult.inserted,
      updated: txResult.updated,
    });

  } catch (error) {
    result.success = false;
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMessage);

    if (logId) {
      await completeSyncLog(zaim, logId, 'failed', {
        fetched: result.stats.transactions.fetched,
        inserted: result.stats.transactions.inserted,
        updated: result.stats.transactions.updated,
      }, errorMessage);
    }

    throw error;
  }

  result.elapsedSeconds = (Date.now() - startTime) / 1000;
  return result;
}

// ============================================================
// サマリー表示
// ============================================================

function displaySummary(result: SyncResult): void {
  console.log('\n' + '='.repeat(60));
  console.log('📊 日次同期結果サマリー');
  console.log('='.repeat(60));
  console.log(`実行時刻: ${new Date(result.timestamp).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  console.log(`ステータス: ${result.success ? '✅ 成功' : '❌ 失敗'}`);
  console.log(`実行時間: ${result.elapsedSeconds.toFixed(2)}秒`);
  console.log(`スキーマ: zaim`);

  console.log('\nマスタデータ:');
  console.log(`  カテゴリ: ${result.stats.categories}件`);
  console.log(`  ジャンル: ${result.stats.genres}件`);
  console.log(`  口座: ${result.stats.accounts}件`);

  console.log('\nトランザクション:');
  console.log(`  取得: ${result.stats.transactions.fetched}件`);
  console.log(`  挿入: ${result.stats.transactions.inserted}件`);
  console.log(`  更新: ${result.stats.transactions.updated}件`);
  console.log(`  スキップ: ${result.stats.transactions.skipped}件`);

  if (result.errors.length > 0) {
    console.log('\n⚠️ エラー:');
    result.errors.forEach(e => console.log(`  - ${e}`));
  }

  console.log('='.repeat(60));
}

// ============================================================
// CLI実行
// ============================================================

if (import.meta.main) {
  console.log(`開始時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

  try {
    const result = await syncZaimByDays();
    displaySummary(result);
    Deno.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('\n❌ 日次同期が失敗しました');
    console.error(error);
    Deno.exit(1);
  }
}
