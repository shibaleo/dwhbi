---
title: RAG Embedding設計
description: 個人文書のベクトル検索システム設計
---

# RAG Embedding設計

## 概要

個人文書（Obsidian vault）を対象としたRAGシステム。全テキストをベクトル化し、LLMとの対話による振り返りを支援する。

### システム構成

| コンポーネント | 技術 | 役割 |
|---------------|------|------|
| 入力 | Obsidian | Markdown文書の作成・編集 |
| Embedding API | Voyage AI voyage-3-lite | ベクトル生成 |
| Vector DB | Supabase pgvector | ベクトル保存・検索 |
| 閲覧 | VitePress | 文書の静的サイト化 |

---

## チャンキング戦略

### 基本原則

- `##`（h2）でチャンク分割
- 1チャンク = 1ベクトル
- 固定長切断は行わない（意味を壊すリスクがあるため．）

### 見出しレベルの使い分け

| レベル | 用途 |
|--------|------|
| `#` | 使用しない（Obsidianのtitle表示用） |
| `##` | チャンク境界 |
| `###` | チャンク内のサブセクション |
| `####` | チャンク内の詳細項目 |

### サイズ制約

| 項目 | 値 | 備考 |
|------|-----|------|
| 上限 | 32K tokens | Voyage AI voyage-3-liteの制限 |
| 下限 | なし | 短くてもOK |
| 推奨 | 〜32K文字 | 日本語は1-2文字/トークンなので余裕あり |

### 上限超過時のフォールバック

```
1. ##セクションが32Kトークン超過
   ↓
2. ###があれば###で再分割
   ↓
3. ###がなければ警告出力、手動対応を促す
```

- `###`は「チャンク内のサブセクション」なので、分割しても意味的に自然
- 固定長切断は行わない

### 本文なし文書の扱い

frontmatterのみ / 本文なしの文書はembedding生成しない（検索対象外）。

---

## チャンク間コンテキスト保持

検索精度向上のため、各チャンクに前後関係のコンテキストを付加する。LLM不要、純粋なアルゴリズムで実装可能。

### context_previous

前セクションの末尾1-2文を付加。句点（`。`）で文分割し、最後の1-2文を抽出。

```python
import re

def get_context_previous(sections: list[dict], current_index: int) -> str | None:
    """前セクションの末尾1-2文を取得"""
    if current_index == 0:
        return None
    prev_section = sections[current_index - 1]
    # 句点、ピリオド、改行で文分割
    sentences = re.split(r'[。．.!?！？\n]', prev_section['content'])
    sentences = [s.strip() for s in sentences if s.strip()]
    if not sentences:
        return None
    return '。'.join(sentences[-2:]) + '。'
```

**補足**: 句読点が統一されていない文書が多い場合、textlintの`preset-ja-technical-writing`による事前整形を推奨。

### parent_heading

各チャンクに親見出しを付加。フォールバック順序:

1. `#`（h1）があればそれを使用
2. frontmatterの`title`があればそれを使用
3. どちらもなければファイル名のslug部分を使用（例: `20251230_my-doc.md` → `my-doc`）

```python
import re

def extract_slug_from_filename(filename: str) -> str:
    """ファイル名からslugを抽出: 20251230_my-doc.md → my-doc"""
    name = filename.rsplit('.', 1)[0]  # 拡張子除去
    if '_' in name:
        return name.split('_', 1)[1]  # timestamp部分を除去
    return name

def get_parent_heading(
    h1: str | None,
    frontmatter_title: str | None,
    filename: str
) -> str:
    """parent_headingを決定（フォールバック付き）"""
    if h1:
        return h1
    if frontmatter_title:
        return frontmatter_title
    return extract_slug_from_filename(filename)

def parse_with_hierarchy(
    markdown_text: str,
    frontmatter: dict,
    filename: str
) -> list[dict]:
    """Markdownをパースし、親見出しを保持したチャンクリストを生成"""
    chunks = []
    current_h1 = None
    current_chunk = None

    for line in markdown_text.split('\n'):
        if line.startswith('# '):
            current_h1 = line[2:].strip()
        elif line.startswith('## '):
            if current_chunk:
                chunks.append(current_chunk)
            parent = get_parent_heading(
                current_h1,
                frontmatter.get('title'),
                filename
            )
            current_chunk = {
                'parent_heading': parent,
                'heading': line[3:].strip(),
                'content': ''
            }
        elif current_chunk:
            current_chunk['content'] += line + '\n'

    if current_chunk:
        chunks.append(current_chunk)

    return chunks
```

