import json
import os
import threading
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from models import ChunkEmbedding, DocumentChunk, KnowledgeDocument
from services.vector_store import delete_document_vectors, sync_document_vectors


EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
EMBEDDING_DIMENSION = 384
DEFAULT_EMBEDDING_BATCH_SIZE = int(os.getenv("KNOWLEDGE_EMBEDDING_BATCH_SIZE", "32"))

_model = None
_model_lock = threading.Lock()
_model_load_count = 0


class EmbeddingServiceError(Exception):
    """Base class for user-safe embedding service failures."""

    status_code = 500


class EmbeddingModelLoadError(EmbeddingServiceError):
    status_code = 503


class EmbeddingGenerationError(EmbeddingServiceError):
    status_code = 500


class EmbeddingDataError(EmbeddingServiceError):
    status_code = 409


@dataclass(frozen=True)
class EmbeddingStats:
    document_id: int
    embedding_model: str
    chunk_count: int
    embedding_count: int
    embedding_dimension: int


def get_embedding_model():
    global _model, _model_load_count

    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model

        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise EmbeddingModelLoadError(
                "Embedding generation is not available. Install sentence-transformers and retry."
            ) from exc

        try:
            _model = SentenceTransformer(EMBEDDING_MODEL_NAME)
            _model_load_count += 1
        except Exception as exc:
            raise EmbeddingModelLoadError(
                "Embedding model could not be loaded. Check that all-MiniLM-L6-v2 is cached or downloadable, then retry."
            ) from exc

    return _model


def get_embedding_model_load_count() -> int:
    return _model_load_count


def generate_embeddings(texts: list[str], batch_size: int = DEFAULT_EMBEDDING_BATCH_SIZE) -> list[list[float]]:
    cleaned_texts = [(text or "").strip() for text in texts]
    if not cleaned_texts:
        return []
    if any(not text for text in cleaned_texts):
        raise EmbeddingDataError("One or more chunks are missing text and cannot be embedded.")

    model = get_embedding_model()

    try:
        vectors = model.encode(
            cleaned_texts,
            batch_size=batch_size,
            show_progress_bar=False,
            convert_to_numpy=True,
        )
    except EmbeddingServiceError:
        raise
    except Exception as exc:
        raise EmbeddingGenerationError("Embedding generation failed. Please retry in a moment.") from exc

    if hasattr(vectors, "tolist"):
        vectors = vectors.tolist()

    embedding_vectors = [[float(value) for value in vector] for vector in vectors]
    if len(embedding_vectors) != len(cleaned_texts):
        raise EmbeddingGenerationError("Embedding generation returned an unexpected number of vectors.")
    if any(not vector for vector in embedding_vectors):
        raise EmbeddingGenerationError("Embedding generation returned an empty vector.")

    return embedding_vectors


def list_document_chunks_for_embeddings(db: Session, document_id: int) -> list[DocumentChunk]:
    return (
        db.query(DocumentChunk)
        .filter(DocumentChunk.document_id == document_id)
        .order_by(DocumentChunk.chunk_index.asc())
        .all()
    )


def delete_document_embeddings(db: Session, document_id: int) -> int:
    chunk_ids = [
        chunk_id
        for (chunk_id,) in db.query(DocumentChunk.id)
        .filter(DocumentChunk.document_id == document_id)
        .all()
    ]

    if not chunk_ids:
        return 0

    return (
        db.query(ChunkEmbedding)
        .filter(ChunkEmbedding.chunk_id.in_(chunk_ids))
        .delete(synchronize_session=False)
    )


def get_document_embedding_statistics(db: Session, document: KnowledgeDocument) -> dict[str, object]:
    stats = _build_embedding_stats(db, document.id)
    return stats.__dict__


def sync_document_embeddings(db: Session, document: KnowledgeDocument, force: bool = False) -> dict[str, object]:
    chunks = list_document_chunks_for_embeddings(db, document.id)
    if not chunks:
        delete_document_embeddings(db, document.id)
        delete_document_vectors(document.id)
        db.flush()
        return get_document_embedding_statistics(db, document)

    if not force and _document_embeddings_are_current(db, document.id, len(chunks)):
        sync_document_vectors(db, document)
        return get_document_embedding_statistics(db, document)

    return regenerate_document_embeddings(db, document, chunks=chunks)


def regenerate_document_embeddings(
    db: Session,
    document: KnowledgeDocument,
    chunks: Optional[list[DocumentChunk]] = None,
) -> dict[str, object]:
    chunk_records = chunks if chunks is not None else list_document_chunks_for_embeddings(db, document.id)
    delete_document_embeddings(db, document.id)

    if not chunk_records:
        delete_document_vectors(document.id)
        db.flush()
        return get_document_embedding_statistics(db, document)

    chunk_texts = []
    for chunk in chunk_records:
        content = (chunk.content or "").strip()
        if not content:
            raise EmbeddingDataError(f"Chunk {chunk.chunk_index + 1} is missing text and cannot be embedded.")
        chunk_texts.append(content)

    vectors = generate_embeddings(chunk_texts)
    dimensions = {len(vector) for vector in vectors}
    if len(dimensions) != 1:
        raise EmbeddingGenerationError("Embedding generation returned inconsistent vector dimensions.")

    embedding_dimension = dimensions.pop()
    embedding_records = [
        ChunkEmbedding(
            chunk_id=chunk.id,
            embedding_model=EMBEDDING_MODEL_NAME,
            embedding_dimension=embedding_dimension,
            embedding_vector=json.dumps(vector, separators=(",", ":")),
        )
        for chunk, vector in zip(chunk_records, vectors)
    ]

    db.add_all(embedding_records)
    db.flush()
    sync_document_vectors(db, document, force=True)
    return get_document_embedding_statistics(db, document)


def _document_embeddings_are_current(db: Session, document_id: int, chunk_count: int) -> bool:
    rows = (
        db.query(ChunkEmbedding.embedding_dimension)
        .join(DocumentChunk, ChunkEmbedding.chunk_id == DocumentChunk.id)
        .filter(
            DocumentChunk.document_id == document_id,
            ChunkEmbedding.embedding_model == EMBEDDING_MODEL_NAME,
        )
        .all()
    )

    return len(rows) == chunk_count and all(row[0] > 0 for row in rows)


def _build_embedding_stats(db: Session, document_id: int) -> EmbeddingStats:
    chunk_count = db.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).count()
    embedding_rows = (
        db.query(ChunkEmbedding.embedding_dimension)
        .join(DocumentChunk, ChunkEmbedding.chunk_id == DocumentChunk.id)
        .filter(
            DocumentChunk.document_id == document_id,
            ChunkEmbedding.embedding_model == EMBEDDING_MODEL_NAME,
        )
        .all()
    )
    embedding_dimension = embedding_rows[0][0] if embedding_rows else EMBEDDING_DIMENSION

    return EmbeddingStats(
        document_id=document_id,
        embedding_model=EMBEDDING_MODEL_NAME,
        chunk_count=chunk_count,
        embedding_count=len(embedding_rows),
        embedding_dimension=embedding_dimension,
    )
