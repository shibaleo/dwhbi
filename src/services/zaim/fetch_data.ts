/**
 * Zaim API データ取得オーケストレーション
 *
 * 責務:
 * - API制約（レート制限）の吸収
 * - 長期間リクエストの自動チャンク分割（12ヶ月単位）
 * - 進捗報告（コールバック経由）
 */

import "jsr:@std/dotenv/load";
import { ZaimAPI } from "./api.ts";
import * as log from "../../utils/log.ts";
import type {
  ZaimApiTransaction,
  ZaimApiCategory,
  ZaimApiGenre,
  ZaimApiAccount,
  ZaimData,
  FetchOptions,
} from "./types.ts";
import { ZaimRateLimitError } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

/** チャンクサイズ（12ヶ月単位） */
const CHUNK_MONTHS = 12;

/** ページあたりの最大取得件数 */
const DEFAULT_LIMIT = 100;

/** 最大ページ数（無限ループ防止） */
const MAX_PAGES = 1000;

// =============================================================================
// Types
// =============================================================================

/** メタデータのみ取得結果 */
export interface ZaimMetadata {
  zaimUserId: number;
  categories: ZaimApiCategory[];
  genres: ZaimApiGenre[];
  accounts: ZaimApiAccount[];
}

/** 進捗コールバック */
export type ProgressCallback = (progress: {
  chunkIndex: number;
  totalChunks: number;
  chunkStart: string;
  chunkEnd: string;
  transactionsFetched: number;
}) => void;

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * 年単位の日付範囲を取得
 */
function getYearDateRange(
  year: number,
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): { startDate: string; endDate: string } {
  const sMonth = year === startYear ? startMonth : 1;
  const startDate = `${year}-${String(sMonth).padStart(2, "0")}-01`;

  let eMonth: number;
  let eDay: number;
  if (year === endYear) {
    eMonth = endMonth;
    eDay = new Date(year, eMonth, 0).getDate();
  } else {
    eMonth = 12;
    eDay = 31;
  }
  const endDate = `${year}-${String(eMonth).padStart(2, "0")}-${String(eDay).padStart(2, "0")}`;

  return { startDate, endDate };
}

/**
 * 年リストを生成
 */
function generateYearList(startYear: number, endYear: number): number[] {
  const years: number[] = [];
  for (let y = startYear; y <= endYear; y++) {
    years.push(y);
  }
  return years;
}

// =============================================================================
// Metadata Fetch
// =============================================================================

/** verifyUser レスポンス型 */
interface VerifyUserResponse {
  me: {
    id: number;
    login: string;
    name: string;
  };
}

/**
 * メタデータのみ取得（categories, genres, accounts）
 */
export async function fetchZaimMetadata(): Promise<ZaimMetadata> {
  const api = new ZaimAPI();

  // User ID取得
  log.info("Connecting to Zaim API...");
  const userInfo = await api.verifyUser() as VerifyUserResponse;
  const zaimUserId = userInfo.me.id;
  const maskedId = log.mask(String(zaimUserId), 2);
  log.success(`Zaim User ID: ${maskedId}`);

  // マスタデータを並列取得
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

  return {
    zaimUserId,
    categories,
    genres,
    accounts,
  };
}

// =============================================================================
// Transaction Fetch (with Pagination)
// =============================================================================

async function fetchTransactionsForPeriod(
  api: ZaimAPI,
  startDate: string,
  endDate: string,
  options: FetchOptions = {}
): Promise<ZaimApiTransaction[]> {
  const limit = options.limit || DEFAULT_LIMIT;
  const seenIds = new Set<number>();
  const allTransactions: ZaimApiTransaction[] = [];

  let page = 1;
  let hasMore = true;

  while (hasMore && page <= MAX_PAGES) {
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
    const pageIds = transactions.map((t) => t.id);
    const isDuplicate = pageIds.every((id) => seenIds.has(id));

    if (isDuplicate && page > 1) {
      hasMore = false;
      break;
    }

    // 記録
    transactions.forEach((t) => {
      if (!seenIds.has(t.id)) {
        seenIds.add(t.id);
        allTransactions.push(t);
      }
    });

    // 次ページ判定
    if (transactions.length < limit) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return allTransactions;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * 日数指定でZaimデータを取得（日次同期用）
 * 日付範囲: days日前から今日まで
 */
export async function fetchZaimDataByDays(days: number): Promise<ZaimData> {
  // endDate = 明日（APIは排他的終点のため、今日を含めるには明日を指定）
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 1);

  // startDate = endDate - (days + 1)
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days - 1);

  return fetchZaimData({
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  });
}

