/**
 * 差分同期状態管理ユーティリティ
 *
 * operations.sync_state テーブルを通じて各サービスの同期状態を管理し、
 * 厳密な差分同期を実現する。
 *
 * 設計方針:
 * - サービスAPIの差分取得機能（since, updatedMin等）には依存しない
 * - Supabase側のlast_record_at（最新レコード日付）を起点に日付範囲で取得
 * - 全サービスで統一パターンを使用
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// =============================================================================
// Types
// =============================================================================

/** 同期状態 */
export interface SyncState {
  id: string;
  service_name: string;
  endpoint_name: string;
  last_synced_at: string | null;
  last_record_at: string | null;
  last_record_id: string | null;
  sync_mode: "incremental" | "full" | "cursor";
  config: SyncConfig;
  created_at: string;
  updated_at: string;
}

/** エンドポイント設定 */
export interface SyncConfig {
  /** フルリフレッシュ時のデフォルト日数 */
  default_days?: number;
  /** 安全マージン日数（last_record_atからさらに遡る日数） */
  margin_days?: number;
  [key: string]: unknown;
}

/** 同期ログエントリ */
export interface SyncLogEntry {
  service_name: string;
  endpoint_name: string;
  run_id?: string;
  sync_mode: string;
  query_from?: string;
  query_to?: string;
  status: "success" | "partial" | "failed";
  records_fetched?: number;
  records_inserted?: number;
  records_updated?: number;
  records_skipped?: number;
  started_at?: string;
  completed_at?: string;
  elapsed_ms?: number;
  api_calls?: number;
  error_message?: string;
  error_details?: Record<string, unknown>;
  next_sync_from?: string;
  next_cursor?: string;
}

/** 差分クエリパラメータ */
export interface IncrementalQueryParams {
  /** クエリ開始日（YYYY-MM-DD） */
  startDate: string;
  /** クエリ終了日（YYYY-MM-DD） */
  endDate: string;
  /** 開始日のDateオブジェクト */
  from: Date;
  /** 終了日のDateオブジェクト */
  to: Date;
  /** 初回同期かどうか */
  isInitialSync: boolean;
  /** 同期モード */
  mode: "incremental" | "full";
}

// =============================================================================
// Client Factory
// =============================================================================

let supabase: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!supabase) {
    const url = Deno.env.get("SUPABASE_URL")?.trim();
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

// =============================================================================
// Sync State Management
// =============================================================================

/**
 * サービス×エンドポイントの同期状態を取得
 */
export async function getSyncState(
  serviceName: string,
  endpointName: string
): Promise<SyncState | null> {
  const client = getClient();

  const { data, error } = await client
    .schema("operations")
    .from("sync_state")
    .select("*")
    .eq("service_name", serviceName)
    .eq("endpoint_name", endpointName)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    throw new Error(`Failed to get sync state: ${error.message}`);
  }

  return data as SyncState;
}

/**
 * 同期状態を更新
 */
export async function updateSyncState(
  serviceName: string,
  endpointName: string,
  updates: {
    last_synced_at?: Date;
    last_record_at?: Date;
    last_record_id?: string;
  }
): Promise<void> {
  const client = getClient();

  const { error } = await client
    .schema("operations")
    .from("sync_state")
    .update({
      last_synced_at: updates.last_synced_at?.toISOString(),
      last_record_at: updates.last_record_at?.toISOString(),
      last_record_id: updates.last_record_id,
    })
    .eq("service_name", serviceName)
    .eq("endpoint_name", endpointName);

  if (error) {
    throw new Error(`Failed to update sync state: ${error.message}`);
  }
}

/**
 * 差分クエリのパラメータを計算
 *
 * Supabase側のlast_record_atを起点に、日付範囲を決定する。
 * サービスAPIの差分取得機能には依存しない。
 *
 * @param serviceName サービス名
 * @param endpointName エンドポイント名
 * @param options オプション
 * @returns クエリパラメータ
 */
