---
title: Analyzer/Embedding 詳細設計書
description: raw.github_contents__documentsからチャンキング・embedding生成を行いrag.chunksに保存するanalyzerの設計
---

# Analyzer/Embedding 詳細設計書

## 概要

本ドキュメントは [RAG Embedding設計](./rag-embedding.md) で定義されたanalyzer/embeddingの詳細設計を記述する。

### 責務

- raw.github_contents__documentsから変更されたドキュメントを検出
- `##`（h2）でチャンキング（32K超過時は`###`で再分割）
- context_previous, parent_headingの付加
- Voyage AI APIでembedding生成
- rag.chunksへのUPSERT

### 技術スタック

| 項目 | 選定 | 理由 |
|------|------|------|
| 言語 | Python 3.11+ | ML/NLP処理に適切 |
| Embedding API | Voyage AI (voyage-3-lite) | Anthropic推奨、コスパ最良 |
| DB接続 | psycopg2 | 既存analyzerパターン（DIRECT_DATABASE_URL） |

---

## ディレクトリ構造

```
packages/analyzer/src/embedding/
├── __init__.py
├── main.py            # エントリーポイント
├── pipeline.py        # パイプライン制御
├── chunker.py         # チャンキング処理
├── embedder.py        # Voyage AI呼び出し
├── db.py              # PostgreSQL操作
├── config.py          # 設定
└── types.py           # 型定義
```

---

## 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| DIRECT_DATABASE_URL | YES | PostgreSQL接続文字列（既存） |
| VOYAGE_API_KEY | YES | Voyage AI API Key |
| BATCH_SIZE | NO | バッチサイズ（デフォルト: 128） |

---

## 型定義

### types.py

```python
from dataclasses import dataclass, field
from typing import TypedDict


class FrontmatterDict(TypedDict, total=False):
    """frontmatter JSONBの型"""
    title: str
    tags: list[str]
    aliases: list[str]
    previous: list[str]


@dataclass
class RawDocument:
    """raw.github_contents__documentsから取得したドキュメント"""
    id: str
    file_path: str
    frontmatter: FrontmatterDict
    content: str
    content_hash: str


@dataclass
class Chunk:
    """チャンキング済みセグメント"""
    chunk_index: int
    parent_heading: str
    heading: str
    content: str
    context_previous: str | None = None


@dataclass
class ChunkWithEmbedding:
    """embedding付きチャンク"""
    chunk_index: int
    parent_heading: str
    heading: str
    content: str
    embedding: list[float]


@dataclass
class ProcessingResult:
    """処理結果"""
    processed: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)
```

---

## 設定

### config.py

```python
import os
from dataclasses import dataclass


@dataclass
class Config:
    database_url: str
    voyage_api_key: str
    batch_size: int = 128
    max_tokens: int = 32000  # Voyage AI voyage-3-liteの制限


def load_config() -> Config:
    """環境変数から設定を読み込み"""
    database_url = os.environ.get("DIRECT_DATABASE_URL")
    if not database_url:
        raise ValueError("DIRECT_DATABASE_URL is required")

    voyage_api_key = os.environ.get("VOYAGE_API_KEY")
    if not voyage_api_key:
        raise ValueError("VOYAGE_API_KEY is required")

    return Config(
        database_url=database_url,
        voyage_api_key=voyage_api_key,
        batch_size=int(os.environ.get("BATCH_SIZE", "128")),
    )
```

---

## DB操作

### db.py