---

## メタデータ付加

### 付加するメタデータ

| 項目 | 採用 | 理由 |
|------|------|------|
| title | ✅ | 文書の主題 |
| tags | ✅ | トピック分類 |
| heading | ✅ | チャンクの位置 |
| parent_heading | ✅ | 文書階層のコンテキスト |
| context_previous | ✅ | 前セクションからの文脈 |
| aliases | ✗ | 後から追加可能 |
| heading_path | ✗ | 深い階層の文書は運用上作らない |

### 冗長性回避: 1行圧縮形式

短いチャンクではメタデータ比率が高くなりノイズになるため、1行に圧縮。

```
title:Personal Document System|tags:specification,system,documentation

## Embedding アーキテクチャ
...
```

10-20トークン程度で収まる。

### Embedding用テキスト生成

```python
def build_embedding_text(
    chunk: dict,
    metadata: dict,
    context_previous: str | None
) -> str:
    """Embedding用のテキストを生成"""
    parts = []

    # メタデータ（1行圧縮）
    meta_line = f"title:{metadata['title']}|tags:{','.join(metadata['tags'])}"
    parts.append(meta_line)

    # 前セクションのコンテキスト
    if context_previous:
        parts.append(f"[prev] {context_previous}")

    # 親見出し
    if chunk.get('parent_heading'):
        parts.append(f"# {chunk['parent_heading']}")

    # チャンク本体
    parts.append(f"## {chunk['heading']}")
    parts.append(chunk['content'].strip())

    return '\n\n'.join(parts)
```

---

## Embedding技術選定

| 項目 | 選定 | 理由 |
|------|------|------|
| Embedding API | Voyage AI voyage-3-lite | Anthropic推奨、コスパ最良 |
| 料金 | $0.02 / 1M tokens | OpenAI smallと同等 |
| 無料枠 | 200M tokens | 個人利用には十分 |
| 次元数 | 512 | ストレージコスト低 |
| コンテキスト長 | 32K tokens | 長文も対応可 |
| Vector DB | Supabase pgvector | 既存インフラ活用 |

### 日本語トークン数の目安

| 言語 | 1トークンあたり |
|------|-----------------|
| 英語 | 約4文字 |
| 日本語 | 約1-2文字 |

日本語は英語の2-3倍トークンを消費する。

---

## DBスキーマ

### raw.docs_github（生データ）

connectorが保存する生Markdownデータ。命名規則は`raw.{entity}_{source}`パターン（将来`raw.docs_dropbox`等を追加可能）。

```sql
CREATE TABLE raw.docs_github (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path TEXT NOT NULL UNIQUE,
    frontmatter JSONB NOT NULL DEFAULT '{}',
    content TEXT NOT NULL,              -- frontmatter以下の生Markdown
    content_hash TEXT NOT NULL,         -- SHA256ハッシュ（変更検知用）
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX docs_github_frontmatter_tags_idx
    ON raw.docs_github USING GIN ((frontmatter->'tags'));
```

**frontmatterに含まれるフィールド**:
- `title`, `tags`, `aliases`: 検索に使用
- `created`, `updated`: Obsidian/VitePress用（RAGでは使用しない）
- `version`, `previous`: 将来のKG用に保存（RAGでは使用しない）

### rag.chunks（ベクトル）

analyzerが生成するチャンクとembedding。`context_previous`はembedding生成時にオンデマンド計算するため保存しない。

```sql
CREATE TABLE rag.chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES raw.docs_github(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    parent_heading TEXT NOT NULL,
    heading TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(512),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chunks_document_chunk_key UNIQUE (document_id, chunk_index)
);

-- インデックス
CREATE INDEX chunks_embedding_idx ON rag.chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX chunks_document_id_idx ON rag.chunks (document_id);
```

