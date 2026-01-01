"""Type definitions for embedding module."""

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
    """raw.docs_githubから取得したドキュメント"""
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