```python
import psycopg2
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from typing import Generator

from .types import ChunkWithEmbedding, RawDocument


@contextmanager
def get_connection(database_url: str) -> Generator[psycopg2.extensions.connection, None, None]:
    """DB接続のコンテキストマネージャ"""
    conn = psycopg2.connect(database_url)
    try:
        yield conn
    finally:
        conn.close()


class DocsRepository:
    """PostgreSQLドキュメントリポジトリ"""

    def __init__(self, database_url: str):
        self.database_url = database_url

    def get_documents_needing_embedding(self) -> list[RawDocument]:
        """embeddingが必要なドキュメントを取得"""
        with get_connection(self.database_url) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT * FROM get_documents_needing_embedding()")
                rows = cur.fetchall()

        return [
            RawDocument(
                id=str(row["id"]),
                file_path=row["file_path"],
                frontmatter=row["frontmatter"] or {},
                content=row["content"],
                content_hash=row["content_hash"],
            )
            for row in rows
        ]

    def get_superseded_document_ids(self) -> set[str]:
        """旧バージョンとしてマークされたドキュメントIDを取得"""
        with get_connection(self.database_url) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM get_superseded_document_ids()")
                rows = cur.fetchall()

        return {str(row[0]) for row in rows}

    def delete_chunks(self, document_id: str) -> None:
        """ドキュメントの既存チャンクを削除"""
        with get_connection(self.database_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM rag.chunks WHERE document_id = %s",
                    (document_id,)
                )
            conn.commit()

    def insert_chunks(self, document_id: str, chunks: list[ChunkWithEmbedding]) -> None:
        """チャンクを挿入"""
        if not chunks:
            return

        with get_connection(self.database_url) as conn:
            with conn.cursor() as cur:
                for chunk in chunks:
                    cur.execute(
                        """
                        INSERT INTO rag.chunks
                            (document_id, chunk_index, parent_heading, heading, content, embedding)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (
                            document_id,
                            chunk.chunk_index,
                            chunk.parent_heading,
                            chunk.heading,
                            chunk.content,
                            chunk.embedding,
                        )
                    )
            conn.commit()

    def record_embedding_hash(self, document_id: str, content_hash: str) -> None:
        """embedding生成済みのhashを記録"""
        with get_connection(self.database_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO rag.embedding_state (document_id, content_hash, embedded_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (document_id) DO UPDATE SET
                        content_hash = EXCLUDED.content_hash,
                        embedded_at = EXCLUDED.embedded_at
                    """,
                    (document_id, content_hash)
                )
            conn.commit()
```

---

## チャンキング処理

### chunker.py

