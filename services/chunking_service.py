import math
import os
import re
from dataclasses import dataclass

from sqlalchemy.orm import Session

from models import ChunkEmbedding, DocumentChunk, KnowledgeDocument


DEFAULT_CHUNK_SIZE = int(os.getenv("KNOWLEDGE_CHUNK_SIZE", "1000"))
DEFAULT_CHUNK_OVERLAP = int(os.getenv("KNOWLEDGE_CHUNK_OVERLAP", "150"))
MAX_CHUNK_SOURCE_CHARS = int(os.getenv("KNOWLEDGE_MAX_CHUNK_SOURCE_CHARS", "500000"))


class ChunkingError(Exception):
    """Raised when extracted text cannot be safely converted into chunks."""


@dataclass(frozen=True)
class GeneratedChunk:
    chunk_index: int
    content: str
    char_count: int
    token_estimate: int


def estimate_token_count(content: str) -> int:
    if not content:
        return 0
    return max(1, math.ceil(len(content) / 4))


def generate_chunks(
    text: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> list[GeneratedChunk]:
    if chunk_size <= 0:
        raise ChunkingError("Chunk size must be greater than zero.")
    if overlap < 0:
        raise ChunkingError("Chunk overlap cannot be negative.")
    if overlap >= chunk_size:
        raise ChunkingError("Chunk overlap must be smaller than chunk size.")

    source_text = clean_source_text(text)
    if not source_text:
        return []
    if len(source_text) > MAX_CHUNK_SOURCE_CHARS:
        raise ChunkingError("Extracted text is too large to chunk safely. Reduce the extracted text limit and retry.")

    chunks: list[GeneratedChunk] = []
    start = 0
    text_length = len(source_text)

    while start < text_length:
        tentative_end = min(start + chunk_size, text_length)
        end = text_length if tentative_end >= text_length else find_chunk_boundary(source_text, start, tentative_end)
        content = source_text[start:end].strip()

        if content:
            chunks.append(
                GeneratedChunk(
                    chunk_index=len(chunks),
                    content=content,
                    char_count=len(content),
                    token_estimate=estimate_token_count(content),
                )
            )

        if end >= text_length:
            break

        next_start = max(start + 1, end - overlap)
        start = move_start_to_word_boundary(source_text, next_start)

    return chunks


def clean_source_text(text: str) -> str:
    normalized = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def find_chunk_boundary(text: str, start: int, tentative_end: int) -> int:
    minimum_end = start + max(1, int((tentative_end - start) * 0.65))
    window = text[start:tentative_end]
    sentence_matches = list(re.finditer(r"[.!?](?:[\"')\]]+)?(?:\s+|$)", window))

    for match in reversed(sentence_matches):
        boundary = start + match.end()
        if boundary >= minimum_end:
            return boundary

    for separator in ("\n\n", "\n", " "):
        boundary = text.rfind(separator, minimum_end, tentative_end)
        if boundary > start:
            return boundary + len(separator)

    return tentative_end


def move_start_to_word_boundary(text: str, start: int) -> int:
    if start <= 0 or start >= len(text):
        return start

    if not text[start - 1].isalnum() or not text[start].isalnum():
        return start

    cursor = start
    while cursor < len(text) and text[cursor].isalnum():
        cursor += 1

    while cursor < len(text) and text[cursor].isspace():
        cursor += 1

    return cursor if cursor < len(text) else start


def delete_document_chunks(db: Session, document_id: int) -> int:
    chunk_ids = [
        chunk_id
        for (chunk_id,) in db.query(DocumentChunk.id)
        .filter(DocumentChunk.document_id == document_id)
        .all()
    ]

    if chunk_ids:
        db.query(ChunkEmbedding).filter(ChunkEmbedding.chunk_id.in_(chunk_ids)).delete(synchronize_session=False)

    return (
        db.query(DocumentChunk)
        .filter(DocumentChunk.document_id == document_id)
        .delete(synchronize_session=False)
    )


def replace_document_chunks(db: Session, document: KnowledgeDocument) -> list[DocumentChunk]:
    generated_chunks = generate_chunks(document.extracted_text or "")
    delete_document_chunks(db, document.id)

    chunk_records = [
        DocumentChunk(
            document_id=document.id,
            chunk_index=chunk.chunk_index,
            content=chunk.content,
            char_count=chunk.char_count,
            token_estimate=chunk.token_estimate,
        )
        for chunk in generated_chunks
    ]

    if chunk_records:
        db.add_all(chunk_records)
        db.flush()

    return chunk_records


def list_document_chunks(db: Session, document_id: int) -> list[DocumentChunk]:
    return (
        db.query(DocumentChunk)
        .filter(DocumentChunk.document_id == document_id)
        .order_by(DocumentChunk.chunk_index.asc())
        .all()
    )


def get_document_chunk_statistics(db: Session, document: KnowledgeDocument) -> dict[str, int]:
    chunks = list_document_chunks(db, document.id)
    extracted_text = document.extracted_text or ""
    chunked_characters = sum(chunk.char_count for chunk in chunks)
    estimated_tokens = sum(chunk.token_estimate for chunk in chunks)
    chunk_count = len(chunks)

    return {
        "document_id": document.id,
        "page_count": estimate_page_count(document),
        "extracted_characters": len(extracted_text),
        "chunk_count": chunk_count,
        "total_characters": len(extracted_text),
        "chunked_characters": chunked_characters,
        "average_chunk_size": round(chunked_characters / chunk_count) if chunk_count else 0,
        "estimated_tokens": estimated_tokens,
    }


def estimate_page_count(document: KnowledgeDocument) -> int:
    extracted_text = document.extracted_text or ""
    page_markers = re.findall(r"(?m)^Page\s+\d+\b", extracted_text)
    if page_markers:
        return len(page_markers)
    if document.content_type.startswith("image/") and extracted_text:
        return 1
    return 0
