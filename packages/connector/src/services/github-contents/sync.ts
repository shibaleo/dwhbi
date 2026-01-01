/**
 * GitHub Contents Connector - Sync Logic
 */

import { GitHubClient } from "./github.js";
import * as db from "./db.js";
import { parseMarkdown } from "./parser.js";
import { setupLogger } from "../../lib/logger.js";
import type { SyncConfig, SyncResult } from "./types.js";

const logger = setupLogger("github-contents-sync");

export class DocumentSyncer {
  private github: GitHubClient;

  constructor(token: string, config: SyncConfig) {
    this.github = new GitHubClient(token, config);
  }

  async sync(): Promise<SyncResult> {
    const result: SyncResult = {
      added: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      errors: [],
    };

    const currentSha = await this.github.getCurrentSha();
    const lastSyncedSha = await db.getSyncState();

    logger.info(`Current SHA: ${currentSha}`);
    logger.info(`Last synced SHA: ${lastSyncedSha ?? "(none)"}`);

    if (lastSyncedSha === currentSha) {
      logger.info("No changes detected");
      return result;
    }

    if (!lastSyncedSha) {
      await this.fullSync(result);
    } else {
      await this.incrementalSync(lastSyncedSha, currentSha, result);
    }

    await db.updateSyncState(currentSha);
    return result;
  }

  private async fullSync(result: SyncResult): Promise<void> {
    logger.info("Performing full sync...");

    const paths = await this.github.getAllFiles();
    logger.info(`Found ${paths.length} markdown files`);

    const files = await this.github.getFileContents(paths);

    for (const [path, file] of Array.from(files.entries())) {
      try {
        const doc = parseMarkdown(file);
        await db.upsertDocument(doc);
        result.added++;
        logger.debug(`Added: ${path}`);
      } catch (error) {
        result.errors.push(`${path}: ${(error as Error).message}`);
        logger.error(`Failed to process ${path}: ${(error as Error).message}`);
      }
    }

    logger.info(`Full sync completed: ${result.added} documents added`);
  }

  private async incrementalSync(
    baseSha: string,
    headSha: string,
    result: SyncResult
  ): Promise<void> {
    logger.info("Performing incremental sync...");

    const changedFiles = await this.github.getChangedFiles(baseSha, headSha);
    logger.info(`Found ${changedFiles.length} changed files`);

    const existingHashes = await db.getExistingHashes();

    // 取得が必要なファイルパスを収集
    const pathsToFetch = changedFiles
      .filter((f) => f.status !== "removed")
      .map((f) => f.path);

    const files = await this.github.getFileContents(pathsToFetch);

    for (const change of changedFiles) {
      try {
        if (change.status === "removed") {
          await db.deleteDocument(change.path);
          result.deleted++;
          logger.debug(`Deleted: ${change.path}`);
        } else if (change.status === "renamed" && change.previousPath) {
          await db.deleteDocument(change.previousPath);
          const file = files.get(change.path);
          if (file) {
            const doc = parseMarkdown(file);
            await db.upsertDocument(doc);
            result.updated++;
            logger.debug(`Renamed: ${change.previousPath} -> ${change.path}`);
          }
        } else {
          const file = files.get(change.path);
          if (!file) continue;

          const doc = parseMarkdown(file);

          // content_hashが同じならスキップ
          if (existingHashes.get(change.path) === doc.contentHash) {
            result.skipped++;
            continue;
          }

          await db.upsertDocument(doc);

          if (change.status === "added") {
            result.added++;
            logger.debug(`Added: ${change.path}`);
          } else {
            result.updated++;
            logger.debug(`Updated: ${change.path}`);
          }
        }
      } catch (error) {
        result.errors.push(`${change.path}: ${(error as Error).message}`);
        logger.error(
          `Failed to process ${change.path}: ${(error as Error).message}`
        );
      }
    }

    logger.info(
      `Incremental sync completed: +${result.added} ~${result.updated} -${result.deleted} (${result.skipped} skipped)`
    );
  }
}
