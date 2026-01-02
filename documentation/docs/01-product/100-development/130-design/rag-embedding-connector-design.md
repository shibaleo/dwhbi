---
title: Connector/GitHub Contents 詳細設計書
description: GitHub Contents APIからドキュメントを取得しraw.github_contents__documentsに保存するconnectorの設計
---

# Connector/GitHub Contents 詳細設計書

## 概要

本ドキュメントは [RAG Embedding設計](./rag-embedding.md) で定義されたconnector/github-contentsの詳細設計を記述する。

### 責務

- GitHub Contents APIからMarkdown文書を取得
- frontmatterの解析とcontent_hash計算
- raw.github_contents__documentsへのUPSERT
- 削除されたファイルのDELETE

### 技術スタック

| 項目 | 選定 | 理由 |
|------|------|------|
| 言語 | TypeScript | 既存connectorと統一 |
| GitHub API | Octokit | 公式クライアント |
| DB接続 | pg | 既存connectorパターン（DIRECT_DATABASE_URL） |
| frontmatter解析 | gray-matter | 標準的なライブラリ |

---

## ディレクトリ構造

```
packages/connector/src/services/github-contents/
├── index.ts           # エントリーポイント
├── orchestrator.ts    # 同期オーケストレーション
├── sync.ts            # 同期ロジック
├── parser.ts          # Markdown/frontmatter解析
├── github.ts          # GitHub API操作
├── db.ts              # PostgreSQL操作
└── types.ts           # 型定義
```

---

## 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| DIRECT_DATABASE_URL | YES | PostgreSQL接続文字列（既存） |
| GITHUB_TOKEN | YES | Fine-grained PAT（Contents: Read権限） |

**備考**: `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_PATH`は設定ファイルまたはコマンドライン引数で指定。環境変数を増やさない。

---

## 型定義

### types.ts

```typescript
/**
 * GitHub Contents APIから取得したファイル情報
 */
export interface GitHubFile {
  path: string;
  sha: string;
  content: string;  // Base64デコード済み
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
  path: string;  // 対象ディレクトリ（例: "docs"）
}

/**
 * ファイル変更種別
 */
export type FileChangeStatus = 'added' | 'modified' | 'removed' | 'renamed';

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
```

---

## DB操作

既存の`raw-client.ts`パターンに従い、シングルトン接続を使用。

### db.ts

```typescript
import { getDbClient } from '../../db/raw-client';
import { createHash } from 'crypto';
import type { ParsedDocument } from './types';

/**
 * ドキュメントをUPSERT
 */
export async function upsertDocument(doc: ParsedDocument): Promise<void> {
  const client = await getDbClient();

  // frontmatter.titleが未定義なら空文字
  const frontmatter = {
    ...doc.frontmatter,
    title: doc.frontmatter.title ?? '',
  };

  await client.query(
    `INSERT INTO raw.github_contents__documents (file_path, frontmatter, content, content_hash, fetched_at)
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
  await client.query(
    'DELETE FROM raw.github_contents__documents WHERE file_path = $1',
    [filePath]
  );
}

/**
 * 既存ドキュメントのcontent_hash一覧を取得
 */
export async function getExistingHashes(): Promise<Map<string, string>> {
  const client = await getDbClient();
  const result = await client.query<{ file_path: string; content_hash: string }>(
    'SELECT file_path, content_hash FROM raw.github_contents__documents'
  );
  return new Map(result.rows.map(row => [row.file_path, row.content_hash]));
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
}
```

---

## GitHub API操作

### github.ts

```typescript
import { Octokit } from '@octokit/rest';
import type { ChangedFile, GitHubFile, SyncConfig } from './types';

export class GitHubClient {
  private octokit: Octokit;
  private config: SyncConfig;

  constructor(token: string, config: SyncConfig) {
    this.octokit = new Octokit({ auth: token });
    this.config = config;
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
  async getChangedFiles(baseSha: string, headSha: string): Promise<ChangedFile[]> {
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
        .filter(f => f.filename.startsWith(this.config.path) && f.filename.endsWith('.md'))
        .map(f => ({
          path: f.filename,
          status: f.status as ChangedFile['status'],
          previousPath: f.previous_filename,
        }));

      allFiles.push(...files);

      if (!data.files || data.files.length < 100) break;
      page++;
    }

    return allFiles;
  }

  /**
   * 指定パス配下の全Markdownファイル一覧を取得（初回同期用）
   */
  async getAllFiles(): Promise<string[]> {
    const { data: tree } = await this.octokit.git.getTree({
      owner: this.config.owner,
      repo: this.config.repo,
      tree_sha: 'HEAD',
      recursive: 'true',
    });

    return tree.tree
      .filter(item =>
        item.type === 'blob' &&
        item.path?.startsWith(this.config.path) &&
        item.path?.endsWith('.md')
      )
      .map(item => item.path!);
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

    if (Array.isArray(data) || data.type !== 'file') {
      throw new Error(`Expected file, got ${Array.isArray(data) ? 'array' : data.type}`);
    }

    const content = Buffer.from(data.content, 'base64').toString('utf-8');

    return {
      path: data.path,
      sha: data.sha,
      content,
    };
  }

