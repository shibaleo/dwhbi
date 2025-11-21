// types.ts - Normalized schema types for Toggl data

// =====================================================
// Database Table Types (正規化版)
// =====================================================

/**
 * toggl_clients_new テーブルの型
 */
export interface TogglClient {
  id: number;
  workspace_id: number;
  name: string;
  is_archived: boolean;
  created_at: string; // ISO 8601 timestamp
  synced_at: string;
}

/**
 * toggl_projects_new テーブルの型
 */
export interface TogglProject {
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
  recurring_parameters: any | null; // JSONB
  fixed_fee: number | null;
  can_track_time: boolean;
  start_date: string | null; // ISO date format (YYYY-MM-DD)
  synced_at: string;
}

/**
 * toggl_time_entries_new テーブルの型
 */
export interface TogglTimeEntry {
  id: number;
  workspace_id: number;
  project_id: number | null;
  task_id: number | null;
  user_id: number | null;
  description: string | null;
  start: string; // ISO 8601 timestamp
  end: string; // ISO 8601 timestamp
  duration_ms: number;
  is_billable: boolean;
  billable_amount: number | null;
  currency: string | null;
  tags: string[];
  updated_at: string | null;
  synced_at: string;
}

// =====================================================
// Toggl API v9 Response Types
// =====================================================

/**
 * Toggl API v9 - Client response
 * GET /api/v9/workspaces/{workspace_id}/clients
 */
export interface TogglApiV9Client {
  id: number;
  wid: number;
  archived: boolean;
  name: string;
  at: string; // timestamp
  creator_id?: number;
  permissions?: string;
}

/**
 * Toggl API v9 - Project response
 * GET /api/v9/workspaces/{workspace_id}/projects
 */
export interface TogglApiV9Project {
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
  recurring_parameters?: any | null;
  fixed_fee?: number | null;
  can_track_time?: boolean;
  start_date?: string;
  permissions?: string;
  pinned?: boolean;
}

/**
 * Toggl API v9 - Time Entry response
 * GET /api/v9/me/time_entries
 * GET /api/v9/me/time_entries/current
 */
export interface TogglApiV9TimeEntry {
  id: number;
  workspace_id: number;
  project_id?: number | null;
  task_id?: number | null;
  billable: boolean;
  start: string; // ISO 8601 timestamp
  stop?: string | null; // ISO 8601 timestamp (null for running entries)
  duration: number; // seconds (negative for running entries)
  description?: string;
  tags?: string[];
  tag_ids?: number[];
  duronly: boolean;
  at: string; // last update timestamp
  server_deleted_at?: string | null;
  user_id: number;
  uid: number;
  wid: number;
  pid?: number | null;
  tid?: number | null;
}

// =====================================================
// Transformation Helper Types
// =====================================================

/**
 * API v9データをDBスキーマに変換する際の中間型
 */
export interface TimeEntryTransformInput {
  apiEntry: TogglApiV9TimeEntry;
  workspaceId: number;
}

/**
 * クライアント変換用の入力型
 */
export interface ClientTransformInput {
  apiClient: TogglApiV9Client;
}

/**
 * プロジェクト変換用の入力型
 */
export interface ProjectTransformInput {
  apiProject: TogglApiV9Project;
}

// =====================================================
// Utility Types
// =====================================================

/**
 * DB挿入用の型（synced_atを除く）
 */
export type TogglClientInsert = Omit<TogglClient, 'synced_at'>;
export type TogglProjectInsert = Omit<TogglProject, 'synced_at'>;
export type TogglTimeEntryInsert = Omit<TogglTimeEntry, 'synced_at'>;

/**
 * 日付範囲指定用の型
 */
export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * ページネーション用の型
 */
export interface PaginationParams {
  page?: number;
  per_page?: number;
}