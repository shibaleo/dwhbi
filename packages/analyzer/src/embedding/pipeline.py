"""Embedding pipeline orchestration."""

import sys
from dataclasses import dataclass

from .chunker import build_embedding_text, chunk_document, filter_empty_chunks
from .config import Config
from .db import DocsRepository
from .embedder import EmbeddingClient
from .types import Chunk, ChunkWithEmbedding, ProcessingResult, RawDocument

# Windows console encoding fix
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore


@dataclass
class PreparedDocument:
    """チャンキング済みドキュメント"""

    doc: RawDocument
    chunks: list[Chunk]
    texts: list[str]


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

        if not target_docs:
            return result

        # Phase 1: 全ドキュメントをチャンキング
        print("Chunking documents...")
        prepared: list[PreparedDocument] = []
        empty_docs: list[RawDocument] = []

        for doc in target_docs:
            chunks = chunk_document(doc, self.config.max_tokens)
            chunks = filter_empty_chunks(chunks)

            if not chunks:
                empty_docs.append(doc)
            else:
                texts = [build_embedding_text(c, doc.frontmatter) for c in chunks]
                prepared.append(PreparedDocument(doc=doc, chunks=chunks, texts=texts))

        # 空ドキュメントの処理
        for doc in empty_docs:
            self.db.record_embedding_hash(doc.id, doc.content_hash)
            result.processed += 1
            print(f"  Empty: {doc.file_path}")

        if not prepared:
            return result

        # Phase 2: 全テキストを集約してバッチembedding
        print(f"Embedding {sum(len(p.texts) for p in prepared)} chunks from {len(prepared)} documents...")

        all_texts: list[str] = []
        text_to_doc_idx: list[int] = []  # 各テキストがどのドキュメントに属するか

        for idx, p in enumerate(prepared):
            for text in p.texts:
                all_texts.append(text)
                text_to_doc_idx.append(idx)

        # 一括でembedding生成
        try:
            all_embeddings = self.embedder.embed_texts(all_texts)
        except Exception as e:
            # embedding失敗時は全ドキュメントをエラーとして記録
            for p in prepared:
                result.errors.append(f"{p.doc.file_path}: {e}")
            print(f"Embedding failed: {e}")
            return result

        # Phase 3: embeddingを各ドキュメントに振り分けてDB保存
        print("Saving to database...")
        embedding_idx = 0

        for idx, p in enumerate(prepared):
            try:
                doc_embeddings = all_embeddings[embedding_idx : embedding_idx + len(p.chunks)]
                embedding_idx += len(p.chunks)

                chunks_with_embedding = [
                    ChunkWithEmbedding(
                        chunk_index=chunk.chunk_index,
                        parent_heading=chunk.parent_heading,
                        heading=chunk.heading,
                        content=chunk.content,
                        embedding=embedding,
                    )
                    for chunk, embedding in zip(p.chunks, doc_embeddings)
                ]

                self.db.delete_chunks(p.doc.id)
                self.db.insert_chunks(p.doc.id, chunks_with_embedding)
                self.db.record_embedding_hash(p.doc.id, p.doc.content_hash)

                result.processed += 1
                print(f"  Saved: {p.doc.file_path} ({len(chunks_with_embedding)} chunks)")

            except Exception as e:
                result.errors.append(f"{p.doc.file_path}: {e}")
                print(f"  Error: {p.doc.file_path}: {e}")

        return result
