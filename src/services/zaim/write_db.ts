// write_db.ts
// Supabase zaim スキーマへのデータ書き込みを担当

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type {
  ZaimTransaction,
  ZaimCategory,
  ZaimGenre,
  ZaimAccount
} from "./types.ts";

// ============================================================
// 型定義
// ============================================================

/** Supabaseのzaimスキーマクライアント */
export type ZaimSchema = ReturnType<SupabaseClient['schema']>;

/** 同期ステータス */
export type SyncStatus = 'running' | 'completed' | 'failed';

/** DB用カテゴリレコード */
export interface DbCategory {
  id: number;
  zaim_user_id: number;
  name: string;
  sort_order: number;
  mode: string;
  is_active: boolean;
  synced_at: string;
}

/** DB用ジャンルレコード */
export interface DbGenre {
  id: number;
  zaim_user_id: number;
  category_id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  synced_at: string;
}

/** DB用口座レコード */
export interface DbAccount {
  id: number;
  zaim_user_id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  synced_at: string;
}

/** DB用トランザクションレコード */
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

/** upsert結果 */
export interface UpsertResult {
  success: number;
  failed: number;
}

// ============================================================
// Supabaseクライアント
// ============================================================

/**
 * Supabase zaim スキーマクライアントを作成
 * @returns zaimスキーマにバインドされたクライアント
 * @throws 環境変数未設定時
 */
export function createZaimClient(): ZaimSchema {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase環境変数が設定されていません');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  return supabase.schema('zaim');
}

// ============================================================
// 変換関数: Zaim API → DB レコード
// ============================================================

/**
 * ZaimCategory → DbCategory
 */
export function toDbCategory(category: ZaimCategory, zaimUserId: number): DbCategory {
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
 * ZaimGenre → DbGenre
 */
export function toDbGenre(genre: ZaimGenre, zaimUserId: number): DbGenre {
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
 * ZaimAccount → DbAccount
 */
export function toDbAccount(account: ZaimAccount, zaimUserId: number): DbAccount {
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
 * ZaimTransaction → DbTransaction
 * アカウントID 0 は NULL に変換
 */
export function toDbTransaction(tx: ZaimTransaction, zaimUserId: number): DbTransaction {
  const fromAccountId = (tx.from_account_id && tx.from_account_id > 0)
    ? tx.from_account_id : null;
  const toAccountId = (tx.to_account_id && tx.to_account_id > 0)
    ? tx.to_account_id : null;

  return {
    zaim_user_id: zaimUserId,
    zaim_id: tx.id,
    transaction_type: tx.mode,
    amount: tx.amount,
    date: tx.date,
    created_at: tx.created || new Date().toISOString(),
    modified_at: tx.modified || null,
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

// ============================================================
// バッチ upsert
// ============================================================

/**
 * レコードをバッチでupsert
 * @param zaim zaimスキーマクライアント
 * @param table テーブル名
 * @param records upsertするレコード配列
 * @param onConflict 競合キー（カンマ区切り）
 * @param batchSize バッチサイズ（デフォルト: 1000）
 */
export async function upsertBatch<T>(
  zaim: ZaimSchema,
  table: string,
  records: T[],
  onConflict: string,
  batchSize: number = 1000
): Promise<UpsertResult> {
  let success = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const { error } = await zaim
      .from(table)
      .upsert(batch, { onConflict });

    if (error) {
      console.error(`  ❌ ${table} バッチエラー:`, error.message);
      failed += batch.length;
    } else {
      success += batch.length;
    }
  }

  return { success, failed };
}

// ============================================================
// 同期ログ
// ============================================================

/**
 * 同期ログを開始
 * @returns ログID
 */
export async function startSyncLog(
  zaim: ZaimSchema,
  zaimUserId: number,
  endpoint: string
): Promise<string> {
  const { data, error } = await zaim
    .from('sync_log')
    .insert({
      zaim_user_id: zaimUserId,
      sync_started_at: new Date().toISOString(),
      sync_status: 'running' as SyncStatus,
      api_endpoint: endpoint,
    })
    .select('id')
    .single();

  if (error) throw new Error(`同期ログ開始エラー: ${error.message}`);
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
  errorMessage?: string
): Promise<void> {
  const { error } = await zaim
    .from('sync_log')
    .update({
      sync_completed_at: new Date().toISOString(),
      sync_status: status,
      records_fetched: stats.fetched,
      records_inserted: stats.inserted,
      records_updated: stats.updated,
      error_message: errorMessage,
    })
    .eq('id', logId);

  if (error) {
    console.error(`同期ログ更新エラー: ${error.message}`);
  }
}

// ============================================================
// マスタデータ同期ヘルパー
// ============================================================

/**
 * マスタデータ（categories, genres, accounts）を同期
 */
export async function syncMasters(
  zaim: ZaimSchema,
  zaimUserId: number,
  categories: ZaimCategory[],
  genres: ZaimGenre[],
  accounts: ZaimAccount[]
): Promise<{ categories: number; genres: number; accounts: number }> {
  // Categories
  const catRecords = categories.map(c => toDbCategory(c, zaimUserId));
  const catResult = await upsertBatch(zaim, 'categories', catRecords, 'zaim_user_id,id');

  // Genres（categoriesの後）
  const genRecords = genres.map(g => toDbGenre(g, zaimUserId));
  const genResult = await upsertBatch(zaim, 'genres', genRecords, 'zaim_user_id,id');

  // Accounts
  const accRecords = accounts.map(a => toDbAccount(a, zaimUserId));
  const accResult = await upsertBatch(zaim, 'accounts', accRecords, 'zaim_user_id,id');

  return {
    categories: catResult.success,
    genres: genResult.success,
    accounts: accResult.success,
  };
}

/**
 * トランザクションを同期
 * @returns 同期結果
 */
export async function syncTransactions(
  zaim: ZaimSchema,
  zaimUserId: number,
  transactions: ZaimTransaction[],
  existingIds: Set<number>
): Promise<{ fetched: number; inserted: number; updated: number; skipped: number; failed: number }> {
  const txRecords: DbTransaction[] = [];
  let skipped = 0;
  let inserted = 0;
  let updated = 0;

  for (const tx of transactions) {
    // valid_accounts制約: transferは両方のアカウントが必要
    if (tx.mode === 'transfer') {
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

  const result = await upsertBatch(zaim, 'transactions', txRecords, 'zaim_user_id,zaim_id');

  return {
    fetched: transactions.length,
    inserted,
    updated,
    skipped,
    failed: result.failed,
  };
}

/**
 * 指定期間の既存トランザクションIDを取得
 */
export async function getExistingTransactionIds(
  zaim: ZaimSchema,
  zaimUserId: number,
  startDate: string,
  endDate: string
): Promise<Set<number>> {
  const { data: existingTx } = await zaim
    .from('transactions')
    .select('zaim_id')
    .eq('zaim_user_id', zaimUserId)
    .gte('date', startDate)
    .lte('date', endDate);

  return new Set(existingTx?.map(t => t.zaim_id) || []);
}
