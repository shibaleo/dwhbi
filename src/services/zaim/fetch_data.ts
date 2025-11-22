/**
 * Zaim API データ取得オーケストレーション
 */

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { ZaimAPI } from './api.ts';
import * as log from "../../utils/log.ts";
import type {
  ZaimApiTransaction,
  ZaimData,
  FetchOptions,
} from "./types.ts";

// =============================================================================
// Main Function
// =============================================================================

export async function fetchZaimData(options: FetchOptions = {}): Promise<ZaimData> {
  const api = new ZaimAPI();

  // 1. User ID取得
  log.info("Connecting to Zaim API...");
  const userInfo = await api.verifyUser();
  const zaimUserId = userInfo.me.id;
  const maskedId = log.mask(String(zaimUserId), 2);
  log.success(`Zaim User ID: ${maskedId}`);

  // 2. マスタデータを並列取得
  log.section("Fetching Master Data");
  const [categoriesRes, genresRes, accountsRes] = await Promise.all([
    api.getCategories(),
    api.getGenres(),
    api.getAccounts(),
  ]);

  const categories = categoriesRes.categories;
  const genres = genresRes.genres;
  const accounts = accountsRes.accounts;

  log.success(`Categories: ${categories.length}`);
  log.success(`Genres: ${genres.length}`);
  log.success(`Accounts: ${accounts.length}`);

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

// =============================================================================
// Transaction Fetch (with Pagination)
// =============================================================================

async function fetchTransactions(
  api: ZaimAPI,
  options: FetchOptions
): Promise<ZaimApiTransaction[]> {
  // デフォルト: 過去30日間
  const endDate = options.endDate || new Date().toISOString().split('T')[0];
  const startDate = options.startDate || (() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  })();

  log.section("Fetching Transactions");
  log.info(`Period: ${startDate} - ${endDate}`);
  if (options.mode) {
    log.info(`Mode: ${options.mode}`);
  }

  const limit = options.limit || 100;
  const maxPages = 1000;
  const seenIds = new Set<number>();
  const allTransactions: ZaimApiTransaction[] = [];

  let page = 1;
  let hasMore = true;

  while (hasMore && page <= maxPages) {
    const params: Record<string, unknown> = {
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
      log.warn(`Duplicate page detected (page ${page}): fetch complete`);
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
      log.info(`Page ${page}: total ${allTransactions.length} records`);
    }

    // 次ページ判定
    if (transactions.length < limit) {
      hasMore = false;
    } else {
      page++;
    }
  }

  if (page > maxPages) {
    log.warn(`Max pages reached: ${maxPages}`);
  }

  log.success(`Transactions: ${allTransactions.length}`);

  return allTransactions;
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const syncDays = parseInt(Deno.env.get('ZAIM_SYNC_DAYS') || '3', 10);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - syncDays);

  log.syncStart("Zaim Fetch");

  try {
    const data = await fetchZaimData({
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    });

    log.section("Fetch Summary");
    log.info(`Zaim User ID: ${log.mask(String(data.zaimUserId), 2)}`);
    log.info(`Categories: ${data.categories.length}`);
    log.info(`Genres: ${data.genres.length}`);
    log.info(`Accounts: ${data.accounts.length}`);
    log.info(`Transactions: ${data.transactions.length}`);
    log.syncEnd(true);

    Deno.exit(0);
  } catch (err) {
    log.error(`Fetch error: ${err instanceof Error ? err.message : err}`);
    log.syncEnd(false);
    Deno.exit(1);
  }
}
