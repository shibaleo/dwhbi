---
title: RAG Embedding テーブル定義書
description: RAG Embeddingシステムの全テーブル・関数定義
---

# RAG Embedding テーブル定義書

## 概要

本ドキュメントは [RAG Embedding設計](./rag-embedding.md) で定義されたDBスキーマの詳細仕様を記述する。

---

## スキーマ構成

| スキーマ | 用途 |
|---------|------|
| raw | 生データ（connectorが書き込み） |
| rag | 加工データ（analyzerが書き込み） |

---

## テーブル一覧

| テーブル | スキーマ | 説明 |
|---------|---------|------|
| docs_github | raw | GitHub から取得した生Markdownデータ |
| sync_state | raw | connector同期状態管理 |
| chunks | rag | チャンキング済みテキストとembedding |
| embedding_state | rag | embedding生成状態管理 |

---

## raw.docs_github

### 概要

GitHub Contents APIから取得したMarkdown文書の生データを格納。

### テーブル定義

```sql
CREATE TABLE raw.docs_github (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path TEXT NOT NULL UNIQUE,
    frontmatter JSONB NOT NULL DEFAULT '{}',
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### カラム定義

| カラム名 | 型 | NULL | デフォルト | 説明 |
|---------|-----|------|-----------|------|
| id | UUID | NO | gen_random_uuid() | 主キー |
| file_path | TEXT | NO | - | GitHubリポジトリ内のファイルパス |
| frontmatter | JSONB | NO | '{}' | 解析済みfrontmatter |
| content | TEXT | NO | - | frontmatter以下の生Markdownテキスト |
| content_hash | TEXT | NO | - | SHA256ハッシュ（変更検知用） |
| fetched_at | TIMESTAMPTZ | NO | NOW() | 取得日時 |

### frontmatter構造

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| title | string | NO | ドキュメントタイトル（空文字可） |
| tags | string[] | NO | タグ配列 |
| aliases | string[] | NO | エイリアス配列 |
| previous | string[] | NO | 旧バージョンのファイル名 |
| created | string | NO | 作成日時（ISO 8601） |
| updated | string | NO | 更新日時（ISO 8601） |

**備考**: `title`が取得できない場合は空文字`""`を挿入。チャンキング時にslugにフォールバック。

### インデックス

```sql
CREATE INDEX docs_github_frontmatter_tags_idx
    ON raw.docs_github USING GIN ((frontmatter->'tags'));
