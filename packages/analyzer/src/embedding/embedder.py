"""Voyage AI embedding client."""

import time
from typing import Any, Sequence

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
    ) -> Any:
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
