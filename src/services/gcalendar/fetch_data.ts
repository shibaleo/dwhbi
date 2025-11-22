/**
 * Google Calendar API データ取得オーケストレーション
 *
 * API→DB変換とデータ取得のラッパー
 */

import { fetchEvents, getCalendarId, FetchEventsOptions } from "./api.ts";
import { transformEvents } from "./write_db.ts";
import type {
  GCalApiEvent,
  DbEvent,
  SyncOptions,
} from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

/** デフォルト開始日（Togglデータと合わせる） */
const DEFAULT_START_DATE = "2019-01-01T00:00:00+09:00";

// =============================================================================
// Fetch & Transform
// =============================================================================

/**
 * 現在時刻をISO 8601形式で取得
 */
function getNow(): string {
  return new Date().toISOString();
}

/**
 * 同期オプションを正規化
 */
function normalizeOptions(options?: SyncOptions): Required<Omit<SyncOptions, "calendarId">> & { calendarId: string } {
  return {
    timeMin: options?.timeMin ?? DEFAULT_START_DATE,
    timeMax: options?.timeMax ?? getNow(),
    calendarId: options?.calendarId ?? getCalendarId(),
  };
}

/**
 * イベントを取得してDB形式に変換
 */
export async function fetchAllEvents(options?: SyncOptions): Promise<{
  events: DbEvent[];
  raw: GCalApiEvent[];
}> {
  const normalizedOptions = normalizeOptions(options);
  
  console.log(`[INFO]     Fetching events from ${normalizedOptions.timeMin} to ${normalizedOptions.timeMax}`);
  
  const fetchOptions: FetchEventsOptions = {
    calendarId: normalizedOptions.calendarId,
    timeMin: normalizedOptions.timeMin,
    timeMax: normalizedOptions.timeMax,
  };
  
  const rawEvents = await fetchEvents(fetchOptions);
  const dbEvents = transformEvents(rawEvents, normalizedOptions.calendarId);
  
  return {
    events: dbEvents,
    raw: rawEvents,
  };
}

/**
 * 日数指定でイベントを取得
 * 日付範囲: days日前から今日までを取得
 */
export async function fetchEventsByDays(days: number, options?: Omit<SyncOptions, "timeMin" | "timeMax">): Promise<{
  events: DbEvent[];
  raw: GCalApiEvent[];
}> {
  // endDate = 明日（APIは排他的終点のため、今日を含めるには明日を指定）
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 1);

  // startDate = endDate - (days + 1)
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days - 1);
  
  return fetchAllEvents({
    ...options,
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
  });
}
