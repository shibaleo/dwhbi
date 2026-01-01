/**
 * GitHub Contents Connector - GitHub API Client
 */

import { Octokit } from "@octokit/rest";
import { setupLogger } from "../../lib/logger.js";
import type { ChangedFile, GitHubFile, SyncConfig } from "./types.js";

const logger = setupLogger("github-contents-api");

export class GitHubClient {
  private octokit: Octokit;
  private config: SyncConfig;
  private pathPrefix: string;

  constructor(token: string, config: SyncConfig) {
    this.octokit = new Octokit({ auth: token });
    this.config = config;
    // "." or "" means root directory (match all paths)
    this.pathPrefix = config.path === "." || config.path === "" ? "" : config.path;
  }

  /**
   * Check if a file path matches the configured path prefix
   */
  private matchesPath(filePath: string): boolean {
    if (this.pathPrefix === "") return true;
    return filePath.startsWith(this.pathPrefix);
  }

  /**
   * Check if a file should be included (excludes README files at root)
   */
  private shouldInclude(filePath: string): boolean {
    // Exclude README.md at repository root
    const filename = filePath.split("/").pop()?.toLowerCase() || "";
    if (filePath === "README.md" || filename === "readme.md" && !filePath.includes("/")) {
      return false;
    }
    return true;
  }

  /**
   * 現在のデフォルトブランチの最新commit SHAを取得
   */
  async getCurrentSha(): Promise<string> {
    const { data: repo } = await this.octokit.repos.get({
      owner: this.config.owner,
      repo: this.config.repo,
    });

    const { data: ref } = await this.octokit.git.getRef({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: `heads/${repo.default_branch}`,
    });

    return ref.object.sha;
  }

  /**
   * 2つのcommit間の差分ファイル一覧を取得
   */
  async getChangedFiles(
    baseSha: string,
    headSha: string
  ): Promise<ChangedFile[]> {
    const allFiles: ChangedFile[] = [];
    let page = 1;

    // ページネーション対応
    while (true) {
      const { data } = await this.octokit.repos.compareCommitsWithBasehead({
        owner: this.config.owner,
        repo: this.config.repo,
        basehead: `${baseSha}...${headSha}`,
        per_page: 100,
        page,
      });

      const files = (data.files ?? [])
        .filter(
          (f) =>
            this.matchesPath(f.filename) &&
            f.filename.endsWith(".md") &&
            this.shouldInclude(f.filename)
        )
        .map((f) => ({
          path: f.filename,
          status: f.status as ChangedFile["status"],
          previousPath: f.previous_filename,
        }));

      allFiles.push(...files);

      if (!data.files || data.files.length < 100) break;
      page++;
    }

    logger.debug(`Found ${allFiles.length} changed markdown files`);
    return allFiles;
  }

  /**
   * 指定パス配下の全Markdownファイル一覧を取得（初回同期用）
   */
  async getAllFiles(): Promise<string[]> {
    const { data: tree } = await this.octokit.git.getTree({
      owner: this.config.owner,
      repo: this.config.repo,
      tree_sha: "HEAD",
      recursive: "true",
    });

    const paths = tree.tree
      .filter(
        (item) =>
          item.type === "blob" &&
          item.path &&
          this.matchesPath(item.path) &&
          item.path.endsWith(".md") &&
          this.shouldInclude(item.path)
      )
      .map((item) => item.path!);

    logger.debug(`Found ${paths.length} markdown files in ${this.pathPrefix || "(root)"}`);
    return paths;
  }

  /**
   * ファイルの内容を取得
   */
  async getFileContent(path: string): Promise<GitHubFile> {
    const { data } = await this.octokit.repos.getContent({
      owner: this.config.owner,
      repo: this.config.repo,
      path,
    });

    if (Array.isArray(data) || data.type !== "file") {
      throw new Error(
        `Expected file, got ${Array.isArray(data) ? "array" : data.type}`
      );
    }

    const content = Buffer.from(data.content, "base64").toString("utf-8");

    return {
      path: data.path,
      sha: data.sha,
      content,
    };
  }

  /**
   * 複数ファイルを並列取得（rate limit考慮）
   */
  async getFileContents(
    paths: string[],
    concurrency = 5
  ): Promise<Map<string, GitHubFile>> {
    const results = new Map<string, GitHubFile>();

    for (let i = 0; i < paths.length; i += concurrency) {
      const batch = paths.slice(i, i + concurrency);
      const files = await Promise.all(
        batch.map((path) =>
          this.getFileContent(path).catch((err) => {
            logger.warn(`Failed to fetch ${path}: ${err.message}`);
            return null;
          })
        )
      );

      for (const file of files) {
        if (file) results.set(file.path, file);
      }

      // rate limit対策: バッチ間で少し待機
      if (i + concurrency < paths.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return results;
  }
}
