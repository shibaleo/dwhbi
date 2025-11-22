/**
 * Google Calendar DB 書き込み
 *
 * gcalendar スキーマへのデータ変換と upsert 処理
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as log from "../../utils/log.ts";
import type { DbEvent } from "./types.ts";

// =============================================================================
// Types
// =============================================================================

/** gcalendar スキーマ用クライアント型 */
export type GCalendarSchema = ReturnType<SupabaseClient["schema"]>;

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
 * gcalendar スキーマ専用の Supabase クライアントを作成
 */
export function createGCalendarDbClient(): GCalendarSchema {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const supabase = createClient(url, key);
  return supabase.schema("gcalendar");
}

// =============================================================================
// Batch Upsert
// =============================================================================

/**
 * バッチ upsert
 */
async function upsertBatch<T extends object>(
  gcalendar: GCalendarSchema,
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

    const { error } = await gcalendar
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
// Upsert Functions
// =============================================================================

/**
 * イベントを一括 upsert
 */
export async function upsertEvents(
  gcalendar: GCalendarSchema,
  events: DbEvent[],
): Promise<UpsertResult> {
  log.info(`Saving events... (${events.length} records)`);

  const result = await upsertBatch(gcalendar, "events", events, "id");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * キャンセルされたイベントのステータスを更新
 */
export async function markCancelledEvents(
  gcalendar: GCalendarSchema,
  existingIds: string[],
  fetchedIds: Set<string>,
): Promise<number> {
  const missingIds = existingIds.filter((id) => !fetchedIds.has(id));

  if (missingIds.length === 0) {
    return 0;
  }

  log.info(`Marking cancelled events... (${missingIds.length} records)`);

  const { error, count } = await gcalendar
    .from("events")
    .update({ status: "cancelled" })
    .in("id", missingIds)
    .neq("status", "cancelled");

  if (error) {
    log.error(`Failed to mark cancelled events: ${error.message}`);
    return 0;
  }

  const updatedCount = count ?? 0;
  if (updatedCount > 0) {
    log.success(`${updatedCount} events marked as cancelled`);
  }

  return updatedCount;
}

/**
 * 指定期間のイベント ID を取得
 */
export async function getExistingEventIds(
  gcalendar: GCalendarSchema,
  timeMin: string,
  timeMax: string,
): Promise<string[]> {
  const { data, error } = await gcalendar
    .from("events")
    .select("id")
    .gte("start_time", timeMin)
    .lte("start_time", timeMax);

  if (error) {
    log.error(`Failed to get existing event IDs: ${error.message}`);
    return [];
  }

  return (data ?? []).map((row: { id: string }) => row.id);
}
