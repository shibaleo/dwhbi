/**
 * GitHub Contents Connector - Database Operations
 */

import { getDbClient } from "../../db/raw-client.js";
import { setupLogger } from "../../lib/logger.js";
import type { ParsedDocument } from "./types.js";

const logger = setupLogger("github-contents-db");

/**
 * ドキュメントをUPSERT
 */
export async function upsertDocument(doc: ParsedDocument): Promise<void> {
  const client = await getDbClient();

  // frontmatter.titleが未定義なら空文字
  const frontmatter = {
    ...doc.frontmatter,
    title: doc.frontmatter.title ?? "",
  };

  await client.query(
    `INSERT INTO raw.docs_github (file_path, frontmatter, content, content_hash, fetched_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (file_path) DO UPDATE SET
       frontmatter = EXCLUDED.frontmatter,
       content = EXCLUDED.content,
       content_hash = EXCLUDED.content_hash,
       fetched_at = EXCLUDED.fetched_at`,
    [doc.filePath, JSON.stringify(frontmatter), doc.content, doc.contentHash]
  );
}

/**
 * ドキュメントを削除
 */
export async function deleteDocument(filePath: string): Promise<void> {
  const client = await getDbClient();
  await client.query("DELETE FROM raw.docs_github WHERE file_path = $1", [
    filePath,
  ]);
  logger.debug(`Deleted document: ${filePath}`);
}

/**
 * 既存ドキュメントのcontent_hash一覧を取得
 */
export async function getExistingHashes(): Promise<Map<string, string>> {
  const client = await getDbClient();
  const result = await client.query<{ file_path: string; content_hash: string }>(
    "SELECT file_path, content_hash FROM raw.docs_github"
  );
  return new Map(result.rows.map((row) => [row.file_path, row.content_hash]));
}

/**
 * 同期状態を取得
 */
export async function getSyncState(): Promise<string | null> {
  const client = await getDbClient();
  const result = await client.query<{ last_synced_sha: string }>(
    `SELECT last_synced_sha FROM raw.sync_state WHERE source = 'github'`
  );
  return result.rows[0]?.last_synced_sha ?? null;
}

/**
 * 同期状態を更新
 */
export async function updateSyncState(sha: string): Promise<void> {
  const client = await getDbClient();
  await client.query(
    `INSERT INTO raw.sync_state (source, last_synced_sha, synced_at)
     VALUES ('github', $1, NOW())
     ON CONFLICT (source) DO UPDATE SET
       last_synced_sha = EXCLUDED.last_synced_sha,
       synced_at = EXCLUDED.synced_at`,
    [sha]
  );
  logger.debug(`Updated sync state to SHA: ${sha}`);
}
