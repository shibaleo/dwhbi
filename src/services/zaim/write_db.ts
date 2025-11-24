/**
 * Zaim データの Supabase 書き込み
 *
 * raw スキーマへのデータ変換と upsert 処理
 * sync_log は zaim スキーマに残す
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as log from "../../utils/log.ts";
import type {
  ZaimApiTransaction,
  ZaimApiCategory,
  ZaimApiGenre,
  ZaimApiAccount,
  DbCategory,
  DbGenre,
  DbAccount,
  DbTransaction,
  SyncStatus,
  UpsertResult,
} from "./types.ts";

// =============================================================================
// Types
// =============================================================================

/** raw スキーマ用クライアント型 */
export type RawSchema = ReturnType<SupabaseClient["schema"]>;

/** zaim スキーマ用クライアント型（sync_log用） */
export type ZaimSchema = ReturnType<SupabaseClient["schema"]>;

// =============================================================================
// Constants
// =============================================================================

const BATCH_SIZE = 1000;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Zaim APIのタイムスタンプをUTCにTIMESTAMPTZに変換
 * 
 * Zaim APIは "2025-11-24 20:43:44" のようにtz情報なしのJST時刻を返す。
 * PostgreSQLのtimestamptzに保存するためUTCに変換する。
 */
function convertZaimTimestampToUTC(timestamp: string | undefined | null): string | null {
  if (!timestamp) return null;
  
  // 既にタイムゾーン情報がある場合はそのまま
  if (timestamp.includes('+') || timestamp.includes('Z')) {
    return timestamp;
  }
  
  // JSTとして解釈してUTCに変換
  // "2025-11-24 20:43:44" -> "2025-11-24T20:43:44+09:00"
  const jstTimestamp = timestamp.replace(' ', 'T') + '+09:00';
  const date = new Date(jstTimestamp);
  return date.toISOString();
}

// =============================================================================
// Client Factory
// =============================================================================

/**
 * raw スキーマ専用の Supabase クライアントを作成（データ用）
 */
export function createZaimDbClient(): RawSchema {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const supabase = createClient(url, key);
  return supabase.schema("raw");
}

/**
 * zaim スキーマ専用の Supabase クライアントを作成（sync_log用）
 */
export function createZaimSyncLogClient(): ZaimSchema {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const supabase = createClient(url, key);
  return supabase.schema("zaim");
}

// =============================================================================
// Transform Functions: API → DB Record
// =============================================================================

/**
 * ZaimApiCategory → DbCategory
 */
export function toDbCategory(category: ZaimApiCategory, zaimUserId: number): DbCategory {
  return {
    id: category.id,
    zaim_user_id: zaimUserId,
    name: category.name,
    sort_order: category.sort,
    mode: category.mode,
    is_active: category.active === 1,
    synced_at: new Date().toISOString(),
  };
}

/**
 * ZaimApiGenre → DbGenre
 */
export function toDbGenre(genre: ZaimApiGenre, zaimUserId: number): DbGenre {
  return {
    id: genre.id,
    zaim_user_id: zaimUserId,
    category_id: genre.category_id,
    name: genre.name,
    sort_order: genre.sort,
    is_active: genre.active === 1,
    synced_at: new Date().toISOString(),
  };
}

/**
 * ZaimApiAccount → DbAccount
 */
export function toDbAccount(account: ZaimApiAccount, zaimUserId: number): DbAccount {
  return {
    id: account.id,
    zaim_user_id: zaimUserId,
    name: account.name,
    sort_order: account.sort,
    is_active: account.active === 1,
    synced_at: new Date().toISOString(),
  };
}

/**
 * ZaimApiTransaction → DbTransaction
 * アカウント ID 0 は NULL に変換
 * created/modified はJST→UTC変換
 */
export function toDbTransaction(tx: ZaimApiTransaction, zaimUserId: number): DbTransaction {
  const fromAccountId =
    tx.from_account_id && tx.from_account_id > 0 ? tx.from_account_id : null;
  const toAccountId =
    tx.to_account_id && tx.to_account_id > 0 ? tx.to_account_id : null;

  return {
    zaim_user_id: zaimUserId,
    zaim_id: tx.id,
    transaction_type: tx.mode,
    amount: tx.amount,
    date: tx.date,
    created_at: convertZaimTimestampToUTC(tx.created) || new Date().toISOString(),
    modified_at: convertZaimTimestampToUTC(tx.modified),
    category_id: tx.category_id || null,
    genre_id: tx.genre_id || null,
    from_account_id: fromAccountId,
    to_account_id: toAccountId,
    place: tx.place || null,
    name: tx.name || null,
    comment: tx.comment || null,
    is_active: tx.active === undefined ? true : tx.active === 1,
    receipt_id: tx.receipt_id || null,
    synced_at: new Date().toISOString(),
  };
}

// =============================================================================
// Batch Upsert
// =============================================================================

/**
 * バッチ upsert
 */