  /**
   * 複数ファイルを並列取得（rate limit考慮）
   */
  async getFileContents(paths: string[], concurrency = 5): Promise<Map<string, GitHubFile>> {
    const results = new Map<string, GitHubFile>();

    for (let i = 0; i < paths.length; i += concurrency) {
      const batch = paths.slice(i, i + concurrency);
      const files = await Promise.all(
        batch.map(path => this.getFileContent(path).catch(err => {
          console.warn(`Failed to fetch ${path}: ${err.message}`);
          return null;
        }))
      );

      for (const file of files) {
        if (file) results.set(file.path, file);
      }

      // rate limit対策: バッチ間で少し待機
      if (i + concurrency < paths.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }
}
```

---

## Markdown解析

### parser.ts

```typescript
import matter from 'gray-matter';
import { createHash } from 'crypto';
import type { GitHubFile, ParsedDocument } from './types';

/**
 * content_hashを計算（SHA256）
 */
export function computeContentHash(rawContent: string): string {
  return createHash('sha256').update(rawContent, 'utf-8').digest('hex');
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
```

---

## 同期処理

### sync.ts

```typescript
import { GitHubClient } from './github';
import * as db from './db';
import { parseMarkdown } from './parser';
import type { SyncConfig, SyncResult } from './types';

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

    console.log(`Current SHA: ${currentSha}`);
    console.log(`Last synced SHA: ${lastSyncedSha ?? '(none)'}`);

    if (lastSyncedSha === currentSha) {
      console.log('No changes detected');
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
    console.log('Performing full sync...');

    const paths = await this.github.getAllFiles();
    console.log(`Found ${paths.length} markdown files`);

    const files = await this.github.getFileContents(paths);

    for (const [path, file] of files) {
      try {
        const doc = parseMarkdown(file);
        await db.upsertDocument(doc);
        result.added++;
        console.log(`Added: ${path}`);
      } catch (error) {
        result.errors.push(`${path}: ${(error as Error).message}`);
      }
    }
  }

  private async incrementalSync(
    baseSha: string,
    headSha: string,
    result: SyncResult,
  ): Promise<void> {
    console.log('Performing incremental sync...');

    const changedFiles = await this.github.getChangedFiles(baseSha, headSha);
    console.log(`Found ${changedFiles.length} changed files`);

    const existingHashes = await db.getExistingHashes();

    // 取得が必要なファイルパスを収集
    const pathsToFetch = changedFiles
      .filter(f => f.status !== 'removed')
      .map(f => f.path);

    const files = await this.github.getFileContents(pathsToFetch);

    for (const change of changedFiles) {
      try {
        if (change.status === 'removed') {
          await db.deleteDocument(change.path);
          result.deleted++;
          console.log(`Deleted: ${change.path}`);
        } else if (change.status === 'renamed' && change.previousPath) {
          await db.deleteDocument(change.previousPath);
          const file = files.get(change.path);
          if (file) {
            const doc = parseMarkdown(file);
            await db.upsertDocument(doc);
            result.updated++;
            console.log(`Renamed: ${change.previousPath} -> ${change.path}`);
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

          if (change.status === 'added') {
            result.added++;
            console.log(`Added: ${change.path}`);
          } else {
            result.updated++;
            console.log(`Updated: ${change.path}`);
          }
        }
      } catch (error) {
        result.errors.push(`${change.path}: ${(error as Error).message}`);
      }
    }
  }
}
```

---

## オーケストレーター

既存connectorパターンに従い、DB接続のライフサイクルを管理。

### orchestrator.ts

```typescript
import { getDbClient, closeDbClient } from '../../db/raw-client';
import { DocumentSyncer } from './sync';
import type { SyncConfig, SyncResult } from './types';

export async function syncDocs(config: SyncConfig): Promise<SyncResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required');
  }

  try {
    await getDbClient();

    const syncer = new DocumentSyncer(token, config);
    return await syncer.sync();
  } finally {
    await closeDbClient();
  }
}
```

---

## エントリーポイント

### index.ts

```typescript
import { syncDocs } from './orchestrator';
import type { SyncConfig } from './types';

// 設定はコマンドライン引数または設定ファイルから
const config: SyncConfig = {
  owner: process.argv[2] || 'your-owner',
  repo: process.argv[3] || 'your-repo',
  path: process.argv[4] || 'docs',
};

async function main() {
  console.log('GitHub Contents Connector');
  console.log('=========================');
  console.log(`Target: ${config.owner}/${config.repo}/${config.path}`);

  const result = await syncDocs(config);

  console.log('\nSync completed:');
  console.log(`  Added:   ${result.added}`);
  console.log(`  Updated: ${result.updated}`);
  console.log(`  Deleted: ${result.deleted}`);
  console.log(`  Skipped: ${result.skipped}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach(err => console.log(`  - ${err}`));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

---

## 実行方法

### ローカル実行

```bash
cd packages/connector

# 環境変数
export DIRECT_DATABASE_URL="postgresql://..."
export GITHUB_TOKEN="github_pat_..."

# 実行
npx tsx src/services/github-contents/index.ts owner repo docs
```

### GitHub Actions

```yaml
name: Sync Docs

on:
  schedule:
    - cron: '0 * * * *'
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci
        working-directory: packages/connector

      - name: Run sync
        run: npx tsx src/services/github-contents/index.ts ${{ github.repository_owner }} your-repo docs
        working-directory: packages/connector
        env:
          DIRECT_DATABASE_URL: ${{ secrets.DIRECT_DATABASE_URL }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## エラーハンドリング

### リトライ対象

| エラー | リトライ | 対応 |
|--------|---------|------|
| GitHub API 403 (rate limit) | YES | 指数バックオフ |
| GitHub API 404 | NO | ファイル削除として扱う |
| GitHub API 5xx | YES | 指数バックオフ |
| DB接続エラー | YES | 指数バックオフ |

### 実装例

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      const delay = baseDelay * Math.pow(2, i);
      console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}
```

---

## 依存パッケージ

既存の`packages/connector/package.json`に追加:

```json
{
  "dependencies": {
    "@octokit/rest": "^20.0.0",
    "gray-matter": "^4.0.3"
  }
}
```

既存の依存:
- `pg`: DB接続
- `dotenv`: 環境変数