```python
import re
import tiktoken

from .types import Chunk, FrontmatterDict, RawDocument

# トークン数推定用エンコーダ（概算）
_encoder = tiktoken.get_encoding("cl100k_base")


def estimate_tokens(text: str) -> int:
    """トークン数を推定"""
    return len(_encoder.encode(text))


def extract_slug_from_filename(filename: str) -> str:
    """
    ファイル名からslugを抽出
    例: 20251230_my-doc.md → my-doc
    """
    name = filename.rsplit("/", 1)[-1]
    name = name.rsplit(".", 1)[0]
    if "_" in name:
        return name.split("_", 1)[1]
    return name


def get_parent_heading(
    h1: str | None,
    frontmatter: FrontmatterDict,
    filename: str,
) -> str:
    """
    parent_headingを決定（フォールバック付き）
    優先順位: h1 > frontmatter.title > filename slug
    """
    if h1:
        return h1
    title = frontmatter.get("title", "")
    if title:
        return title
    return extract_slug_from_filename(filename)


def get_context_previous(chunks: list[Chunk], current_index: int) -> str | None:
    """前セクションの末尾1-2文を取得"""
    if current_index == 0:
        return None

    prev_chunk = chunks[current_index - 1]
    sentences = re.split(r"[。．.!?！？\n]", prev_chunk.content)
    sentences = [s.strip() for s in sentences if s.strip()]

    if not sentences:
        return None

    return "。".join(sentences[-2:]) + "。"


def split_by_h3(content: str, parent_heading: str, h2_heading: str, base_index: int) -> list[Chunk]:
    """h3で再分割"""
    chunks: list[Chunk] = []
    current_h3: str | None = None
    current_content: list[str] = []

    for line in content.split("\n"):
        if line.startswith("### "):
            if current_h3 is not None:
                chunks.append(Chunk(
                    chunk_index=base_index + len(chunks),
                    parent_heading=parent_heading,
                    heading=f"{h2_heading} > {current_h3}",
                    content="\n".join(current_content).strip(),
                ))
            current_h3 = line[4:].strip()
            current_content = []
        else:
            current_content.append(line)

    # 最後のチャンク
    if current_h3 is not None:
        chunks.append(Chunk(
            chunk_index=base_index + len(chunks),
            parent_heading=parent_heading,
            heading=f"{h2_heading} > {current_h3}",
            content="\n".join(current_content).strip(),
        ))
    elif current_content:
        # h3がない場合はそのまま
        chunks.append(Chunk(
            chunk_index=base_index,
            parent_heading=parent_heading,
            heading=h2_heading,
            content="\n".join(current_content).strip(),
        ))

    return chunks


def chunk_document(doc: RawDocument, max_tokens: int = 32000) -> list[Chunk]:
    """
    ドキュメントを##（h2）でチャンキング
    32K超過時は###で再分割
    """
    raw_chunks: list[tuple[str, str, str]] = []  # (parent_heading, heading, content)
    current_h1: str | None = None
    current_heading: str | None = None
    current_content: list[str] = []

    lines = doc.content.split("\n")

    for line in lines:
        if line.startswith("# "):
            current_h1 = line[2:].strip()
        elif line.startswith("## "):
            if current_heading is not None:
                parent = get_parent_heading(current_h1, doc.frontmatter, doc.file_path)
                raw_chunks.append((parent, current_heading, "\n".join(current_content).strip()))
            current_heading = line[3:].strip()
            current_content = []
        elif current_heading is not None:
            current_content.append(line)

    # 最後のチャンク
    if current_heading is not None:
        parent = get_parent_heading(current_h1, doc.frontmatter, doc.file_path)
        raw_chunks.append((parent, current_heading, "\n".join(current_content).strip()))

    # トークン数チェックと再分割
    chunks: list[Chunk] = []
    for parent_heading, heading, content in raw_chunks:
        tokens = estimate_tokens(content)

        if tokens <= max_tokens:
            chunks.append(Chunk(
                chunk_index=len(chunks),
                parent_heading=parent_heading,
                heading=heading,
                content=content,
            ))
        else:
            # h3で再分割
            print(f"  [WARN] Chunk exceeds {max_tokens} tokens ({tokens}): {heading}")
            sub_chunks = split_by_h3(content, parent_heading, heading, len(chunks))

            if len(sub_chunks) == 1 and estimate_tokens(sub_chunks[0].content) > max_tokens:
                # h3でも分割できない場合は警告
                print(f"  [ERROR] Cannot split chunk: {heading} ({tokens} tokens)")
                print(f"          Manual intervention required")

            for sub_chunk in sub_chunks:
                sub_chunk.chunk_index = len(chunks)
                chunks.append(sub_chunk)

    # context_previousを付加
    for i, chunk in enumerate(chunks):
        chunk.context_previous = get_context_previous(chunks, i)

    return chunks


def build_embedding_text(chunk: Chunk, frontmatter: FrontmatterDict) -> str:
    """Embedding用のテキストを生成（1行圧縮形式）"""
    parts: list[str] = []

    # メタデータ（1行圧縮）
    title = frontmatter.get("title", "")
    tags = ",".join(frontmatter.get("tags", []))
    parts.append(f"title:{title}|tags:{tags}")

    # 前セクションのコンテキスト
    if chunk.context_previous:
        parts.append(f"[prev] {chunk.context_previous}")

    # 親見出し
    parts.append(f"# {chunk.parent_heading}")

    # チャンク本体
    parts.append(f"## {chunk.heading}")
    parts.append(chunk.content)

    return "\n\n".join(parts)


def filter_empty_chunks(chunks: list[Chunk]) -> list[Chunk]:
    """空のチャンクを除外"""
    return [c for c in chunks if c.content.strip()]
```

---

## Embedding生成

### embedder.py

