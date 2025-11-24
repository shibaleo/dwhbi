/**
 * Toggl Track Supabase DB 書き込み
 *
 * raw スキーマへのデータ変換と upsert 処理
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as log from "../../utils/log.ts";
import type {
  TogglApiV9Client,
  TogglApiV9Project,
  TogglApiV9Tag,
  TogglApiV9TimeEntry,
  ReportsApiTimeEntry,
  DbClient,
  DbProject,
  DbTag,
  DbEntry,
} from "./types.ts";
import { getWorkspaceId } from "./auth.ts";

// =============================================================================
// Types
// =============================================================================

/** raw スキーマ用クライアント型 */
export type RawSchema = ReturnType<SupabaseClient["schema"]>;

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
 * raw スキーマ専用の Supabase クライアントを作成
 */
export function createTogglDbClient(): RawSchema {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const supabase = createClient(url, key);
  return supabase.schema("raw");
}

// =============================================================================
// Transform Functions: API → DB Record
// =============================================================================

/**
 * API Client → DB Client
 */
export function toDbClient(client: TogglApiV9Client): DbClient {
  return {
    id: client.id,
    workspace_id: client.wid,
    name: client.name,
    is_archived: client.archived,
    created_at: client.at,
  };
}

/**
 * API Project → DB Project
 */
export function toDbProject(project: TogglApiV9Project): DbProject {
  return {
    id: project.id,
    workspace_id: project.workspace_id,
    client_id: project.client_id ?? null,
    name: project.name,
    color: project.color ?? null,
    is_private: project.is_private,
    is_active: project.active,
    is_billable: project.billable ?? false,
    created_at: project.created_at,
    archived_at: project.server_deleted_at ?? null,
    estimated_hours: project.estimated_hours ?? null,
    estimated_seconds: project.estimated_seconds ?? null,
    rate: project.rate ?? null,
    rate_last_updated: project.rate_last_updated ?? null,
    currency: project.currency ?? null,
    is_template: project.template ?? false,
    template_id: project.template_id ?? null,
    auto_estimates: project.auto_estimates ?? null,
    recurring: project.recurring ?? false,
    recurring_parameters: project.recurring_parameters ?? null,
    fixed_fee: project.fixed_fee ?? null,
    can_track_time: project.can_track_time ?? true,
    start_date: project.start_date ?? null,
  };
}

/**
 * API Tag → DB Tag
 */
export function toDbTag(tag: TogglApiV9Tag): DbTag {
  return {
    id: tag.id,
    workspace_id: tag.workspace_id,
    name: tag.name,
    created_at: tag.at,
  };
}

/**
 * API Time Entry → DB Entry
 * 
 * 実行中エントリー（duration < 0）も保存する。
 * 実行中の場合: end = null, duration_ms = null
 * stagingビューで動的にCURRENT_TIMESTAMPを補完する。
 */
export function toDbEntry(entry: TogglApiV9TimeEntry): DbEntry {
  const isRunning = entry.duration < 0;

  return {
    id: entry.id,
    workspace_id: entry.workspace_id,
    project_id: entry.project_id ?? null,
    task_id: entry.task_id ?? null,
    user_id: entry.user_id,
    description: entry.description ?? null,
    start: entry.start,
    end: isRunning ? null : (entry.stop ?? entry.start),
    duration_ms: isRunning ? null : entry.duration * 1000,
    is_billable: entry.billable,
    billable_amount: null,
    currency: null,
    tags: entry.tags ?? [],
    updated_at: entry.at,
  };
}

/**
 * Reports API Time Entry → DB Entry
 *
 * Reports API v3 のレスポンスをDB形式に変換
 * Note: Reports APIは time_entries 配列内に実際のデータがある
 * - id, start, stop, seconds は time_entries[0] から取得
 * - project_id, description などはトップレベルから取得
 *
 * @param entry Reports APIのエントリー
 * @param workspaceId ワークスペースID
 */
