// types.ts - Toggl API型定義・DB型定義

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
  at: string;
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
  recurring_parameters?: unknown | null;
  fixed_fee?: number | null;
  can_track_time?: boolean;
  start_date?: string;
  permissions?: string;
  pinned?: boolean;
}

/**
 * Toggl API v9 - Tag response
 * GET /api/v9/workspaces/{workspace_id}/tags
 */
export interface TogglApiV9Tag {
  id: number;
  workspace_id: number;
  name: string;
  at: string;
  creator_id?: number;
}

/**
 * Toggl API v9 - Time Entry response
 * GET /api/v9/me/time_entries
 */
export interface TogglApiV9TimeEntry {
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

// =====================================================
// Database Table Types (toggl スキーマ)
// =====================================================

/**
 * toggl.clients テーブル
 */
export interface DbClient {
  id: number;
  workspace_id: number;
  name: string;
  is_archived: boolean;
  created_at: string;
}

/**
 * toggl.projects テーブル
 */
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

/**
 * toggl.tags テーブル
 */
export interface DbTag {
  id: number;
  workspace_id: number;
  name: string;
  created_at: string;
}

/**
 * toggl.entries テーブル
 */
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

// =====================================================
// Sync Result Types
// =====================================================

export interface SyncStats {
  clients: number;
  projects: number;
  tags: number;
  entries: number;
}

export interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: SyncStats;
  elapsedSeconds: number;
  error?: string;
}