### ビュー: rag.documents_with_metadata

検索時に使用するビュー。

```sql
CREATE VIEW rag.documents_with_metadata AS
SELECT
    d.id,
    d.file_path,
    d.frontmatter->>'title' AS title,
    ARRAY(SELECT jsonb_array_elements_text(d.frontmatter->'tags')) AS tags,
    ARRAY(SELECT jsonb_array_elements_text(d.frontmatter->'aliases')) AS aliases,
    d.content_hash
FROM raw.docs_github d;
```

---

## 検索設計

### ベクトル検索 + メタデータフィルタ

```sql
SELECT
    c.id,
    c.heading,
    c.content,
    d.title,
    d.file_path,
    1 - (c.embedding <=> :query_embedding) AS similarity
FROM rag.chunks c
JOIN rag.documents d ON c.document_id = d.id
WHERE d.tags && :filter_tags  -- タグフィルタ（オプション）
ORDER BY c.embedding <=> :query_embedding
LIMIT 5;
```

### aliasプレフィックスによるフィルタ

```sql
SELECT
    c.*,
    d.title
FROM rag.chunks c
JOIN rag.documents d ON c.document_id = d.id
WHERE EXISTS (
    SELECT 1 FROM unnest(d.aliases) AS a
    WHERE a LIKE 'jira:%'
)
ORDER BY c.embedding <=> :query_embedding
LIMIT 5;
```

### 類似度閾値

- 初期値: 0.7（運用しながら調整）
- 閾値未満の結果は返さない

---

## 更新ポリシー

### Embedding再生成の判断

| 操作 | raw.docs_github | rag.chunks |
|------|-----------------|------------|
| 新規作成 | INSERT | 生成 |
| 内容修正 | UPDATE（hash変更） | 再生成 |
| frontmatterのみ変更 | UPDATE（hash変更） | 再生成 |
| 削除 | DELETE | CASCADE削除 |

### 変更検知: content_hash

`updated`フィールドは使用しない（Obsidian/VitePress用）。コンテンツ全体のSHA256ハッシュで変更を検知。

```python
import hashlib

def compute_content_hash(frontmatter: str, content: str) -> str:
    """frontmatter + contentのSHA256ハッシュを計算"""
    full_text = frontmatter + '\n---\n' + content
    return hashlib.sha256(full_text.encode('utf-8')).hexdigest()

def should_regenerate(current_hash: str, stored_hash: str | None) -> bool:
    """ハッシュ比較で再生成判定"""
    if stored_hash is None:
        return True
    return current_hash != stored_hash
```

**メリット**:
- frontmatterの任意のフィールド変更も検知可能
- `updated`フィールドの手動更新漏れに依存しない
- Git SHA比較と組み合わせて差分取得を最適化可能

### バージョン重複の除外

Obsidianに別バージョンの同一ドキュメントが複数存在する場合、`previous`フィールドを使って最新版のみをembedding対象とする。

```python
def get_superseded_files(all_docs: list[dict]) -> set[str]:
    """他のドキュメントのpreviousに含まれるファイルを取得（旧版）"""
    superseded = set()
    for doc in all_docs:
        previous = doc.get('frontmatter', {}).get('previous', [])
        for prev in previous:
            # ファイル名のみ or フルパスで比較
            superseded.add(prev)
    return superseded

def filter_latest_only(all_docs: list[dict]) -> list[dict]:
    """最新版のみを返す"""
    superseded = get_superseded_files(all_docs)
    return [
        doc for doc in all_docs
        if not any(doc['file_path'].endswith(s) for s in superseded)
    ]
```

**処理フロー**:
1. raw.docs_githubには全バージョンを保存（履歴として価値あり）
2. rag.chunksには最新版のみ保存（検索ノイズ回避）
3. `previous`で参照されているファイルはembedding対象外

---

## パイプライン設計

### アーキテクチャ概要

ELT（Extract-Load-Transform）パターンに従い、責務を分離。