```python
import time
from typing import Sequence

import voyageai


class EmbeddingClient:
    """Voyage AI Embedding クライアント"""

    def __init__(self, api_key: str, batch_size: int = 128):
        self.client = voyageai.Client(api_key=api_key)
        self.batch_size = batch_size
        self.model = "voyage-3-lite"

    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]:
        """
        テキストのリストをembedding化
        batch_sizeごとに分割して処理
        """
        all_embeddings: list[list[float]] = []

        for i in range(0, len(texts), self.batch_size):
            batch = texts[i : i + self.batch_size]

            response = self._embed_with_retry(list(batch))
            all_embeddings.extend(response.embeddings)

            # レート制限対策
            if i + self.batch_size < len(texts):
                time.sleep(0.1)

        return all_embeddings

    def _embed_with_retry(
        self,
        texts: list[str],
        max_retries: int = 3,
        base_delay: float = 1.0,
    ) -> voyageai.EmbeddingsResponse:
        """リトライ付きembedding"""
        for attempt in range(max_retries):
            try:
                return self.client.embed(
                    texts=texts,
                    model=self.model,
                    input_type="document",
                )
            except Exception as e:
                if attempt == max_retries - 1:
                    raise

                delay = base_delay * (2 ** attempt)
                print(f"  Retry {attempt + 1}/{max_retries} after {delay}s: {e}")
                time.sleep(delay)

        raise RuntimeError("Unreachable")
```

---

## パイプライン制御

### pipeline.py

```python
from .chunker import build_embedding_text, chunk_document, filter_empty_chunks
from .config import Config
from .db import DocsRepository
from .embedder import EmbeddingClient
from .types import ChunkWithEmbedding, ProcessingResult, RawDocument


class EmbeddingPipeline:
    """Embeddingパイプライン"""

    def __init__(self, config: Config):
        self.config = config
        self.db = DocsRepository(config.database_url)
        self.embedder = EmbeddingClient(config.voyage_api_key, config.batch_size)

    def run(self) -> ProcessingResult:
        """パイプライン実行"""
        result = ProcessingResult()

        # embedding対象ドキュメントを取得
        docs = self.db.get_documents_needing_embedding()
        print(f"Found {len(docs)} documents needing embedding")

        if not docs:
            return result

        # 旧バージョンを除外
        superseded_ids = self.db.get_superseded_document_ids()
        target_docs = [d for d in docs if d.id not in superseded_ids]
        result.skipped = len(docs) - len(target_docs)

        if result.skipped > 0:
            print(f"Excluded {result.skipped} superseded documents")

        # 各ドキュメントを処理
        for doc in target_docs:
            try:
                self.process_document(doc)
                result.processed += 1
                print(f"Processed: {doc.file_path}")
            except Exception as e:
                result.errors.append(f"{doc.file_path}: {e}")
                print(f"Error: {doc.file_path}: {e}")

        return result

    def process_document(self, doc: RawDocument) -> None:
        """単一ドキュメントを処理"""
        # チャンキング
        chunks = chunk_document(doc, self.config.max_tokens)
        chunks = filter_empty_chunks(chunks)

        if not chunks:
            print(f"  No chunks (empty document): {doc.file_path}")
            # 空でもembedding_stateは記録
            self.db.record_embedding_hash(doc.id, doc.content_hash)
            return

        # embedding用テキストを生成
        texts = [build_embedding_text(c, doc.frontmatter) for c in chunks]

        # embedding生成
        embeddings = self.embedder.embed_texts(texts)

        # ChunkWithEmbeddingに変換
        chunks_with_embedding = [
            ChunkWithEmbedding(
                chunk_index=chunk.chunk_index,
                parent_heading=chunk.parent_heading,
                heading=chunk.heading,
                content=chunk.content,
                embedding=embedding,
            )
            for chunk, embedding in zip(chunks, embeddings)
        ]

        # 既存チャンクを削除して再作成
        self.db.delete_chunks(doc.id)
        self.db.insert_chunks(doc.id, chunks_with_embedding)

        # embedding状態を記録
        self.db.record_embedding_hash(doc.id, doc.content_hash)

        print(f"  Created {len(chunks_with_embedding)} chunks")
```

---

## エントリーポイント

### main.py

```python
import sys

from .config import load_config
from .pipeline import EmbeddingPipeline


def main() -> int:
    print("Embedding Analyzer")
    print("==================")

    config = load_config()
    pipeline = EmbeddingPipeline(config)

    result = pipeline.run()

    print("\nProcessing completed:")
    print(f"  Processed: {result.processed}")
    print(f"  Skipped:   {result.skipped}")

    if result.errors:
        print("\nErrors:")
        for err in result.errors:
            print(f"  - {err}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
```

---

## 実行方法

### ローカル実行

