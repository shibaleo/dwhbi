"""Embedding pipeline orchestration."""

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
