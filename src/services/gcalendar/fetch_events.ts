/**
 * Google Calendar イベント取得・変換
 * 
 * API→DB変換とデータ取得のラッパー
 */

import { fetchEvents, getCalendarId, FetchEventsOptions } from "./api.ts";
import {
  GCalApiEvent,
  DbEvent,
  SyncOptions,
} from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

/** デフォルト開始日（Togglデータと合わせる） */
const DEFAULT_START_DATE = "2019-01-01T00:00:00+09:00";

/** JSTタイムゾーンオフセット */
const JST_OFFSET = "+09:00";

// =============================================================================
// Transform Functions
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