async function upsertBatch<T extends object>(
  raw: RawSchema,
  table: string,
  records: T[],
  onConflict: string,
): Promise<UpsertResult> {
  if (records.length === 0) {
    return { success: 0, failed: 0 };
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await raw
      .from(table)
      .upsert(batch, { onConflict });

    if (error) {
      log.error(`${table} batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
      failed += batch.length;
    } else {
      success += batch.length;
    }
  }

  return { success, failed };
}

// =============================================================================
// Sync Log
// =============================================================================

/**
 * 同期ログを開始
 * @returns ログ ID
 */
export async function startSyncLog(
  zaim: ZaimSchema,
  zaimUserId: number,
  endpoint: string,
): Promise<string> {
  const { data, error } = await zaim
    .from("sync_log")
    .insert({
      zaim_user_id: zaimUserId,
      sync_started_at: new Date().toISOString(),
      sync_status: "running" as SyncStatus,
      api_endpoint: endpoint,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to start sync log: ${error.message}`);
  }
  return data.id;
}

/**
 * 同期ログを完了
 */
export async function completeSyncLog(
  zaim: ZaimSchema,
  logId: string,
  status: SyncStatus,
  stats: { fetched: number; inserted: number; updated: number },
  errorMessage?: string,
): Promise<void> {
  const { error } = await zaim
    .from("sync_log")
    .update({
      sync_completed_at: new Date().toISOString(),
      sync_status: status,
      records_fetched: stats.fetched,
      records_inserted: stats.inserted,
      records_updated: stats.updated,
      error_message: errorMessage,
    })
    .eq("id", logId);

  if (error) {
    log.error(`Failed to update sync log: ${error.message}`);
  }
}

// =============================================================================
// Upsert Functions
// =============================================================================

/**
 * メタデータ（categories, genres, accounts）を upsert
 * 
 * 注意: genres は category_id への外部キー制約があるため、
 * categories → genres → accounts の順序で実行する
 */
export async function upsertMetadata(
  raw: RawSchema,
  zaimUserId: number,
  categories: ZaimApiCategory[],
  genres: ZaimApiGenre[],
  accounts: ZaimApiAccount[],
): Promise<{ categories: UpsertResult; genres: UpsertResult; accounts: UpsertResult }> {
  // Categories
  const catRecords = categories.map((c) => toDbCategory(c, zaimUserId));
  log.info(`Saving categories... (${catRecords.length} records)`);
  const catResult = await upsertBatch(raw, "zaim_categories", catRecords, "zaim_user_id,id");
  if (catResult.success > 0) log.success(`${catResult.success} records saved`);
  if (catResult.failed > 0) log.error(`${catResult.failed} records failed`);

  // Genres（categories の後）
  const genRecords = genres.map((g) => toDbGenre(g, zaimUserId));
  log.info(`Saving genres... (${genRecords.length} records)`);
  const genResult = await upsertBatch(raw, "zaim_genres", genRecords, "zaim_user_id,id");
  if (genResult.success > 0) log.success(`${genResult.success} records saved`);
  if (genResult.failed > 0) log.error(`${genResult.failed} records failed`);

  // Accounts
  const accRecords = accounts.map((a) => toDbAccount(a, zaimUserId));
  log.info(`Saving accounts... (${accRecords.length} records)`);
  const accResult = await upsertBatch(raw, "zaim_accounts", accRecords, "zaim_user_id,id");
  if (accResult.success > 0) log.success(`${accResult.success} records saved`);
  if (accResult.failed > 0) log.error(`${accResult.failed} records failed`);

  return {
    categories: catResult,
    genres: genResult,
    accounts: accResult,
  };
}

/**
 * トランザクションを同期
 */
export async function syncTransactions(
  raw: RawSchema,
  zaimUserId: number,
  transactions: ZaimApiTransaction[],
  existingIds: Set<number>,
): Promise<{
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
}> {
  const txRecords: DbTransaction[] = [];
  let skipped = 0;
  let inserted = 0;
  let updated = 0;

  for (const tx of transactions) {
    // valid_accounts 制約: transfer は両方のアカウントが必要
    if (tx.mode === "transfer") {
      if (!tx.from_account_id || !tx.to_account_id) {
        skipped++;
        continue;
      }
    }

    const record = toDbTransaction(tx, zaimUserId);
    txRecords.push(record);

    if (existingIds.has(record.zaim_id)) {
      updated++;
    } else {
      inserted++;
    }
  }

  log.info(`Saving transactions... (${txRecords.length} records)`);
  const result = await upsertBatch(raw, "zaim_transactions", txRecords, "zaim_user_id,zaim_id");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);
  if (skipped > 0) log.info(`${skipped} records skipped (invalid transfer)`);

  return {
    fetched: transactions.length,
    inserted,
    updated,
    skipped,
    failed: result.failed,
  };
}

/**
 * 指定期間の既存トランザクション ID を取得
 */
export async function getExistingTransactionIds(
  raw: RawSchema,
  zaimUserId: number,
  startDate: string,
  endDate: string,
): Promise<Set<number>> {
  const { data: existingTx, error } = await raw
    .from("zaim_transactions")
    .select("zaim_id")
    .eq("zaim_user_id", zaimUserId)
    .gte("date", startDate)
    .lte("date", endDate);

  if (error) {
    log.error(`Failed to get existing transaction IDs: ${error.message}`);
    return new Set();
  }

  return new Set(existingTx?.map((t) => t.zaim_id) || []);
}