```
┌─────────────────────────────────────────────────────────────────┐
│                     GitHub Contents API                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  connector/github-contents (TypeScript)                              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 1. Git trees APIで変更ファイル検出（SHA比較）               ││
│  │ 2. 変更ファイルのみContents APIで取得                       ││
│  │ 3. frontmatter解析、content_hash計算                        ││
│  │ 4. raw.docs_github にUPSERT                                 ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     raw.docs_github                              │
│  (file_path, frontmatter JSONB, content, content_hash)          │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  analyzer/embedding (Python)                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 1. content_hashが変更されたドキュメントを検出               ││
│  │ 2. ##でチャンキング                                         ││
│  │ 3. context_previous, parent_heading付加                     ││
│  │ 4. Voyage AI APIでembedding生成                             ││
│  │ 5. rag.chunks にUPSERT（既存は削除→再作成）                 ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                       rag.chunks                                 │
│  (document_id, heading, content, embedding vector(512))         │
└─────────────────────────────────────────────────────────────────┘
```

### パッケージ構成

```
packages/
├── connector/
│   └── services/
│       └── github-contents/     # 新規: GitHub Contents API連携
│           ├── sync.ts
│           └── parser.ts
│
└── analyzer/
    └── src/
        └── embedding/       # 新規: ベクトル生成
            ├── chunker.py
            ├── embedder.py
            └── pipeline.py
```

### connector: GitHub差分取得

```typescript
// connector/services/github-contents/sync.ts
async function syncDocs(owner: string, repo: string, path: string) {
  // 前回のcommit SHAを取得
  const lastSha = await getLastSyncedSha();
  const currentSha = await getCurrentSha(owner, repo);

  if (lastSha === currentSha) {
    console.log('No changes detected');
    return;
  }

  // 差分取得
  const compare = await octokit.repos.compareCommits({
    owner, repo,
    base: lastSha,
    head: currentSha,
  });

  const changedFiles = compare.data.files
    ?.filter(f => f.filename.startsWith(path) && f.filename.endsWith('.md'))
    ?? [];

  for (const file of changedFiles) {
    if (file.status === 'removed') {
      await deleteDoc(file.filename);
    } else {
      const content = await fetchContent(owner, repo, file.filename);
      await upsertDoc(file.filename, content);
    }
  }

  await saveLastSyncedSha(currentSha);
}
```

### analyzer: バッチ処理

```python
BATCH_SIZE = 128  # Voyage AIの推奨バッチサイズ

async def embed_batch(texts: list[str]) -> list[list[float]]:
    """バッチでembeddingを生成"""
    response = await voyage_client.embed(
        texts=texts,
        model="voyage-3-lite",
        input_type="document"
    )
    return response.embeddings

async def process_changed_documents():
    """変更されたドキュメントのembeddingを再生成"""
    # content_hashが変更されたドキュメントを検出
    changed_docs = await get_docs_needing_embedding()

    for doc in changed_docs:
        # 既存チャンクを削除
        await delete_chunks(doc.id)

        # チャンキング
        chunks = parse_with_hierarchy(
            doc.content,
            doc.frontmatter,
            doc.file_path
        )

        # embedding生成（バッチ）
        texts = [build_embedding_text(c, doc.frontmatter) for c in chunks]
        embeddings = await embed_batch(texts)

        # 保存
        await insert_chunks(doc.id, chunks, embeddings)
```

---

## MCP連携設計

Claude DesktopおよびClaude CodeからMCP（Model Context Protocol）経由でRAG検索を利用する。

### アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude Desktop / Claude Code                                    │
└─────────────────────────┬───────────────────────────────────────┘
                          │ MCP Protocol (stdio / SSE)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  MCP Server (TypeScript)                                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Tools:                                                      ││
│  │   - search_docs: ベクトル検索                               ││
│  │   - get_doc: ドキュメント全文取得                           ││
│  │   - list_tags: タグ一覧取得                                 ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase                                                        │
│  ├── raw.docs_github (生データ)                                  │
│  └── rag.chunks (ベクトル)                                       │
└─────────────────────────────────────────────────────────────────┘
```

### MCP Tools定義

```typescript
// mcp-server/src/tools.ts