export function reportsEntryToDbEntry(entry: ReportsApiTimeEntry, workspaceId: number): DbEntry | null {
  // time_entries 配列が空の場合はスキップ
  if (!entry.time_entries || entry.time_entries.length === 0) {
    return null;
  }

  const timeEntry = entry.time_entries[0];

  // 負の時間（実行中）はスキップ
  if (timeEntry.seconds < 0) {
    return null;
  }

  return {
    id: timeEntry.id,
    workspace_id: workspaceId,
    project_id: entry.project_id ?? null,
    task_id: entry.task_id ?? null,
    user_id: entry.user_id,
    description: entry.description ?? null,
    start: timeEntry.start,
    end: timeEntry.stop,
    duration_ms: timeEntry.seconds * 1000,
    is_billable: entry.billable,
    billable_amount: entry.billable_amount_in_cents ? entry.billable_amount_in_cents / 100 : null,
    currency: entry.currency ?? null,
    tags: entry.tags ?? [],
    updated_at: timeEntry.at,
  };
}

// =============================================================================
// Batch Upsert
// =============================================================================

/**
 * バッチ upsert
 */
async function upsertBatch<T extends object>(
  raw: RawSchema,
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

    const { error } = await raw
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
 * クライアントを upsert
 */
export async function upsertClients(
  raw: RawSchema,
  clients: TogglApiV9Client[],
): Promise<UpsertResult> {
  const records = clients.map(toDbClient);
  log.info(`Saving clients... (${records.length} records)`);

  const result = await upsertBatch(raw, "toggl_clients", records, "id");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * プロジェクトを upsert
 */
export async function upsertProjects(
  raw: RawSchema,
  projects: TogglApiV9Project[],
): Promise<UpsertResult> {
  const records = projects.map(toDbProject);
  log.info(`Saving projects... (${records.length} records)`);

  const result = await upsertBatch(raw, "toggl_projects", records, "id");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * タグを upsert
 */
export async function upsertTags(
  raw: RawSchema,
  tags: TogglApiV9Tag[],
): Promise<UpsertResult> {
  const records = tags.map(toDbTag);
  log.info(`Saving tags... (${records.length} records)`);

  const result = await upsertBatch(raw, "toggl_tags", records, "id");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * エントリーを upsert
 * 実行中エントリーも含めて保存する
 */
export async function upsertEntries(
  raw: RawSchema,
  entries: TogglApiV9TimeEntry[],
): Promise<UpsertResult> {
  const records = entries.map(toDbEntry);

  log.info(`Saving entries... (${records.length} records)`);

  const result = await upsertBatch(raw, "toggl_entries", records, "id");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * Reports API からのエントリーを upsert
 */
export async function upsertEntriesFromReports(
  raw: RawSchema,
  entries: ReportsApiTimeEntry[],
): Promise<UpsertResult> {
  // workspaceIdを取得
  const workspaceIdStr = await getWorkspaceId();
  const workspaceId = parseInt(workspaceIdStr, 10);

  const records = entries
    .map((entry) => reportsEntryToDbEntry(entry, workspaceId))
    .filter((entry): entry is DbEntry => entry !== null);

  log.info(`Saving entries from Reports API... (${records.length} records)`);

  const result = await upsertBatch(raw, "toggl_entries", records, "id");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

// =============================================================================
// High-level Helpers
// =============================================================================

/**
 * メタデータ（clients, projects, tags）を並列 upsert
 */
export async function upsertMetadata(
  raw: RawSchema,
  clients: TogglApiV9Client[],
  projects: TogglApiV9Project[],
  tags: TogglApiV9Tag[],
): Promise<{ clients: UpsertResult; projects: UpsertResult; tags: UpsertResult }> {
  const [clientsResult, projectsResult, tagsResult] = await Promise.all([
    upsertClients(raw, clients),
    upsertProjects(raw, projects),
    upsertTags(raw, tags),
  ]);

  return {
    clients: clientsResult,
    projects: projectsResult,
    tags: tagsResult,
  };
}
