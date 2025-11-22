/**
 * Google Calendar DB 書き込み
 *
 * gcalendar スキーマへのデータ変換と upsert 処理
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as log from "../../utils/log.ts";
import type { DbEvent, GCalApiEvent } from "./types.ts";

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

/** JSTタイムゾーンオフセット */
const JST_OFFSET = "+09:00";

// =============================================================================
// Transform Functions (API → DB)
// =============================================================================

/**
 * Google Calendar API レスポンスを DB レコードに変換
 *
 * 終日イベントと通常イベントで異なるフィールドを統一形式に変換
 */
export function transformEvent(event: GCalApiEvent, calendarId: string): DbEvent {
  // 終日イベントの場合は date を TIMESTAMPTZ に変換
  const startTime = event.start.dateTime
    ?? `${event.start.date}T00:00:00${JST_OFFSET}`;
  const endTime = event.end.dateTime
    ?? `${event.end.date}T00:00:00${JST_OFFSET}`;
  const isAllDay = !event.start.dateTime;

  return {
    id: event.id,
    calendar_id: calendarId,
    summary: event.summary ?? null,
    description: event.description ?? null,
    start_time: startTime,
    end_time: endTime,
    is_all_day: isAllDay,
    color_id: event.colorId ?? null,
    status: event.status ?? null,
    recurring_event_id: event.recurringEventId ?? null,
    etag: event.etag ?? null,
    updated: event.updated ?? null,
  };
}

/**
 * 複数のイベントを一括変換
 */
export function transformEvents(events: GCalApiEvent[], calendarId: string): DbEvent[] {
  return events.map(event => transformEvent(event, calendarId));
}

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
