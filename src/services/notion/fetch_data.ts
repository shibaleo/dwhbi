/**
 * Notion データ取得オーケストレーション
 *
 * 責務:
 * - メタテーブルから設定を読み込み
 * - 各テーブルのデータ取得
 * - master/transaction同期タイプに応じた取得方法の選択
 */

import { getDatabase, queryDatabase, queryDatabaseByLastEdited } from "./api.ts";
import { fetchEnabledConfigs, fetchConfigByName } from "./fetch_config.ts";
import type {
  SyncConfig,
  NotionApiPage,
  NotionApiPropertySchema,
  NotionTableData,
} from "./types.ts";
import { NotionRateLimitError } from "./types.ts";
import * as log from "../../utils/log.ts";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SYNC_DAYS = 3;

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 日付範囲を計算: days日前から今日まで
 * @param days 取得する日数
 * @returns ISO8601形式の開始日時文字列
 */
export function getStartDateIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

// =============================================================================
// Database Schema Fetch
// =============================================================================

/**
 * データベースのプロパティ定義を取得
 */
export async function fetchDatabaseSchema(
  databaseId: string
): Promise<Record<string, NotionApiPropertySchema>> {
  const db = await getDatabase(databaseId);
  return db.properties;
}

// =============================================================================
// Single Table Data Fetch
// =============================================================================

/**
 * 単一テーブルの全ページを取得（master同期用）
 */
export async function fetchAllPages(config: SyncConfig): Promise<NotionTableData> {
  log.info(`Fetching all pages from "${config.name}"...`);

  const [properties, pages] = await Promise.all([
    fetchDatabaseSchema(config.databaseId),
    queryDatabase(config.databaseId),
  ]);

  log.info(`  ${pages.length} pages fetched`);

  return { config, pages, properties };
}

/**
 * 単一テーブルの最近更新されたページを取得（transaction同期用）
 */
export async function fetchRecentPages(
  config: SyncConfig,
  sinceIso: string
): Promise<NotionTableData> {
  log.info(`Fetching pages from "${config.name}" since ${sinceIso}...`);

  const [properties, pages] = await Promise.all([
    fetchDatabaseSchema(config.databaseId),
    queryDatabaseByLastEdited(config.databaseId, sinceIso),
  ]);

  log.info(`  ${pages.length} pages fetched`);

  return { config, pages, properties };
}

// =============================================================================
// Multi-Table Data Fetch (Daily Sync)
// =============================================================================

/**
 * 日次同期用データ取得
 *
 * - enabled=true のテーブルを取得
 * - master: 全件取得
 * - transaction: last_synced_at以降のデータを取得
 *
 * @param days 同期日数（transaction同期でlast_synced_atがない場合に使用）
 */
export async function fetchNotionDataByDays(
  days: number = DEFAULT_SYNC_DAYS
): Promise<NotionTableData[]> {
  // 設定を取得
  const configs = await fetchEnabledConfigs();

  if (configs.length === 0) {
    log.warn("No enabled configs found in metadata table");
    return [];
  }

  const results: NotionTableData[] = [];
  const fallbackSince = getStartDateIso(days);

  for (const config of configs) {
    try {
      let data: NotionTableData;

      if (config.syncType === "master") {
        // master: 全件取得
        data = await fetchAllPages(config);
      } else {
        // transaction: 差分取得
        const since = config.lastSyncedAt ?? fallbackSince;
        data = await fetchRecentPages(config, since);
      }

      results.push(data);

      // レート制限対策
      await sleep(500);
    } catch (err) {
      if (err instanceof NotionRateLimitError) {
        log.warn(`Rate limited. Waiting ${err.retryAfterSeconds}s...`);
        await sleep(err.retryAfterSeconds * 1000);
        // リトライ
        const retryData = await (config.syncType === "master"
          ? fetchAllPages(config)
          : fetchRecentPages(config, config.lastSyncedAt ?? fallbackSince));
        results.push(retryData);
      } else {
        log.error(`Failed to fetch "${config.name}": ${err instanceof Error ? err.message : err}`);
        throw err;
      }
    }
  }

  return results;
}

// =============================================================================
// Multi-Table Data Fetch (Full Sync)
// =============================================================================

/**
 * 全件同期用データ取得
 *
 * enabled=true/false に関わらず、指定されたテーブルを全件取得
 *
 * @param options オプション
 */
export async function fetchAllNotionData(options?: {
  /** 特定テーブル名のみ同期（指定しない場合は全enabled） */
  tableName?: string;
  /** enabled=false でも同期する */
  force?: boolean;
}): Promise<NotionTableData[]> {
  let configs: SyncConfig[];

  if (options?.tableName) {
    // 特定テーブルのみ
    const config = await fetchConfigByName(options.tableName);
    if (!config) {
      throw new Error(`Config not found: ${options.tableName}`);
    }
    if (!config.enabled && !options.force) {
      throw new Error(`Config "${options.tableName}" is disabled. Use --force to sync anyway.`);
    }
    configs = [config];
  } else {
    // 全enabled設定
    configs = await fetchEnabledConfigs();
  }

  if (configs.length === 0) {
    log.warn("No configs to sync");
    return [];
  }

  const results: NotionTableData[] = [];

  for (const config of configs) {
    try {
      // 全件同期は常に全ページを取得
      const data = await fetchAllPages(config);
      results.push(data);

      // レート制限対策
      await sleep(500);
    } catch (err) {
      if (err instanceof NotionRateLimitError) {
        log.warn(`Rate limited. Waiting ${err.retryAfterSeconds}s...`);
        await sleep(err.retryAfterSeconds * 1000);
        // リトライ
        const retryData = await fetchAllPages(config);
        results.push(retryData);
      } else {
        log.error(`Failed to fetch "${config.name}": ${err instanceof Error ? err.message : err}`);
        throw err;
      }
    }
  }

  return results;
}
