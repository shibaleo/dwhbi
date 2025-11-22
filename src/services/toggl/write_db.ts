/**
 * Toggl Track Supabase DB 書き込み
 *
 * toggl スキーマへのデータ変換と upsert 処理
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as log from "../../utils/log.ts";
import type {
  TogglApiV9Client,
  TogglApiV9Project,
  TogglApiV9Tag,
  TogglApiV9TimeEntry,
  DbClient,
  DbProject,
  DbTag,
  DbEntry,
} from "./types.ts";

// =============================================================================
// Types
// =============================================================================

/** toggl スキーマ用クライアント型 */
export type TogglSchema = ReturnType<SupabaseClient["schema"]>;

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
 * toggl スキーマ専用の Supabase クライアントを作成
 */
export function createTogglDbClient(): TogglSchema {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const supabase = createClient(url, key);
  return supabase.schema("toggl");
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
 * @returns null if entry is still running (negative duration)
 */
export function toDbEntry(entry: TogglApiV9TimeEntry): DbEntry | null {
  if (entry.duration < 0) {
    return null;
  }

  return {
    id: entry.id,
    workspace_id: entry.workspace_id,
    project_id: entry.project_id ?? null,
    task_id: entry.task_id ?? null,
    user_id: entry.user_id,
    description: entry.description ?? null,
    start: entry.start,
    end: entry.stop ?? entry.start,
    duration_ms: entry.duration * 1000,
    is_billable: entry.billable,
    billable_amount: null,
    currency: null,
    tags: entry.tags ?? [],
    updated_at: entry.at,
  };
}

// =============================================================================
// Batch Upsert
// =============================================================================

/**
 * バッチ upsert
 */
async function upsertBatch<T extends object>(
  toggl: TogglSchema,
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

    const { error } = await toggl
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
  toggl: TogglSchema,
  clients: TogglApiV9Client[],
): Promise<UpsertResult> {
  const records = clients.map(toDbClient);
  log.info(`Saving clients... (${records.length} records)`);

  const result = await upsertBatch(toggl, "clients", records, "id");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * プロジェクトを upsert
 */
export async function upsertProjects(
  toggl: TogglSchema,
  projects: TogglApiV9Project[],
): Promise<UpsertResult> {
  const records = projects.map(toDbProject);
  log.info(`Saving projects... (${records.length} records)`);

  const result = await upsertBatch(toggl, "projects", records, "id");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * タグを upsert
 */
export async function upsertTags(
  toggl: TogglSchema,
  tags: TogglApiV9Tag[],
): Promise<UpsertResult> {
  const records = tags.map(toDbTag);
  log.info(`Saving tags... (${records.length} records)`);

  const result = await upsertBatch(toggl, "tags", records, "id");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * エントリーを upsert
 */
export async function upsertEntries(
  toggl: TogglSchema,
  entries: TogglApiV9TimeEntry[],
): Promise<UpsertResult> {
  const records = entries
    .map(toDbEntry)
    .filter((entry): entry is DbEntry => entry !== null);

  log.info(`Saving entries... (${records.length} records)`);

  const result = await upsertBatch(toggl, "entries", records, "id");

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
  toggl: TogglSchema,
  clients: TogglApiV9Client[],
  projects: TogglApiV9Project[],
  tags: TogglApiV9Tag[],
): Promise<{ clients: UpsertResult; projects: UpsertResult; tags: UpsertResult }> {
  const [clientsResult, projectsResult, tagsResult] = await Promise.all([
    upsertClients(toggl, clients),
    upsertProjects(toggl, projects),
    upsertTags(toggl, tags),
  ]);

  return {
    clients: clientsResult,
    projects: projectsResult,
    tags: tagsResult,
  };
}
