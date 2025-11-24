/**
 * 共通データベースユーティリティ
 *
 * postgres.js を使用した PostgreSQL 直接接続
 * raw スキーマへの書き込みを担当
 */

import postgres from "npm:postgres@3";
import * as log from "./log.ts";

// =============================================================================
// Types
// =============================================================================

/** postgres.js のSQL関数型 */
export type Sql = ReturnType<typeof postgres>;

/** Upsert結果 */
export interface UpsertResult {
  success: number;
  failed: number;
}

/** バッチ処理オプション */
export interface BatchOptions {
  /** バッチサイズ（デフォルト: 1000） */
  batchSize?: number;
  /** ログ出力するか（デフォルト: true） */
  logging?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BATCH_SIZE = 1000;

// =============================================================================
// Connection
// =============================================================================

/** シングルトン接続インスタンス */
let _sql: Sql | null = null;

/**
 * PostgreSQL接続を取得（シングルトン）
 *
 * @example
 * ```ts
 * const sql = getConnection();
 * const rows = await sql`SELECT * FROM raw.toggl_entries LIMIT 10`;
 * ```
 */
export function getConnection(): Sql {
  if (_sql) return _sql;

  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  _sql = postgres(databaseUrl, {
    // 接続プールの設定
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,

    // SSL設定（Supabaseは必須）
    ssl: "require",

    // 型変換
    transform: {
      // undefined を null に変換
      undefined: null,
    },
  });

  return _sql;
}

/**
 * 接続を閉じる（テスト・クリーンアップ用）
 */
export async function closeConnection(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}

// =============================================================================
// Schema Helpers
// =============================================================================

/**
 * raw スキーマのテーブル名を生成
 *
 * @example
 * ```ts
 * rawTable("toggl", "entries") // → "toggl_entries"
 * rawTable("fitbit", "sleep")  // → "fitbit_sleep"
 * ```
 */
export function rawTableName(service: string, table: string): string {
  return `${service}_${table}`;
}

// =============================================================================
// Batch Operations
// =============================================================================

/**
 * バッチ INSERT ... ON CONFLICT DO UPDATE
 *
 * @param table テーブル名（スキーマなし、例: "toggl_entries"）
 * @param records 挿入するレコード配列
 * @param conflictColumns 競合検出カラム（配列）
 * @param updateColumns 更新するカラム（配列）
 * @param options バッチオプション
 *
 * @example
 * ```ts
 * await batchUpsert(
 *   "toggl_entries",
 *   entries,
 *   ["id"],
 *   ["description", "start", "end", "duration_ms", "updated_at"]
 * );
 * ```
 */
export async function batchUpsert<T extends Record<string, unknown>>(
  table: string,
  records: T[],
  conflictColumns: string[],
  updateColumns: string[],
  options: BatchOptions = {},
): Promise<UpsertResult> {
  const { batchSize = DEFAULT_BATCH_SIZE, logging = true } = options;

  if (records.length === 0) {
    return { success: 0, failed: 0 };
  }

  const sql = getConnection();
  let success = 0;
  let failed = 0;

  // synced_at カラムを追加
  const recordsWithSyncedAt = records.map((r) => ({
    ...r,
    synced_at: new Date().toISOString(),
  }));

  for (let i = 0; i < recordsWithSyncedAt.length; i += batchSize) {
    const batch = recordsWithSyncedAt.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    try {
      // postgres.js の動的テーブル・カラム指定
      const columns = Object.keys(batch[0]);

      await sql`
        INSERT INTO raw.${sql(table)} ${sql(batch, ...columns)}
        ON CONFLICT (${sql(conflictColumns)})
        DO UPDATE SET ${sql(
          updateColumns.reduce((acc, col) => {
            acc[col] = sql`EXCLUDED.${sql(col)}`;
            return acc;
          }, {} as Record<string, unknown>)
        )}, synced_at = now()
      `;

      success += batch.length;
    } catch (error) {
      if (logging) {
        log.error(`${table} batch ${batchNum}: ${(error as Error).message}`);
      }
      failed += batch.length;
    }
  }

  return { success, failed };
}

/**
 * バッチ INSERT（重複時は無視）
 *
 * @param table テーブル名（スキーマなし）
 * @param records 挿入するレコード配列
 * @param conflictColumns 競合検出カラム（配列）
 * @param options バッチオプション
 */
export async function batchInsertIgnore<T extends Record<string, unknown>>(
  table: string,
  records: T[],
  conflictColumns: string[],
  options: BatchOptions = {},
): Promise<UpsertResult> {
  const { batchSize = DEFAULT_BATCH_SIZE, logging = true } = options;

  if (records.length === 0) {
    return { success: 0, failed: 0 };
  }

  const sql = getConnection();
  let success = 0;
  let failed = 0;

  const recordsWithSyncedAt = records.map((r) => ({
    ...r,
    synced_at: new Date().toISOString(),
  }));

  for (let i = 0; i < recordsWithSyncedAt.length; i += batchSize) {
    const batch = recordsWithSyncedAt.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    try {
      const columns = Object.keys(batch[0]);

      await sql`
        INSERT INTO raw.${sql(table)} ${sql(batch, ...columns)}
        ON CONFLICT (${sql(conflictColumns)}) DO NOTHING
      `;

      success += batch.length;
    } catch (error) {
      if (logging) {
        log.error(`${table} batch ${batchNum}: ${(error as Error).message}`);
      }
      failed += batch.length;
    }
  }

  return { success, failed };
}

/**
 * TRUNCATE → INSERT（マスターデータ同期用）
 *
 * @param table テーブル名（スキーマなし）
 * @param records 挿入するレコード配列
 * @param options バッチオプション
 */
export async function truncateAndInsert<T extends Record<string, unknown>>(
  table: string,
  records: T[],
  options: BatchOptions = {},
): Promise<UpsertResult> {
  const { batchSize = DEFAULT_BATCH_SIZE, logging = true } = options;
  const sql = getConnection();

  try {
    // TRUNCATE
    await sql`TRUNCATE raw.${sql(table)}`;
  } catch (error) {
    if (logging) {
      log.error(`${table} truncate: ${(error as Error).message}`);
    }
    return { success: 0, failed: records.length };
  }

  if (records.length === 0) {
    return { success: 0, failed: 0 };
  }

  let success = 0;
  let failed = 0;

  const recordsWithSyncedAt = records.map((r) => ({
    ...r,
    synced_at: new Date().toISOString(),
  }));

  for (let i = 0; i < recordsWithSyncedAt.length; i += batchSize) {
    const batch = recordsWithSyncedAt.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    try {
      const columns = Object.keys(batch[0]);

      await sql`INSERT INTO raw.${sql(table)} ${sql(batch, ...columns)}`;

      success += batch.length;
    } catch (error) {
      if (logging) {
        log.error(`${table} insert batch ${batchNum}: ${(error as Error).message}`);
      }
      failed += batch.length;
    }
  }

  return { success, failed };
}

// =============================================================================
// Query Helpers
// =============================================================================

/**
 * 単純なSELECTクエリ
 *
 * @example
 * ```ts
 * const entries = await selectAll<DbEntry>("toggl_entries");
 * ```
 */
export async function selectAll<T>(table: string): Promise<T[]> {
  const sql = getConnection();
  return await sql<T[]>`SELECT * FROM raw.${sql(table)}`;
}

/**
 * 条件付きSELECT
 *
 * @example
 * ```ts
 * const recentEntries = await selectWhere<DbEntry>(
 *   "toggl_entries",
 *   sql`start >= ${startDate}`
 * );
 * ```
 */
export async function selectWhere<T>(
  table: string,
  condition: ReturnType<Sql>,
): Promise<T[]> {
  const sql = getConnection();
  return await sql<T[]>`SELECT * FROM raw.${sql(table)} WHERE ${condition}`;
}

/**
 * レコード数を取得
 */
export async function count(table: string): Promise<number> {
  const sql = getConnection();
  const result = await sql`SELECT COUNT(*)::int as count FROM raw.${sql(table)}`;
  return result[0].count;
}

// =============================================================================
// Logging Helpers
// =============================================================================

/**
 * Upsert結果をログ出力
 */
export function logUpsertResult(
  dataType: string,
  result: UpsertResult,
): void {
  if (result.success > 0) {
    log.success(`${result.success} records saved`);
  }
  if (result.failed > 0) {
    log.error(`${result.failed} records failed`);
  }
  if (result.success === 0 && result.failed === 0) {
    log.info(`${dataType}: 0 records`);
  }
}
