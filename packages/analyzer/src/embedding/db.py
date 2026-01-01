"""Database operations for embedding module."""

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
