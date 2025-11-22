/**
 * Toggl Track 型定義
 *
 * API レスポンス型、DB テーブル型、同期関連型
 */

import { QuotaExceededError, RateLimitError } from "../../utils/errors.ts";

// =============================================================================
// Error Types
// =============================================================================

/**
 * Reports API v3 クォータ超過エラー（402 Payment Required）
 */
export class ReportsApiQuotaError extends QuotaExceededError {
  constructor(resetsInSeconds: number, message?: string) {
    super(resetsInSeconds, message ?? `API quota exceeded. Resets in ${resetsInSeconds} seconds.`);
    this.name = "ReportsApiQuotaError";
  }
}

/**
 * Reports API v3 レート制限エラー（429 Too Many Requests）
 */
export class ReportsApiRateLimitError extends RateLimitError {
  constructor(retryAfterSeconds: number = 60, message?: string) {
    super(retryAfterSeconds, message ?? "Rate limit exceeded (429). Please wait and retry.");
    this.name = "ReportsApiRateLimitError";
  }
}

// =============================================================================
// Toggl API Response Types (v9)
// =============================================================================

/**
 * Toggl API v9 - Client レスポンス
 * GET /api/v9/workspaces/{workspace_id}/clients
 */
export interface TogglApiClient {
  id: number;
  wid: number;
  archived: boolean;
  name: string;
  at: string;
  creator_id?: number;
  permissions?: string;
}

/**
 * Toggl API v9 - Project レスポンス
 * GET /api/v9/workspaces/{workspace_id}/projects
 */
export interface TogglApiProject {
  id: number;
  workspace_id: number;
  client_id?: number | null;
  name: string;
  is_private: boolean;
  active: boolean;
  at: string;
  created_at: string;
  server_deleted_at?: string | null;
  color: string;
  billable?: boolean;
  template?: boolean;
  auto_estimates?: boolean | null;
  estimated_hours?: number | null;
  estimated_seconds?: number | null;
  rate?: number | null;
  rate_last_updated?: string | null;
  currency?: string | null;
  recurring?: boolean;
  template_id?: number | null;
  recurring_parameters?: unknown | null;
  fixed_fee?: number | null;
  can_track_time?: boolean;
  start_date?: string;
  permissions?: string;
  pinned?: boolean;
}

/**
 * Toggl API v9 - Tag レスポンス
 * GET /api/v9/workspaces/{workspace_id}/tags
 */
export interface TogglApiTag {
  id: number;
  workspace_id: number;
  name: string;
  at: string;
  creator_id?: number;
}

/**
 * Toggl API v9 - Time Entry レスポンス
 * GET /api/v9/me/time_entries
 */
export interface TogglApiTimeEntry {
  id: number;
  workspace_id: number;
  project_id?: number | null;
  task_id?: number | null;
  billable: boolean;
  start: string;
  stop?: string | null;
  duration: number; // seconds (negative for running entries)
  description?: string;
  tags?: string[];
  tag_ids?: number[];
  duronly: boolean;
  at: string;
  server_deleted_at?: string | null;
  user_id: number;
  uid: number;
  wid: number;
  pid?: number | null;
  tid?: number | null;
}

// =============================================================================
// Database Table Types (toggl schema)
// =============================================================================

/** toggl.clients テーブル */
export interface DbClient {
  id: number;
  workspace_id: number;
  name: string;
  is_archived: boolean;
  created_at: string;
}

/** toggl.projects テーブル */
export interface DbProject {
  id: number;
  workspace_id: number;
  client_id: number | null;
  name: string;
  color: string | null;
  is_private: boolean;
  is_active: boolean;
  is_billable: boolean;
  created_at: string;
  archived_at: string | null;
  estimated_hours: number | null;
  estimated_seconds: number | null;
  rate: number | null;
  rate_last_updated: string | null;
  currency: string | null;
  is_template: boolean;
  template_id: number | null;
  auto_estimates: boolean | null;
  recurring: boolean;
  recurring_parameters: unknown | null;
  fixed_fee: number | null;
  can_track_time: boolean;
  start_date: string | null;
}

/** toggl.tags テーブル */
export interface DbTag {
  id: number;
  workspace_id: number;
  name: string;
  created_at: string;
}

