/**
 * GitHub Contents Connector - Markdown Parser
 */

import * as matter from "gray-matter";
import { createHash } from "crypto";
import type { GitHubFile, ParsedDocument } from "./types.js";

/**
 * content_hashを計算（SHA256）
 */
export function computeContentHash(rawContent: string): string {
  return createHash("sha256").update(rawContent, "utf-8").digest("hex");
}

/**
 * Markdownファイルを解析
 */
export function parseMarkdown(file: GitHubFile): ParsedDocument {
  const { data: frontmatter, content } = matter(file.content);

  return {
    filePath: file.path,
    frontmatter,
    content: content.trim(),
    contentHash: computeContentHash(file.content),
  };
}
