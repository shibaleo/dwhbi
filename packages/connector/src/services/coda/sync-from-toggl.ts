/**
 * Sync Toggl Projects to Coda
 *
 * Fetches projects from Toggl Track API and upserts to Coda mst_toggl_projects table.
 * Uses toggl_project_id as the upsert key to handle project renames.
 */

import { setupLogger } from "../../lib/logger.js";
import { fetchProjects, getAuthInfo as getTogglAuthInfo } from "../toggl-track/api-client.js";
import { fetchTableRows, upsertRows, deleteRow, getAuthInfo } from "./api-client.js";

const logger = setupLogger("coda-sync-toggl");

// Coda table config
const CODA_DOC_ID = "otJmZmksOC";
const MST_TOGGL_PROJECTS_TABLE_ID = "grid-LxGswbLt-q";

// Column IDs for mst_toggl_projects
const COLUMNS = {
  toggl_project_id: "c-3iijRJICjQ",
  name: "c-nh7mmMbutT",
  name_ja: "c-nr8vyhxnFU",
  description: "c-BJ6gWKxqq9",
  color: "c-g83dMFucN3",
  client: "c-zInesrGdQm",
};

export interface SyncResult {
  success: boolean;
  upserted: number;
  deleted: number;
  elapsedSeconds: number;
}

/**
 * Sync Toggl projects to Coda mst_toggl_projects table
 */
export async function syncTogglProjects(): Promise<SyncResult> {
  const startTime = performance.now();
  logger.info("Starting Toggl projects sync to Coda");

  try {
    // Warm up auth caches
    await Promise.all([getAuthInfo(), getTogglAuthInfo()]);

    // Fetch Toggl projects
    logger.debug("Fetching Toggl projects...");
    const togglProjects = await fetchProjects();
    logger.info(`Found ${togglProjects.length} Toggl projects`);

    // Fetch existing Coda rows
    logger.debug("Fetching existing Coda rows...");
    const existingRows = await fetchTableRows(CODA_DOC_ID, MST_TOGGL_PROJECTS_TABLE_ID);
    logger.info(`Found ${existingRows.length} existing Coda rows`);

    // Build maps
    const togglProjectIds = new Set(togglProjects.map((p) => p.id as number));
    const existingByTogglId = new Map<number, { rowId: string; name: string }>();

    for (const row of existingRows) {
      const togglId = row.values[COLUMNS.toggl_project_id] as number | undefined;
      if (togglId) {
        const nameValue = (row.values[COLUMNS.name] as string) || "";
        const name = nameValue.replace(/^```|```$/g, "");
        existingByTogglId.set(togglId, { rowId: row.id, name });
      }
    }

    // Build upsert rows
    const rowsToUpsert = togglProjects.map((project) => ({
      cells: [
        { column: COLUMNS.toggl_project_id, value: project.id as number },
        { column: COLUMNS.name, value: project.name as string },
        { column: COLUMNS.color, value: (project.color as string) || "" },
      ],
    }));

    // Upsert rows
    if (rowsToUpsert.length > 0) {
      logger.debug(`Upserting ${rowsToUpsert.length} rows to Coda...`);
      await upsertRows(
        CODA_DOC_ID,
        MST_TOGGL_PROJECTS_TABLE_ID,
        rowsToUpsert,
        [COLUMNS.toggl_project_id]
      );
    }

    // Find and delete orphan rows
    const rowsToDelete: { rowId: string; name: string }[] = [];
    for (const [togglId, row] of existingByTogglId) {
      if (!togglProjectIds.has(togglId)) {
        rowsToDelete.push(row);
      }
    }

    if (rowsToDelete.length > 0) {
      logger.debug(`Deleting ${rowsToDelete.length} orphan rows from Coda...`);
      for (const row of rowsToDelete) {
        logger.debug(`  Deleting: ${row.name}`);
        await deleteRow(CODA_DOC_ID, MST_TOGGL_PROJECTS_TABLE_ID, row.rowId);
      }
    }

    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    logger.info(
      `Toggl projects sync completed in ${elapsed}s: ${rowsToUpsert.length} upserted, ${rowsToDelete.length} deleted`
    );

    return {
      success: true,
      upserted: rowsToUpsert.length,
      deleted: rowsToDelete.length,
      elapsedSeconds: elapsed,
    };
  } catch (error) {
    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    logger.error(`Toggl projects sync failed after ${elapsed}s: ${error}`);
    throw error;
  }
}