/** toggl.entries テーブル */
export interface DbEntry {
  id: number;
  workspace_id: number;
  project_id: number | null;
  task_id: number | null;
  user_id: number | null;
  description: string | null;
  start: string;
  end: string;
  duration_ms: number;
  is_billable: boolean;
  billable_amount: number | null;
  currency: string | null;
  tags: string[];
  updated_at: string | null;
}

// =============================================================================
// Fetch Options & Data Types
// =============================================================================

/** データ取得オプション */
export interface FetchOptions {
  startDate?: Date;
  endDate?: Date;
}

/** 取得データ（fetch_data.ts の出力） */
export interface TogglData {
  clients: TogglApiClient[];
  projects: TogglApiProject[];
  tags: TogglApiTag[];
  entries: TogglApiTimeEntry[];
}

// =============================================================================
// Sync Result Types
// =============================================================================

/** 同期統計 */
export interface SyncStats {
  clients: number;
  projects: number;
  tags: number;
  entries: number;
}

/** 同期結果 */
export interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: SyncStats;
  elapsedSeconds: number;
  errors: string[];
}

// =============================================================================
// Toggl Reports API v3 Types
// =============================================================================

/**
 * Reports API v3 - Detailed Report リクエストボディ
 * POST /reports/api/v3/workspace/{workspace_id}/search/time_entries
 */
export interface ReportsApiSearchRequest {
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  page_size?: number; // default 50, max 1000
  first_row_number?: number; // pagination cursor
  first_id?: number; // pagination cursor (deprecated in favor of first_row_number)
  first_timestamp?: number; // pagination cursor
  order_by?: "date" | "user" | "duration" | "description" | "last_update";
  order_dir?: "ASC" | "DESC";
  enrich_response?: boolean; // default false, returns more info if true
  grouped?: boolean; // default false
  hide_amounts?: boolean;
  user_ids?: number[];
  project_ids?: (number | null)[];
  client_ids?: (number | null)[];
  tag_ids?: (number | null)[];
  task_ids?: (number | null)[];
  time_entry_ids?: number[];
  description?: string;
  billable?: boolean;
  rounding?: number;
  rounding_minutes?: number;
  min_duration_seconds?: number;
  max_duration_seconds?: number;
}

/**
 * Reports API v3 - Time Entry レスポンス
 *
 * Note: フィールド名とデータ形式はv9 APIとは異なる
 * - time_entries配列内にid, start, stop, secondsがある
 * - トップレベルにはuser_id, project_id, descriptionなど
 */
export interface ReportsApiTimeEntry {
  // 基本フィールド（トップレベル）
  user_id: number;
  username?: string;
  project_id?: number | null;
  task_id?: number | null;
  billable: boolean;
  description?: string;
  tag_ids?: number[];
  tags?: string[];
  row_number?: number;

  // 課金情報
  billable_amount_in_cents?: number | null;
  hourly_rate_in_cents?: number | null;
  currency?: string;

  // 時間エントリー配列（実際のデータはここにある）
  time_entries: {
    id: number;
    seconds: number;
    start: string; // ISO 8601
    stop: string;  // ISO 8601
    at: string;    // 更新日時
    at_tz?: string;
  }[];

  // 後方互換性のためのオプショナルフィールド（旧形式）
  id?: number;
  start?: string;
  end?: string;
  dur?: number;
  seconds?: number;
  at?: string;
}

/**
 * Reports API v3 - Detailed Report レスポンス
 */
export interface ReportsApiDetailedResponse {
  // 配列形式で返される（grouped=falseの場合）
  // grouped=trueの場合は異なる構造
}

/**
 * Reports API v3 ページネーション用ヘッダー
 */
export interface ReportsApiPaginationHeaders {
  xNextId?: string;
  xNextRowNumber?: string;
  xNextTimestamp?: string;
}

// =============================================================================
// Type Aliases (後方互換性のため)
// =============================================================================

/** @deprecated Use TogglApiClient instead */
export type TogglApiV9Client = TogglApiClient;
/** @deprecated Use TogglApiProject instead */
export type TogglApiV9Project = TogglApiProject;
/** @deprecated Use TogglApiTag instead */
export type TogglApiV9Tag = TogglApiTag;
/** @deprecated Use TogglApiTimeEntry instead */
export type TogglApiV9TimeEntry = TogglApiTimeEntry;
