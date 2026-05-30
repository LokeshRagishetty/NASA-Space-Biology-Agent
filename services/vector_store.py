import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy.orm import Session

from models import ChunkEmbedding, DocumentChunk, KnowledgeDocument


COLLECTION_NAME = "knowledge_documents"
VECTOR_STORE_PATH = Path(os.getenv("CHROMA_VECTOR_STORE_DIR", "vector_store")).resolve()
DEFAULT_VECTOR_BATCH_SIZE = int(os.getenv("KNOWLEDGE_VECTOR_BATCH_SIZE", "128"))

_client = None
_collection = None
_collection_lock = threading.Lock()


class VectorStoreError(Exception):
    """Base class for user-safe vector store failures."""

    status_code = 500


class VectorStoreUnavailableError(VectorStoreError):
    status_code = 503


class VectorStoreDataError(VectorStoreError):
    status_code = 409


class VectorStoreSyncError(VectorStoreError):
    status_code = 500


@dataclass(frozen=True)
class VectorRecord:
    vector_id: str
    text: str
    embedding: list[float]
    metadata: dict[str, object]


def initialize_vector_store() -> None:
    """Initialize the local ChromaDB collection if ChromaDB is available."""
    get_collection(force_refresh=True)


def get_collection(force_refresh: bool = False):
    global _client, _collection

    if _collection is not None and not force_refresh:
        return _collection

    with _collection_lock:
        if _collection is not None and not force_refresh:
            return _collection

        chromadb = _load_chromadb()
        VECTOR_STORE_PATH.mkdir(parents=True, exist_ok=True)

        try:
            _client = chromadb.PersistentClient(path=str(VECTOR_STORE_PATH))
            _collection = _client.get_or_create_collection(
                name=COLLECTION_NAME,
                metadata={
                    "description": "Document chunk embeddings for the NASA Space Biology knowledge library.",
                    "storage": "local-persistent",
                },
            )
        except Exception as exc:
            _client = None
            _collection = None
            raise VectorStoreUnavailableError(
                "ChromaDB vector store could not be opened. Check the local vector_store directory and retry."
            ) from exc

    return _collection


def health_check() -> dict[str, str]:
    try:
        collection = get_collection()
        collection.count()
    except VectorStoreError:
        raise
    except Exception as exc:
        raise VectorStoreUnavailableError("ChromaDB vector store is unavailable. Please retry in a moment.") from exc

    return {"status": "healthy", "collection": COLLECTION_NAME}


def get_collection_statistics() -> dict[str, object]:
    collection = get_collection()

    try:
        total_vectors = int(collection.count())
        all_items = collection.get(include=["metadatas"])
    except Exception as exc:
        raise VectorStoreUnavailableError(
            "Could not read vector store statistics. The ChromaDB collection may be unavailable."
        ) from exc

    document_ids = {
        metadata.get("document_id")
        for metadata in (all_items.get("metadatas") or [])
        if metadata and metadata.get("document_id") is not None
    }

    return {
        "collection_name": COLLECTION_NAME,
        "total_vectors": total_vectors,
        "total_documents": len(document_ids),
    }


def get_document_vector_statistics(db: Session, document: KnowledgeDocument) -> dict[str, int]:
    chunk_count = db.query(DocumentChunk).filter(DocumentChunk.document_id == document.id).count()
    embedding_count = (
        db.query(ChunkEmbedding)
        .join(DocumentChunk, ChunkEmbedding.chunk_id == DocumentChunk.id)
        .filter(DocumentChunk.document_id == document.id)
        .count()
    )
    stored_vectors = len(get_document_vector_ids(document.id))

    return {
        "document_id": document.id,
        "chunk_count": chunk_count,
        "embedding_count": embedding_count,
        "stored_vectors": stored_vectors,
    }


def sync_document_vectors(db: Session, document: KnowledgeDocument, force: bool = False) -> dict[str, int]:
    records = build_document_vector_records(db, document)
    desired_ids = {record.vector_id for record in records}
    existing_ids = set(get_document_vector_ids(document.id))

    if not records:
        if existing_ids:
            delete_vectors(existing_ids)
        return get_document_vector_statistics(db, document)

    if force:
        delete_vectors(existing_ids)
        existing_ids = set()
    else:
        stale_ids = existing_ids - desired_ids
        if stale_ids:
            delete_vectors(stale_ids)
            existing_ids -= stale_ids

    records_to_store = records if force else [record for record in records if record.vector_id not in existing_ids]
    if records_to_store:
        store_vectors(records_to_store)

    return get_document_vector_statistics(db, document)