```

### 制約

| 制約名 | 種別 | 対象 |
|--------|------|------|
| docs_github_pkey | PRIMARY KEY | id |
| docs_github_file_path_key | UNIQUE | file_path |

---

## raw.sync_state

### 概要

connectorの同期状態を管理。最後に同期したcommit SHAを保持し、差分同期を可能にする。

### テーブル定義

```sql
CREATE TABLE raw.sync_state (
    source TEXT PRIMARY KEY,
    last_synced_sha TEXT NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### カラム定義

| カラム名 | 型 | NULL | デフォルト | 説明 |
|---------|-----|------|-----------|------|
| source | TEXT | NO | - | ソース識別子（'github'） |
| last_synced_sha | TEXT | NO | - | 最後に同期したcommit SHA |
| synced_at | TIMESTAMPTZ | NO | NOW() | 同期日時 |

---

## rag.chunks

### 概要

チャンキング済みテキストとembeddingベクトルを格納。

### テーブル定義

```sql
CREATE TABLE rag.chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES raw.docs_github(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    parent_heading TEXT NOT NULL,
    heading TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chunks_document_chunk_key UNIQUE (document_id, chunk_index)
);
```

### カラム定義

| カラム名 | 型 | NULL | デフォルト | 説明 |
|---------|-----|------|-----------|------|
| id | UUID | NO | gen_random_uuid() | 主キー |
| document_id | UUID | NO | - | 親ドキュメントID |
| chunk_index | INT | NO | - | チャンク順序（0始まり） |
| parent_heading | TEXT | NO | - | 親見出し（h1/title/slug） |
| heading | TEXT | NO | - | チャンク見出し（h2） |
| content | TEXT | NO | - | チャンク本文 |
| embedding | vector(512) | YES | NULL | 512次元ベクトル |
| created_at | TIMESTAMPTZ | NO | NOW() | 作成日時 |

### インデックス

```sql
-- ベクトル検索用（データ投入後に作成）
CREATE INDEX chunks_embedding_idx ON rag.chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX chunks_document_id_idx ON rag.chunks (document_id);
```

**注意**: ivfflatインデックスは空テーブルに作成すると警告が出る。初回データ投入後に作成するか、HNSWを検討。

### 制約

| 制約名 | 種別 | 対象 |
|--------|------|------|
| chunks_pkey | PRIMARY KEY | id |
| chunks_document_id_fkey | FOREIGN KEY | document_id → raw.docs_github(id) CASCADE |
| chunks_document_chunk_key | UNIQUE | (document_id, chunk_index) |

---

## rag.embedding_state

### 概要

embedding生成状態を追跡。content_hash比較で再生成が必要なドキュメントを検出する。

### テーブル定義

```sql
CREATE TABLE rag.embedding_state (
    document_id UUID PRIMARY KEY REFERENCES raw.docs_github(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    embedded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### カラム定義

| カラム名 | 型 | NULL | デフォルト | 説明 |
|---------|-----|------|-----------|------|
| document_id | UUID | NO | - | ドキュメントID |
| content_hash | TEXT | NO | - | embedding生成時のhash |
| embedded_at | TIMESTAMPTZ | NO | NOW() | embedding生成日時 |

### 制約

| 制約名 | 種別 | 対象 |
|--------|------|------|
| embedding_state_pkey | PRIMARY KEY | document_id |
| embedding_state_document_id_fkey | FOREIGN KEY | document_id → raw.docs_github(id) CASCADE |

---

## ビュー

### rag.documents_with_metadata

検索時にドキュメントメタデータを参照するためのビュー。

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

## RPC関数

### search_chunks

ベクトル類似検索を実行。

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

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| query_embedding | vector(512) | - | クエリベクトル（必須） |
| filter_tags | text[] | NULL | タグフィルタ |
| match_count | int | 5 | 最大結果数 |
| similarity_threshold | float | 0.7 | 類似度閾値 |

---

### get_documents_needing_embedding

embedding生成が必要なドキュメントを取得。

```sql
CREATE OR REPLACE FUNCTION get_documents_needing_embedding()
RETURNS TABLE (
    id uuid,
    file_path text,
    frontmatter jsonb,
    content text,
    content_hash text
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.file_path,
        d.frontmatter,
        d.content,
        d.content_hash
    FROM raw.docs_github d
    LEFT JOIN rag.embedding_state es ON d.id = es.document_id
    WHERE
        es.document_id IS NULL
        OR es.content_hash != d.content_hash;
END;
$$;
```

---

### get_superseded_document_ids

旧バージョンとしてマークされたドキュメントIDを取得。`previous`に含まれるファイル名と完全一致で判定。

```sql
CREATE OR REPLACE FUNCTION get_superseded_document_ids()
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT d2.id
    FROM raw.docs_github d1
    CROSS JOIN LATERAL jsonb_array_elements_text(d1.frontmatter->'previous') AS prev_file
    JOIN raw.docs_github d2 ON d2.file_path ~ (prev_file || '\.md$')
    WHERE d1.frontmatter ? 'previous';
END;
$$;
```

**判定ロジック**: `file_path`が`{prev_file}.md`で終わる（正規表現マッチ）。

---

## マイグレーションスクリプト

### 初期作成

```sql
-- 拡張機能
CREATE EXTENSION IF NOT EXISTS vector;

-- スキーマ
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS rag;

-- raw.docs_github
CREATE TABLE raw.docs_github (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path TEXT NOT NULL UNIQUE,
    frontmatter JSONB NOT NULL DEFAULT '{}',
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX docs_github_frontmatter_tags_idx
    ON raw.docs_github USING GIN ((frontmatter->'tags'));

-- raw.sync_state
CREATE TABLE raw.sync_state (
    source TEXT PRIMARY KEY,
    last_synced_sha TEXT NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- rag.chunks
CREATE TABLE rag.chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES raw.docs_github(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    parent_heading TEXT NOT NULL,
    heading TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chunks_document_chunk_key UNIQUE (document_id, chunk_index)
);

CREATE INDEX chunks_document_id_idx ON rag.chunks (document_id);

-- rag.embedding_state
CREATE TABLE rag.embedding_state (
    document_id UUID PRIMARY KEY REFERENCES raw.docs_github(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    embedded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ビュー
CREATE VIEW rag.documents_with_metadata AS
SELECT
    d.id,
    d.file_path,
    d.frontmatter->>'title' AS title,
    ARRAY(SELECT jsonb_array_elements_text(d.frontmatter->'tags')) AS tags,
    ARRAY(SELECT jsonb_array_elements_text(d.frontmatter->'aliases')) AS aliases,
    d.content_hash
FROM raw.docs_github d;

-- RPC関数
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

CREATE OR REPLACE FUNCTION get_documents_needing_embedding()
RETURNS TABLE (
    id uuid,
    file_path text,
    frontmatter jsonb,
    content text,
    content_hash text
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.file_path,
        d.frontmatter,
        d.content,
        d.content_hash
    FROM raw.docs_github d
    LEFT JOIN rag.embedding_state es ON d.id = es.document_id
    WHERE
        es.document_id IS NULL
        OR es.content_hash != d.content_hash;
END;
$$;

CREATE OR REPLACE FUNCTION get_superseded_document_ids()
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT d2.id
    FROM raw.docs_github d1
    CROSS JOIN LATERAL jsonb_array_elements_text(d1.frontmatter->'previous') AS prev_file
    JOIN raw.docs_github d2 ON d2.file_path ~ (prev_file || '\.md$')
    WHERE d1.frontmatter ? 'previous';
END;
$$;
```

### ivfflatインデックス作成（データ投入後）

```sql
CREATE INDEX chunks_embedding_idx ON rag.chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
```

---

## 運用考慮事項

### データ量見込み

| 項目 | 見込み値 |
|------|---------|
| ドキュメント数 | 〜1,000件 |
| 平均チャンク数/ドキュメント | 3〜5 |
| 総チャンク数 | 〜5,000件 |

### ivfflatインデックス調整

チャンク数が10,000件超になった場合:

```sql
DROP INDEX chunks_embedding_idx;
CREATE INDEX chunks_embedding_idx ON rag.chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 200);
```

### バックアップ

| テーブル | バックアップ必要性 | 理由 |
|---------|-------------------|------|
| raw.docs_github | 低 | GitHubから再取得可能 |
| raw.sync_state | 低 | 再取得可能（フル同期すれば復旧） |
| rag.chunks | 高 | embedding再生成にAPI呼び出しが必要 |
| rag.embedding_state | 低 | 再計算可能 |
