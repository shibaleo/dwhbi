// fetch_data.ts
// Zaim APIからデータを取得する責務に特化

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { ZaimAPI } from './api.ts';
import type {
  ZaimTransaction,
  ZaimCategory,
  ZaimGenre,
  ZaimAccount
} from "./types.ts";

// ============================================================
// 型定義
// ============================================================

export interface ZaimData {
  zaimUserId: number;
  categories: ZaimCategory[];
  genres: ZaimGenre[];
  accounts: ZaimAccount[];
  transactions: ZaimTransaction[];
}

export interface FetchOptions {
  startDate?: string;  // YYYY-MM-DD
  endDate?: string;    // YYYY-MM-DD
  mode?: 'payment' | 'income' | 'transfer';
  limit?: number;      // 1回のAPI取得件数（デフォルト100）
}

// ============================================================
// メイン関数
// ============================================================

export async function fetchZaimData(options: FetchOptions = {}): Promise<ZaimData> {
  const api = new ZaimAPI();

  // 1. User ID取得
  console.log('📡 Zaim APIに接続中...');
  const userInfo = await api.verifyUser();
  const zaimUserId = userInfo.me.id;
  const maskedId = `******${String(zaimUserId).slice(-2)}`;
  console.log(`✓ Zaim User ID: ${maskedId}`);

  // 2. マスタデータを並列取得
  console.log('\n📚 マスタデータを取得中...');
  const [categoriesRes, genresRes, accountsRes] = await Promise.all([
    api.getCategories(),
    api.getGenres(),
    api.getAccounts(),
  ]);

  const categories = categoriesRes.categories;
  const genres = genresRes.genres;
  const accounts = accountsRes.accounts;

  console.log(`✓ カテゴリ: ${categories.length}件`);
  console.log(`✓ ジャンル: ${genres.length}件`);
  console.log(`✓ 口座: ${accounts.length}件`);

  // 3. トランザクション取得（ページネーション）
  const transactions = await fetchTransactions(api, options);

  return {
    zaimUserId,
    categories,
    genres,
    accounts,
    transactions,
  };
}

// ============================================================
// トランザクション取得（ページネーション対応）
// ============================================================

async function fetchTransactions(
  api: ZaimAPI,
  options: FetchOptions
): Promise<ZaimTransaction[]> {
  // デフォルト: 過去30日間
  const endDate = options.endDate || new Date().toISOString().split('T')[0];
  const startDate = options.startDate || (() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  })();

  console.log(`\n💰 トランザクションを取得中...`);
  console.log(`   期間: ${startDate} 〜 ${endDate}`);
  if (options.mode) {
    console.log(`   種別: ${options.mode}`);
  }

  const limit = options.limit || 100;
  const maxPages = 1000;
  const seenIds = new Set<number>();
  const allTransactions: ZaimTransaction[] = [];

  let page = 1;
  let hasMore = true;

  while (hasMore && page <= maxPages) {
    const params: any = {
      start_date: startDate,
      end_date: endDate,
      page,
      limit,
    };

    if (options.mode) {
      params.mode = options.mode;
    }

    const { money: transactions } = await api.getMoney(params);

    if (!transactions || transactions.length === 0) {
      hasMore = false;
      break;
    }

    // 重複ページ検出
    const pageIds = transactions.map(t => t.id);
    const isDuplicate = pageIds.every(id => seenIds.has(id));

    if (isDuplicate && page > 1) {
      console.log(`   ⚠️ 重複ページ検出（ページ ${page}）: 取得完了`);
      hasMore = false;
      break;
    }

    // 記録
    transactions.forEach(t => {
      if (!seenIds.has(t.id)) {
        seenIds.add(t.id);
        allTransactions.push(t);
      }
    });

    // 進捗表示（10ページごと）
    if (page % 10 === 0) {
      console.log(`   ページ ${page}: 累計 ${allTransactions.length}件`);
    }

    // 次ページ判定
    if (transactions.length < limit) {
      hasMore = false;
    } else {
      page++;
    }
  }

  if (page > maxPages) {
    console.warn(`   ⚠️ 最大ページ数 ${maxPages} に到達`);
  }

  console.log(`✓ トランザクション: ${allTransactions.length}件`);

  return allTransactions;
}

// ============================================================
// CLI実行用
// ============================================================

if (import.meta.main) {
  const syncDays = parseInt(Deno.env.get('ZAIM_SYNC_DAYS') || '3', 10);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - syncDays);

  console.log('🚀 Zaim データ取得開始');
  console.log('='.repeat(60));

  try {
    const data = await fetchZaimData({
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    });

    console.log('\n' + '='.repeat(60));
    console.log('📊 取得結果サマリー');
    console.log('='.repeat(60));
    console.log(`Zaim User ID: ******${String(data.zaimUserId).slice(-2)}`);
    console.log(`カテゴリ: ${data.categories.length}件`);
    console.log(`ジャンル: ${data.genres.length}件`);
    console.log(`口座: ${data.accounts.length}件`);
    console.log(`トランザクション: ${data.transactions.length}件`);
    console.log('='.repeat(60));

    Deno.exit(0);
  } catch (error) {
    console.error('❌ データ取得エラー:', error);
    Deno.exit(1);
  }
}