/**
 * Zaimデータ取得（期間指定用）
 *
 * @param options 取得オプション（startDate, endDate）
 */
export async function fetchZaimData(options: FetchOptions = {}): Promise<ZaimData> {
  const api = new ZaimAPI();

  // 1. User ID取得
  log.info("Connecting to Zaim API...");
  const userInfo = await api.verifyUser() as VerifyUserResponse;
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

  // 3. トランザクション取得
  const endDate = options.endDate || formatDate(new Date());
  const startDate = options.startDate || (() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return formatDate(date);
  })();

  log.section("Fetching Transactions");
  log.info(`Period: ${startDate} - ${endDate}`);

  const transactions = await fetchTransactionsForPeriod(api, startDate, endDate, options);
  log.success(`Transactions: ${transactions.length}`);

  return {
    zaimUserId,
    categories,
    genres,
    accounts,
    transactions,
  };
}

/**
 * Zaimデータ取得（長期間用 - 全件同期向け）
 *
 * 12ヶ月単位でチャンク分割し、レート制限エラー時は自動で待機・リトライ
 *
 * @param startDate 開始日
 * @param endDate 終了日
 * @param onProgress 進捗コールバック（オプション）
 */
export async function fetchZaimDataWithChunks(
  startDate: Date,
  endDate: Date,
  onProgress?: ProgressCallback
): Promise<ZaimData> {
  const api = new ZaimAPI();

  // 1. User ID取得
  log.info("Connecting to Zaim API...");
  const userInfo = await api.verifyUser() as VerifyUserResponse;
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

  // 3. トランザクション取得（年単位チャンク）
  log.section("Fetching Transactions (Chunked)");

  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1;
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth() + 1;

  const years = generateYearList(startYear, endYear);
  log.info(`Period: ${startYear}/${startMonth} - ${endYear}/${endMonth}`);
  log.info(`Chunks: ${years.length} years`);

  const allTransactions: ZaimApiTransaction[] = [];

  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    const { startDate: chunkStart, endDate: chunkEnd } = getYearDateRange(
      year,
      startYear,
      startMonth,
      endYear,
      endMonth
    );

    log.info(`Chunk ${i + 1}/${years.length}: ${chunkStart} - ${chunkEnd}`);

    let success = false;
    while (!success) {
      try {
        const transactions = await fetchTransactionsForPeriod(
          api,
          chunkStart,
          chunkEnd
        );

        allTransactions.push(...transactions);

        // 進捗コールバック
        if (onProgress) {
          onProgress({
            chunkIndex: i,
            totalChunks: years.length,
            chunkStart,
            chunkEnd,
            transactionsFetched: transactions.length,
          });
        }

        log.success(`  ${transactions.length} transactions`);
        success = true;
      } catch (err) {
        if (err instanceof ZaimRateLimitError) {
          log.warn(`Rate limited. Waiting ${err.retryAfterSeconds}s...`);
          await sleep(err.retryAfterSeconds * 1000);
          // リトライ
          continue;
        }
        // その他のエラーは再スロー
        throw err;
      }
    }
  }

  log.success(`Total Transactions: ${allTransactions.length}`);

  return {
    zaimUserId,
    categories,
    genres,
    accounts,
    transactions: allTransactions,
  };
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const syncDays = parseInt(Deno.env.get("ZAIM_SYNC_DAYS") || "3", 10);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - syncDays);

  log.syncStart("Zaim Fetch");

  try {
    const data = await fetchZaimData({
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
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
