/**
 * Google Calendar 型定義
 *
 * API レスポンス型、DB テーブル型、同期関連型
 */

// =============================================================================
// Google Calendar API Response Types
// =============================================================================

/**
 * Google Calendar API v3 Event レスポンス型
 * @see https://developers.google.com/calendar/api/v3/reference/events
 */
export interface GCalendarApiEvent {
  id: string;
  etag?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  htmlLink?: string;
  created?: string;
  updated?: string;
  summary?: string;
  description?: string;
  colorId?: string;
  recurringEventId?: string;
  start: GCalendarApiDateTime;
  end: GCalendarApiDateTime;
}

/**
 * Google Calendar API DateTime 型
 * 通常イベント: dateTime が設定される
 * 終日イベント: date が設定される
 */
export interface GCalendarApiDateTime {
  date?: string;        // YYYY-MM-DD（終日イベント）
  dateTime?: string;    // ISO 8601（通常イベント）
  timeZone?: string;
}

/**
 * Google Calendar API Events.list レスポンス型
 */
export interface GCalendarApiEventsListResponse {
  kind: "calendar#events";
  etag: string;
  summary?: string;
  updated?: string;
  timeZone?: string;
  accessRole?: string;
  nextPageToken?: string;
  nextSyncToken?: string;
  items: GCalendarApiEvent[];
}

// =============================================================================
// Auth Types
// =============================================================================

/**
 * Google Service Account Credentials
 */
export interface ServiceAccountCredentials {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

/**
 * JWT Token レスポンス
 */
export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: "Bearer";
}

// =============================================================================
// Database Table Types (gcalendar schema)
// =============================================================================

/**
 * gcalendar.events テーブル型
 */
export interface DbEvent {
  id: string;
  calendar_id: string;
  summary: string | null;
  description: string | null;
  start_time: string;         // ISO 8601 TIMESTAMPTZ
  end_time: string;           // ISO 8601 TIMESTAMPTZ
  // duration_ms は GENERATED ALWAYS なので書き込み時は不要
  is_all_day: boolean;
  color_id: string | null;
  status: string | null;
  recurring_event_id: string | null;
  etag: string | null;
  updated: string | null;
  // synced_at はトリガーで自動設定
}

/**
 * gcalendar.events テーブル読み取り型（duration_ms含む）
 */
export interface DbEventRead extends DbEvent {
  duration_ms: number;
  synced_at: string;
}

// =============================================================================
// Fetch Options & Data Types
// =============================================================================

/**
 * データ取得オプション
 */
export interface FetchOptions {
  /** 開始日時（ISO 8601） */
  timeMin?: string;
  /** 終了日時（ISO 8601） */
  timeMax?: string;
  /** カレンダーID（デフォルト: 環境変数から取得） */
  calendarId?: string;
}

/**
 * 取得データ（fetch_data.ts の出力）
 */
export interface GCalendarData {
  events: DbEvent[];
  calendarId: string;
}

// =============================================================================
// Sync Result Types
// =============================================================================

/**
 * 同期統計
 */
export interface SyncStats {
  /** 取得したイベント数 */
  fetched: number;
  /** upsertしたイベント数 */
  upserted: number;
  /** スキップしたイベント数（キャンセル済み等） */
  skipped: number;
}

/**
 * 同期結果
 */
export interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: SyncStats;
  elapsedSeconds: number;
  errors: string[];
}

// =============================================================================
// Type Aliases (後方互換性のため)
// =============================================================================

/** @deprecated Use FetchOptions instead */
export type SyncOptions = FetchOptions;
/** @deprecated Use GCalendarApiEvent instead */
export type GCalApiEvent = GCalendarApiEvent;
/** @deprecated Use GCalendarApiDateTime instead */
export type GCalDateTime = GCalendarApiDateTime;
/** @deprecated Use GCalendarApiEventsListResponse instead */
export type GCalEventsListResponse = GCalendarApiEventsListResponse;
