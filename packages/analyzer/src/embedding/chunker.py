"""Chunking logic for documents."""

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
