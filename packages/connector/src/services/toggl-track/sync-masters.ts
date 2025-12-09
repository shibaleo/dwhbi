/**
 * Toggl Track Master Data Sync
 *
 * Syncs projects, clients, tags, me, workspaces, users, groups.
 * All masters are fetched and saved in parallel.
 */

import { upsertRaw, RawRecord } from "../../db/raw-client.js";
import { setupLogger } from "../../lib/logger.js";
import {
  fetchProjects,
  fetchClients,
  fetchTags,
  fetchMe,
  fetchWorkspaces,
  fetchWorkspaceUsers,
  fetchWorkspaceGroups,
  getAuthInfo,
} from "./api-client.js";

const logger = setupLogger("toggl-masters");

const API_VERSION = "v9";

// Types
export interface MasterSyncResult {
  success: boolean;
  counts: Record<string, number>;
  elapsedSeconds: number;
}

/**
 * Convert API response to RawRecord list
 */
function toRawRecords(
  items: Record<string, unknown>[],
  idField: string = "id"
): RawRecord[] {
  return items.map((item) => ({
    sourceId: String(item[idField]),
    data: item,
  }));
}

async function syncProjects(): Promise<number> {
  const data = await fetchProjects();
  if (data.length === 0) return 0;
  const records = toRawRecords(data);
  const result = await upsertRaw("toggl_track__projects", records, API_VERSION);
  return result.total;
}

async function syncClients(): Promise<number> {
  const data = await fetchClients();
  if (data.length === 0) return 0;
  const records = toRawRecords(data);
  const result = await upsertRaw("toggl_track__clients", records, API_VERSION);
  return result.total;
}

async function syncTags(): Promise<number> {
  const data = await fetchTags();
  if (data.length === 0) return 0;
  const records = toRawRecords(data);
  const result = await upsertRaw("toggl_track__tags", records, API_VERSION);
  return result.total;
}

async function syncMe(): Promise<number> {
  const data = await fetchMe();
  if (!data || !data.id) return 0;
  const record: RawRecord = { sourceId: String(data.id), data };
  const result = await upsertRaw("toggl_track__me", [record], API_VERSION);
  return result.total;
}

async function syncWorkspaces(): Promise<number> {
  const data = await fetchWorkspaces();
  if (data.length === 0) return 0;
  const records = toRawRecords(data);
  const result = await upsertRaw("toggl_track__workspaces", records, API_VERSION);
  return result.total;
}

async function syncUsers(): Promise<number> {
  const data = await fetchWorkspaceUsers();
  if (data.length === 0) return 0;
  const records = toRawRecords(data);
  const result = await upsertRaw("toggl_track__users", records, API_VERSION);
  return result.total;
}

async function syncGroups(): Promise<number> {
  const data = await fetchWorkspaceGroups();
  if (data.length === 0) return 0;
  const records = toRawRecords(data);
  const result = await upsertRaw("toggl_track__groups", records, API_VERSION);
  return result.total;
}

/**
 * Sync all master data in parallel
 */
export async function syncMasters(): Promise<MasterSyncResult> {
  const startTime = performance.now();
  logger.info("Starting Toggl masters sync");

  try {
    // Warm up auth cache first to prevent parallel DB connections
    await getAuthInfo();

    // Fetch and save all masters in parallel
    const results = await Promise.allSettled([
      syncProjects(),
      syncClients(),
      syncTags(),
      syncMe(),
      syncWorkspaces(),
      syncUsers(),
      syncGroups(),
    ]);

    const masterNames = [
      "projects",
      "clients",
      "tags",
      "me",
      "workspaces",
      "users",
      "groups",
    ];
    const counts: Record<string, number> = {};
    const errors: string[] = [];

    for (let i = 0; i < masterNames.length; i++) {
      const name = masterNames[i];
      const result = results[i];

      if (result.status === "rejected") {
        logger.error(`Failed to sync ${name}: ${result.reason}`);
        errors.push(`${name}: ${result.reason}`);
        counts[name] = 0;
      } else {
        counts[name] = result.value;
      }
    }

    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;

    // Log summary
    const countsStr = Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    logger.info(`Toggl masters sync completed in ${elapsed}s: ${countsStr}`);

    if (errors.length > 0) {
      logger.warn(`Some masters failed: ${errors.join(", ")}`);
    }

    return {
      success: errors.length === 0,
      counts,
      elapsedSeconds: elapsed,
    };
  } catch (error) {
    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    logger.error(`Toggl masters sync failed after ${elapsed}s: ${error}`);
    throw error;
  }
}