export async function getIncrementalQueryParams(
  serviceName: string,
  endpointName: string,
  options?: {
    /** 強制フルリフレッシュ */
    forceFullRefresh?: boolean;
    /** カスタム終了日 */
    endDate?: Date;
    /** フルリフレッシュ時の日数（デフォルト: 7） */
    defaultDays?: number;
    /** 安全マージン日数（last_record_atからさらに遡る、デフォルト: 1） */
    marginDays?: number;
  }
): Promise<IncrementalQueryParams> {
  const state = await getSyncState(serviceName, endpointName);

  const now = options?.endDate ?? new Date();
  const defaultDays = options?.defaultDays ?? state?.config?.default_days ?? 7;
  const marginDays = options?.marginDays ?? state?.config?.margin_days ?? 1;

  // 終了日: 明日（APIは排他的終点が多いため、今日を含めるには明日を指定）
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 1);
  endDate.setHours(0, 0, 0, 0);

  // 開始日を決定
  let startDate: Date;
  let isInitialSync = false;
  let mode: "incremental" | "full" = "incremental";

  if (options?.forceFullRefresh || !state?.last_record_at) {
    // フルリフレッシュ: defaultDays日前から
    isInitialSync = !state?.last_record_at;
    mode = "full";
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - defaultDays);
    startDate.setHours(0, 0, 0, 0);
  } else {
    // 差分同期: last_record_at - marginDays から
    startDate = new Date(state.last_record_at);
    startDate.setDate(startDate.getDate() - marginDays);
    startDate.setHours(0, 0, 0, 0);
  }

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    from: startDate,
    to: endDate,
    isInitialSync,
    mode,
  };
}

// =============================================================================
// Sync Log Management
// =============================================================================

/**
 * 同期ログを記録
 */
export async function logSync(entry: SyncLogEntry): Promise<string> {
  const client = getClient();

  const { data, error } = await client
    .schema("operations")
    .from("sync_log")
    .insert({
      ...entry,
      completed_at: entry.completed_at ?? new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to log sync: ${error.message}`);
  }

  return data.id;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * 日付をYYYY-MM-DD形式に変換
 */
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * 日付をUNIXタイムスタンプに変換
 */
export function toUnixTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * サービスの全エンドポイント状態を取得
 */
export async function getServiceSyncStates(
  serviceName: string
): Promise<SyncState[]> {
  const client = getClient();

  const { data, error } = await client
    .schema("operations")
    .from("sync_state")
    .select("*")
    .eq("service_name", serviceName)
    .order("endpoint_name");

  if (error) {
    throw new Error(`Failed to get service sync states: ${error.message}`);
  }

  return data as SyncState[];
}

/**
 * 全サービスの同期状態サマリーを取得
 */
export async function getSyncStatusSummary(): Promise<
  Array<{
    service_name: string;
    endpoint_name: string;
    sync_mode: string;
    last_synced_at: string | null;
    last_record_at: string | null;
    last_status: string | null;
    hours_since_sync: number | null;
  }>
> {
  const client = getClient();

  const { data, error } = await client
    .schema("operations")
    .from("v_sync_status")
    .select("*");

  if (error) {
    throw new Error(`Failed to get sync status summary: ${error.message}`);
  }

  return data;
}

/**
 * レコードから最新日付を抽出
 *
 * @param records レコード配列
 * @param dateField 日付フィールド名
 * @returns 最新日付（見つからない場合はundefined）
 */
export function extractLatestDate<T extends Record<string, unknown>>(
  records: T[],
  dateField: keyof T
): Date | undefined {
  if (records.length === 0) return undefined;

  let latest: Date | undefined;

  for (const record of records) {
    const value = record[dateField];
    if (!value) continue;

    const date = typeof value === "string" ? new Date(value) : value as Date;
    if (!latest || date > latest) {
      latest = date;
    }
  }

  return latest;
}

/**
 * rawテーブルから最新レコードの日付を取得
 * 
 * DBのtimestamptzは既にUTCなので、変換なしで取得できる。
 * 
 * @param tableName rawスキーマのテーブル名
 * @param dateColumn 日付カラム名
 * @param filterColumn フィルタカラム（オプション）
 * @param filterValue フィルタ値（オプション）
 * @returns 最新日付（見つからない場合はnull）
 */
export async function getLatestRecordDate(
  tableName: string,
  dateColumn: string,
  filterColumn?: string,
  filterValue?: string | number,
): Promise<Date | null> {
  const client = getClient();
  
  let query = client
    .schema("raw")
    .from(tableName)
    .select(dateColumn)
    .order(dateColumn, { ascending: false })
    .limit(1);
  
  if (filterColumn && filterValue !== undefined) {
    query = query.eq(filterColumn, filterValue);
  }
  
  const { data, error } = await query.single();
  
  if (error) {
    if (error.code === "PGRST116") {
      // No rows found
      return null;
    }
    throw new Error(`Failed to get latest record date: ${error.message}`);
  }
  
  const dateValue = data?.[dateColumn];
  return dateValue ? new Date(dateValue) : null;
}