def build_document_vector_records(db: Session, document: KnowledgeDocument) -> list[VectorRecord]:
    chunks = (
        db.query(DocumentChunk)
        .filter(DocumentChunk.document_id == document.id)
        .order_by(DocumentChunk.chunk_index.asc())
        .all()
    )
    if not chunks:
        return []

    rows = (
        db.query(DocumentChunk, ChunkEmbedding)
        .join(ChunkEmbedding, ChunkEmbedding.chunk_id == DocumentChunk.id)
        .filter(DocumentChunk.document_id == document.id)
        .order_by(DocumentChunk.chunk_index.asc())
        .all()
    )

    if len(rows) != len(chunks):
        raise VectorStoreDataError("Document has missing embeddings. Generate embeddings before syncing vectors.")

    records: list[VectorRecord] = []
    for chunk, embedding in rows:
        text = (chunk.content or "").strip()
        if not text:
            raise VectorStoreDataError(f"Chunk {chunk.chunk_index + 1} is missing text and cannot be stored.")

        records.append(
            VectorRecord(
                vector_id=vector_id_for_chunk(chunk.id),
                text=text,
                embedding=parse_embedding_vector(embedding.embedding_vector, chunk.id),
                metadata={
                    "document_id": int(document.id),
                    "chunk_id": int(chunk.id),
                    "chunk_index": int(chunk.chunk_index),
                    "filename": document.original_filename or "",
                    "user_id": int(document.user_id),
                },
            )
        )

    return records


def store_vectors(records: list[VectorRecord]) -> None:
    collection = get_collection()

    for batch in batched(records, DEFAULT_VECTOR_BATCH_SIZE):
        ids = [record.vector_id for record in batch]
        embeddings = [record.embedding for record in batch]
        documents = [record.text for record in batch]
        metadatas = [record.metadata for record in batch]

        try:
            if hasattr(collection, "upsert"):
                collection.upsert(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)
            else:
                collection.add(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)
        except Exception:
            try:
                collection.delete(ids=ids)
                collection.add(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)
            except Exception as exc:
                raise VectorStoreSyncError(
                    "Vector sync failed while writing to ChromaDB. Please retry the vector sync."
                ) from exc


def update_vectors(records: list[VectorRecord]) -> None:
    store_vectors(records)


def delete_document_vectors(document_id: int) -> int:
    vector_ids = get_document_vector_ids(document_id)
    delete_vectors(vector_ids)
    return len(vector_ids)


def delete_vectors_for_chunk_ids(chunk_ids: Iterable[int]) -> int:
    vector_ids = [vector_id_for_chunk(chunk_id) for chunk_id in chunk_ids]
    delete_vectors(vector_ids)
    return len(vector_ids)


def delete_vectors(vector_ids: Iterable[str]) -> None:
    ids = list(dict.fromkeys(vector_ids))
    if not ids:
        return

    collection = get_collection()
    for batch in batched(ids, DEFAULT_VECTOR_BATCH_SIZE):
        try:
            collection.delete(ids=list(batch))
        except Exception as exc:
            raise VectorStoreSyncError(
                "Vector deletion failed in ChromaDB. Please retry after checking the vector store."
            ) from exc


def get_document_vector_ids(document_id: int) -> list[str]:
    collection = get_collection()
    try:
        result = collection.get(where={"document_id": int(document_id)}, include=["metadatas"])
    except Exception as exc:
        raise VectorStoreUnavailableError(
            "Could not read document vectors from ChromaDB. The collection may be unavailable."
        ) from exc

    return list(result.get("ids") or [])


def vector_id_for_chunk(chunk_id: int) -> str:
    return f"chunk_{chunk_id}"


def parse_embedding_vector(raw_vector: str, chunk_id: int) -> list[float]:
    try:
        values: Any = json.loads(raw_vector)
    except (TypeError, json.JSONDecodeError) as exc:
        raise VectorStoreDataError(f"Embedding for chunk {chunk_id} is corrupted and cannot be synced.") from exc

    if not isinstance(values, list) or not values:
        raise VectorStoreDataError(f"Embedding for chunk {chunk_id} is empty and cannot be synced.")

    try:
        return [float(value) for value in values]
    except (TypeError, ValueError) as exc:
        raise VectorStoreDataError(f"Embedding for chunk {chunk_id} contains invalid values.") from exc


def batched(items: Iterable[Any], batch_size: int) -> Iterable[list[Any]]:
    batch: list[Any] = []
    safe_batch_size = max(1, batch_size)

    for item in items:
        batch.append(item)
        if len(batch) >= safe_batch_size:
            yield batch
            batch = []

    if batch:
        yield batch


def _load_chromadb():
    try:
        import chromadb
    except ImportError as exc:
        raise VectorStoreUnavailableError("ChromaDB is not installed. Install chromadb and restart the backend.") from exc

    return chromadb
