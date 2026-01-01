/**
 * GitHub Contents Connector - Orchestrator
 *
 * Manages database connection lifecycle for sync operations.
 * Token and config are provided by the caller (Console API).
 */

import { getDbClient, closeDbClient } from "../../db/raw-client.js";
import { setupLogger } from "../../lib/logger.js";
import { DocumentSyncer } from "./sync.js";
import type { SyncConfig, SyncResult } from "./types.js";

const logger = setupLogger("github-contents-orchestrator");

/**
 * Sync options provided by Console API
 */
export interface SyncOptions {
  token: string;
  owner: string;
  repo: string;
  path: string;
}

/**
 * Sync documents from GitHub to database
 *
 * @param options - Token and sync configuration (provided by Console API from vault)
 */
export async function syncDocs(options: SyncOptions): Promise<SyncResult> {
  const { token, owner, repo, path } = options;

  if (!token) {
    throw new Error("GitHub token is required");
  }
  if (!owner || !repo || !path) {
    throw new Error("owner, repo, and path are required");
  }

  const syncConfig: SyncConfig = { owner, repo, path };
  const startTime = performance.now();

  logger.info(`Starting sync: ${owner}/${repo}/${path}`);

  try {
    await getDbClient();

    const syncer = new DocumentSyncer(token, syncConfig);
    const result = await syncer.sync();

    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    logger.info(`Sync completed in ${elapsed}s`);

    return result;
  } finally {
    await closeDbClient();
  }
}
