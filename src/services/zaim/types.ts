/**
 * Zaim 型定義
 *
 * API レスポンス型、DB テーブル型、同期関連型
 */

// =============================================================================
// Error Types
// =============================================================================

/** レート制限エラー（429） */
export class ZaimRateLimitError extends Error {
  constructor(
    public readonly retryAfterSeconds: number,
    message?: string
  ) {
    super(message ?? `Rate limited. Retry after ${retryAfterSeconds} seconds.`);
    this.name = "ZaimRateLimitError";
  }
}

/** API エラー（リトライ不可） */
export class ZaimApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly statusText: string,
    message?: string
  ) {
    super(message ?? `Zaim API Error: ${statusCode} ${statusText}`);
    this.name = "ZaimApiError";
  }
}

// =============================================================================
// Zaim API Response Types
// =============================================================================

/** Zaim API Transaction レスポンス */
export interface ZaimApiTransaction {
  id: number;
  mode: "payment" | "income" | "transfer";
  user_id: number;
  date: string;
  category_id: number;
  genre_id: number;
  from_account_id?: number;
  to_account_id?: number;
  amount: number;
  comment?: string;
  name?: string;
  place?: string;
  created?: string;
  modified?: string;
  active?: number;
  receipt_id?: number;
}

/** Zaim API Category レスポンス */
export interface ZaimApiCategory {
  id: number;
  name: string;
  sort: number;
  mode: "payment" | "income";
  active: number;
}

/** Zaim API Genre レスポンス */
export interface ZaimApiGenre {
  id: number;
  category_id: number;
  name: string;
  sort: number;
  active: number;
  parent_genre_id?: number;
}

/** Zaim API Account レスポンス */
export interface ZaimApiAccount {
  id: number;
  name: string;
  sort: number;
  active: number;
}

// =============================================================================
// Auth Types
// =============================================================================

/** OAuth 1.0a 認証情報 */
export interface OAuth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

// =============================================================================
// Database Table Types (zaim schema)
// =============================================================================

/** zaim.categories テーブル */
export interface DbCategory {
  id: number;
  zaim_user_id: number;
  name: string;
  sort_order: number;
  mode: string;
  is_active: boolean;
  synced_at: string;
}

/** zaim.genres テーブル */
export interface DbGenre {
  id: number;
  zaim_user_id: number;
  category_id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  synced_at: string;
}

/** zaim.accounts テーブル */
export interface DbAccount {
  id: number;
  zaim_user_id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  synced_at: string;
}

/** zaim.transactions テーブル */
export interface DbTransaction {
  zaim_user_id: number;
  zaim_id: number;
  transaction_type: string;
  amount: number;
  date: string;
  created_at: string;
  modified_at: string | null;
  category_id: number | null;
  genre_id: number | null;
  from_account_id: number | null;
  to_account_id: number | null;
  place: string | null;
  name: string | null;
  comment: string | null;
  is_active: boolean;
  receipt_id: number | null;
  synced_at: string;
}

/** zaim.sync_log テーブル */
export interface DbSyncLog {
  id?: string;
  zaim_user_id: number;
  sync_started_at: string;
  sync_completed_at?: string | null;
  sync_status: SyncStatus;
  api_endpoint: string;
  records_fetched?: number | null;
  records_inserted?: number | null;
  records_updated?: number | null;
  error_message?: string | null;
}

/** 同期ステータス */
export type SyncStatus = "running" | "completed" | "failed";

// =============================================================================
// Fetch Options & Data Types
// =============================================================================

/** データ取得オプション */
export interface FetchOptions {
  startDate?: string;  // YYYY-MM-DD
  endDate?: string;    // YYYY-MM-DD
  mode?: "payment" | "income" | "transfer";
  limit?: number;      // 1回のAPI取得件数（デフォルト100）
}

/** 取得データ（fetch_data.ts の出力） */
export interface ZaimData {
  zaimUserId: number;
  categories: ZaimApiCategory[];
  genres: ZaimApiGenre[];
  accounts: ZaimApiAccount[];
  transactions: ZaimApiTransaction[];
}

// =============================================================================
// Sync Result Types
// =============================================================================

/** 同期統計 */
export interface SyncStats {
  categories: number;
  genres: number;
  accounts: number;
  transactions: {
    fetched: number;
    inserted: number;
    updated: number;
    skipped: number;
  };
}

/** 同期結果 */
export interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: SyncStats;
  elapsedSeconds: number;
  errors: string[];
}

/** upsert 結果 */
export interface UpsertResult {
  success: number;
  failed: number;
}

// =============================================================================
// Type Aliases (後方互換性のため)
// =============================================================================

/** @deprecated Use ZaimApiTransaction instead */
export type ZaimTransaction = ZaimApiTransaction;
/** @deprecated Use ZaimApiCategory instead */
export type ZaimCategory = ZaimApiCategory;
/** @deprecated Use ZaimApiGenre instead */
export type ZaimGenre = ZaimApiGenre;
/** @deprecated Use ZaimApiAccount instead */
export type ZaimAccount = ZaimApiAccount;
/** @deprecated Use OAuth1Credentials instead */
export type OAuthConfig = OAuth1Credentials;
