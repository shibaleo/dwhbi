/**
 * Notion データの Supabase 書き込み
 *
 * 動的テーブルへのデータ変換と upsert/truncate+insert 処理
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as log from "../../utils/log.ts";
import type {
  SyncConfig,
  NotionApiPage,
  NotionApiPropertySchema,
  NotionTableData,
  DbRecord,
  TableSyncStats,
} from "./types.ts";
import {
  propertyNameToColumn,
  extractPropertyValue,
} from "./type_mapping.ts";

// =============================================================================
// Types
// =============================================================================

/** Notion スキーマ用クライアント型 */
export type NotionSchema = ReturnType<SupabaseClient["schema"]>;

/** upsert 結果 */
export interface UpsertResult {
  success: number;
  failed: number;
}

// =============================================================================
// Constants
// =============================================================================

const BATCH_SIZE = 1000;

// =============================================================================
// Client Factory
// =============================================================================

/**
 * 指定スキーマの Supabase クライアントを作成
 */
export function createNotionDbClient(schema: string = "notion"): NotionSchema {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const supabase = createClient(url, key);
  return supabase.schema(schema);
}

// =============================================================================
// Transform Functions: Notion Page → DB Record
// =============================================================================

/**
 * NotionページをDBレコードに変換
 */
export function transformPageToRecord(
  page: NotionApiPage,
  properties: Record<string, NotionApiPropertySchema>
): DbRecord {
  const record: DbRecord = {
    id: page.id,
    created_at: page.created_time,
    updated_at: page.last_edited_time,
  };

  for (const [propName, propSchema] of Object.entries(properties)) {
    const columnName = propertyNameToColumn(propName);

    // 共通カラムはスキップ（id, created_at, updated_at）
    if (["id", "created_at", "updated_at", "synced_at"].includes(columnName)) {
      continue;
    }

    const propValue = page.properties[propName];
    if (propValue) {
      record[columnName] = extractPropertyValue(propValue);
    }
  }

  return record;
}

/**
 * 複数のNotionページをDBレコードに変換
 */
export function transformPagesToRecords(
  pages: NotionApiPage[],
  properties: Record<string, NotionApiPropertySchema>
): DbRecord[] {
  return pages.map((page) => transformPageToRecord(page, properties));
}

// =============================================================================
// Batch Operations
// =============================================================================

/**
 * バッチ upsert
 */
async function upsertBatch(
  client: NotionSchema,
  table: string,
  records: DbRecord[],
): Promise<UpsertResult> {
  if (records.length === 0) {
    return { success: 0, failed: 0 };
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await client
      .from(table)
      .upsert(batch, { onConflict: "id" });

    if (error) {
      log.error(`${table} batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
      failed += batch.length;
    } else {
      success += batch.length;
    }
  }

  return { success, failed };
}

/**
 * TRUNCATE → INSERT（master同期用）
 *
 * Supabase JS SDK にはTRUNCATEがないため、DELETE + INSERT で代用
 */
async function truncateAndInsert(
  client: NotionSchema,
  table: string,
  records: DbRecord[],
): Promise<UpsertResult> {
  // 1. 既存データを削除
  const { error: deleteError } = await client
    .from(table)
    .delete()
    .neq("id", ""); // 全件削除（idがnullでない全レコード）

  if (deleteError) {
    log.error(`${table} delete failed: ${deleteError.message}`);
    return { success: 0, failed: records.length };
  }

  // 2. 新規データを挿入
  if (records.length === 0) {
    return { success: 0, failed: 0 };
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await client
      .from(table)
      .insert(batch);

    if (error) {
      log.error(`${table} insert batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
      failed += batch.length;
    } else {
      success += batch.length;
    }
  }

  return { success, failed };
}

// =============================================================================
// Table Sync Functions
// =============================================================================

/**
 * マスターテーブル同期（TRUNCATE → INSERT）
 */
export async function syncMasterTable(
  data: NotionTableData
): Promise<TableSyncStats> {
  const { config, pages, properties } = data;
  log.info(`Syncing master table "${config.name}" (${pages.length} pages)...`);

  const client = createNotionDbClient(config.supabaseSchema);
  const records = transformPagesToRecords(pages, properties);
  const result = await truncateAndInsert(client, config.supabaseTable, records);

  if (result.success > 0) {
    log.success(`  ${result.success} records saved`);
  }
  if (result.failed > 0) {
    log.error(`  ${result.failed} records failed`);
  }

  return {
    table: `${config.supabaseSchema}.${config.supabaseTable}`,
    fetched: pages.length,
    saved: result.success,
    failed: result.failed,
  };
}

/**
 * トランザクションテーブル同期（UPSERT）
 */
export async function syncTransactionTable(
  data: NotionTableData
): Promise<TableSyncStats> {
  const { config, pages, properties } = data;
  log.info(`Syncing transaction table "${config.name}" (${pages.length} pages)...`);

  const client = createNotionDbClient(config.supabaseSchema);
  const records = transformPagesToRecords(pages, properties);
  const result = await upsertBatch(client, config.supabaseTable, records);

  if (result.success > 0) {
    log.success(`  ${result.success} records saved`);
  }
  if (result.failed > 0) {
    log.error(`  ${result.failed} records failed`);
  }

  return {
    table: `${config.supabaseSchema}.${config.supabaseTable}`,
    fetched: pages.length,
    saved: result.success,
    failed: result.failed,
  };
}

/**
 * テーブルデータを同期（sync_typeに応じて処理を分岐）
 */
export async function syncTableData(data: NotionTableData): Promise<TableSyncStats> {
  if (data.config.syncType === "master") {
    return syncMasterTable(data);
  } else {
    return syncTransactionTable(data);
  }
}

/**
 * 複数テーブルのデータを同期
 */
export async function syncAllTableData(
  dataList: NotionTableData[]
): Promise<TableSyncStats[]> {
  const results: TableSyncStats[] = [];

  for (const data of dataList) {
    const stats = await syncTableData(data);
    results.push(stats);
  }

  return results;
}