const tools = [
  {
    name: "search_docs",
    description: "個人ドキュメントをセマンティック検索する",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "検索クエリ（自然言語）"
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "フィルタするタグ（オプション）"
        },
        limit: {
          type: "number",
          default: 5,
          description: "返す結果の数"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "get_doc",
    description: "ドキュメントの全文を取得する",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "ドキュメントのファイルパス"
        }
      },
      required: ["file_path"]
    }
  },
  {
    name: "list_tags",
    description: "使用されているタグの一覧を取得する",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];
```

### search_docs実装

```typescript
async function searchDocs(query: string, tags?: string[], limit = 5) {
  // 1. クエリをembedding化
  const queryEmbedding = await voyageClient.embed({
    texts: [query],
    model: "voyage-3-lite",
    inputType: "query"  // documentではなくquery
  });

  // 2. ベクトル検索 + タグフィルタ
  const { data, error } = await supabase.rpc('search_chunks', {
    query_embedding: queryEmbedding.embeddings[0],
    filter_tags: tags ?? null,
    match_count: limit,
    similarity_threshold: 0.7
  });

  // 3. 結果を整形
  return data.map(chunk => ({
    title: chunk.title,
    heading: chunk.heading,
    content: chunk.content,
    file_path: chunk.file_path,
    similarity: chunk.similarity
  }));
}
```

### Supabase RPC関数

```sql
CREATE OR REPLACE FUNCTION search_chunks(
  query_embedding vector(512),
  filter_tags text[] DEFAULT NULL,
  match_count int DEFAULT 5,
  similarity_threshold float DEFAULT 0.7
)
RETURNS TABLE (
  id uuid,
  title text,
  heading text,
  content text,
  file_path text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    d.frontmatter->>'title' AS title,
    c.heading,
    c.content,
    d.file_path,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM rag.chunks c
  JOIN raw.docs_github d ON c.document_id = d.id
  WHERE
    (filter_tags IS NULL OR d.frontmatter->'tags' ?| filter_tags)
    AND 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

### リポジトリ構成

MCPサーバーは責務が異なるため別リポジトリで管理。

| リポジトリ | 責務 |
|-----------|------|
| dwhbi | データパイプライン（connector, analyzer） |
| mcp-personal-knowledge | MCPサーバー（RAG検索、将来KG対応） |

**dwhbi内**:
```
packages/
├── connector/
│   └── services/
│       └── github-contents/
│
└── analyzer/
    └── src/
        └── embedding/
```

**別リポジトリ: mcp-personal-knowledge**:
```
mcp-personal-knowledge/
├── package.json
├── src/
│   ├── index.ts
│   ├── tools/
│   │   ├── rag/           # RAG検索ツール
│   │   │   ├── search.ts
│   │   │   ├── document.ts
│   │   │   └── tags.ts
│   │   └── kg/            # 将来: KGツール
│   │       ├── query.ts
│   │       └── entity.ts
│   └── db/
│       └── client.ts
└── tsconfig.json
```

**分離の理由**:
- 責務の違い: dwhbiはデータパイプライン、MCPサーバーはAPIサーバー
- デプロイサイクル: MCPサーバーは独立して更新可能
- 依存関係: MCPサーバーはSupabase + Voyage AIのみ、dwhbiの複雑な依存は不要

### Claude Desktop設定

npm登録不要。ローカルパスで直接実行。

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "node",
      "args": ["/path/to/mcp-personal-knowledge/dist/index.js"],
      "env": {
        "SUPABASE_URL": "...",
        "SUPABASE_KEY": "...",
        "VOYAGE_API_KEY": "..."
      }
    }
  }
}
```

---

## 実装ステータス

| 項目 | 状態 |
|------|------|
| チャンキング戦略 | ✅ 設計完了 |
| DBスキーマ | ✅ 実装完了 |
| パイプライン設計 | ✅ 設計完了 |
| MCP連携設計 | ✅ 設計完了 |
| connector/github-contents | ✅ 実装完了 |
| analyzer/embedding | ✅ 実装完了（バッチ処理最適化済み） |
| mcp-personal-knowledge（console統合） | ✅ 実装完了（/api/mcp） |
