/**
 * GitHub Contents Connector - Type Definitions
 */

/**
 * GitHub Contents APIから取得したファイル情報
 */
export interface GitHubFile {
  path: string;
  sha: string;
  content: string; // Base64デコード済み
}

/**
 * 解析済みMarkdownドキュメント
 */
export interface ParsedDocument {
  filePath: string;
  frontmatter: Record<string, unknown>;
  content: string;
  contentHash: string;
}

/**
 * 同期設定
 */
export interface SyncConfig {
  owner: string;
  repo: string;
  path: string; // 対象ディレクトリ（例: "docs"）
}

/**
 * ファイル変更種別
 */
export type FileChangeStatus = "added" | "modified" | "removed" | "renamed";

/**
 * 変更ファイル情報
 */
export interface ChangedFile {
  path: string;
  status: FileChangeStatus;
  previousPath?: string;
}

/**
 * 同期結果
 */
export interface SyncResult {
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: string[];
}