```bash
cd packages/analyzer

# 仮想環境
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 依存インストール
pip install -e .

# 環境変数
export DIRECT_DATABASE_URL="postgresql://..."
export VOYAGE_API_KEY="xxx"

# 実行
python -m src.embedding.main
```

### GitHub Actions

```yaml
name: Generate Embeddings

on:
  workflow_run:
    workflows: ["Sync Docs"]
    types: [completed]
  workflow_dispatch:

jobs:
  embed:
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'success' || github.event_name == 'workflow_dispatch' }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - run: pip install -e .
        working-directory: packages/analyzer

      - name: Run embedding pipeline
        run: python -m src.embedding.main
        working-directory: packages/analyzer
        env:
          DIRECT_DATABASE_URL: ${{ secrets.DIRECT_DATABASE_URL }}
          VOYAGE_API_KEY: ${{ secrets.VOYAGE_API_KEY }}
```

---

## エラーハンドリング

### リトライ対象

| エラー | リトライ | 対応 |
|--------|---------|------|
| Voyage API 429 (rate limit) | YES | 指数バックオフ |
| Voyage API 5xx | YES | 指数バックオフ |
| DB接続エラー | YES | 指数バックオフ |
| チャンキングエラー | NO | スキップ、エラー記録 |
| トークン超過（h3分割不可） | NO | 警告、手動対応促す |

---

## 依存パッケージ

### pyproject.toml

```toml
[project]
name = "dwhbi-analyzer"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "psycopg2-binary>=2.9.0",
    "voyageai>=0.2.0",
    "tiktoken>=0.5.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "mypy>=1.7.0",
]
```

---

## テスト

### tests/test_chunker.py

```python
import pytest

from src.embedding.chunker import (
    chunk_document,
    extract_slug_from_filename,
    get_context_previous,
    get_parent_heading,
    split_by_h3,
)
from src.embedding.types import Chunk, RawDocument


def test_extract_slug_from_filename():
    assert extract_slug_from_filename("20251230_my-doc.md") == "my-doc"
    assert extract_slug_from_filename("simple.md") == "simple"
    assert extract_slug_from_filename("path/to/20251230_doc.md") == "doc"


def test_get_parent_heading():
    fm = {"title": "Doc Title", "tags": []}

    assert get_parent_heading("H1 Title", fm, "file.md") == "H1 Title"
    assert get_parent_heading(None, fm, "file.md") == "Doc Title"
    assert get_parent_heading(None, {"title": ""}, "20251230_slug.md") == "slug"
    assert get_parent_heading(None, {}, "20251230_slug.md") == "slug"


def test_chunk_document():
    doc = RawDocument(
        id="123",
        file_path="test.md",
        frontmatter={"title": "Test"},
        content="## Section 1\nContent 1\n\n## Section 2\nContent 2",
        content_hash="abc",
    )

    chunks = chunk_document(doc)

    assert len(chunks) == 2
    assert chunks[0].heading == "Section 1"
    assert chunks[0].content == "Content 1"
    assert chunks[1].heading == "Section 2"


def test_get_context_previous():
    chunks = [
        Chunk(0, "Parent", "H1", "First sentence。Second sentence。"),
        Chunk(1, "Parent", "H2", "Third sentence。"),
    ]

    assert get_context_previous(chunks, 0) is None
    assert get_context_previous(chunks, 1) == "First sentence。Second sentence。"


def test_split_by_h3():
    content = "### Sub1\nContent 1\n\n### Sub2\nContent 2"
    chunks = split_by_h3(content, "Parent", "Main", 0)

    assert len(chunks) == 2
    assert chunks[0].heading == "Main > Sub1"
    assert chunks[1].heading == "Main > Sub2"
```

---

## モニタリング

### ログ出力例

```
Embedding Analyzer
==================
Found 42 documents needing embedding
Excluded 3 superseded documents
Processed: docs/2024/01/note.md
  Created 5 chunks
Processed: docs/2024/01/long-doc.md
  [WARN] Chunk exceeds 32000 tokens (35000): Long Section
  Created 8 chunks
Error: docs/2024/01/broken.md: API error

Processing completed:
  Processed: 38
  Skipped:   3
Errors:
  - docs/2024/01/broken.md: API error
```
