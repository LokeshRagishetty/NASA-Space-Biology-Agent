"""
Semantic search service for querying document embeddings.

Responsibilities:
- Generate query embeddings
- Search ChromaDB with similarity scoring
- Score normalization
- Result formatting and filtering
- User isolation enforcement
"""

import time
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from models import KnowledgeDocument
from services.embedding_service import generate_embeddings
from services.vector_store import get_collection


# Maximum allowed results per search
MAX_TOP_K = 20

# Default number of results
DEFAULT_TOP_K = 5

# Minimum similarity score (0-1 range)
MIN_SIMILARITY_SCORE = 0.0


class SemanticSearchError(Exception):
    """Base class for user-safe semantic search failures."""

    status_code = 500


class SemanticSearchValidationError(SemanticSearchError):
    status_code = 400


class SemanticSearchUnavailableError(SemanticSearchError):
    status_code = 503


class SemanticSearchDataError(SemanticSearchError):
    status_code = 409


@dataclass(frozen=True)
class SearchResult:
    """Individual search result."""

    document_id: int
    chunk_id: int
    filename: str
    chunk_text: str
    similarity_score: float
    chunk_index: int


@dataclass(frozen=True)
class SearchResponse:
    """Complete search response."""

    query: str
    results: list[SearchResult]
    total_results: int
    search_time_ms: float
    highest_similarity_score: Optional[float] = None


def validate_search_query(query: str) -> str:
    """
    Validate and clean search query.

    Args:
        query: Raw query string

    Raises:
        SemanticSearchValidationError: If query is invalid

    Returns:
        Cleaned query string
    """
    if not query:
        raise SemanticSearchValidationError("Search query cannot be empty.")

    cleaned = query.strip()
    if not cleaned:
        raise SemanticSearchValidationError("Search query cannot be empty or whitespace only.")

    if len(cleaned) > 4000:
        raise SemanticSearchValidationError("Search query cannot exceed 4000 characters.")

    return cleaned


def validate_top_k(top_k: Optional[int] = None) -> int:
    """
    Validate and normalize top_k parameter.

    Args:
        top_k: Requested number of results

    Raises:
        SemanticSearchValidationError: If top_k is invalid

    Returns:
        Validated top_k value
    """
    if top_k is None:
        return DEFAULT_TOP_K

    if not isinstance(top_k, int):
        raise SemanticSearchValidationError("top_k must be an integer.")

    if top_k < 1:
        raise SemanticSearchValidationError("top_k must be at least 1.")

    if top_k > MAX_TOP_K:
        raise SemanticSearchValidationError(f"top_k cannot exceed {MAX_TOP_K}.")

    return top_k


def search_documents(
    db: Session,
    query: str,
    user_id: int,
    top_k: Optional[int] = None,
    document_id: Optional[int] = None,
) -> SearchResponse:
    """
    Search documents using semantic similarity.

    Args:
        db: Database session
        query: Search query string
        user_id: ID of the user performing the search
        top_k: Number of results to return (default: DEFAULT_TOP_K, max: MAX_TOP_K)
        document_id: Optional document ID to limit search to one document

    Returns:
        SearchResponse with results and metadata

    Raises:
        SemanticSearchValidationError: If query or parameters are invalid
        SemanticSearchUnavailableError: If embedding or vector store is unavailable
        SemanticSearchDataError: If data integrity issues are detected
    """
    start_time = time.time()

    # Validate inputs
    cleaned_query = validate_search_query(query)
    validated_top_k = validate_top_k(top_k)

    # Generate query embedding
    try:
        query_embeddings = generate_embeddings([cleaned_query])
        if not query_embeddings or not query_embeddings[0]:
            raise SemanticSearchUnavailableError("Failed to generate query embedding. Please retry.")
        query_embedding = query_embeddings[0]
    except Exception as exc:
        if isinstance(exc, SemanticSearchError):
            raise
        raise SemanticSearchUnavailableError("Query embedding generation failed. Please retry.") from exc

    where_filter = {"user_id": int(user_id)}

    if document_id is not None:
        where_filter = {
        "$and": [
            {"user_id": int(user_id)},
            {"document_id": int(document_id)},
        ]
    }
    # Query ChromaDB
    try:
        collection = get_collection()
        print("QUERY EMBEDDING LENGTH:", len(query_embedding))
        print("WHERE FILTER:", where_filter)
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=validated_top_k,
            where=where_filter,
            include=["documents", "metadatas", "distances"],
        )
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise SemanticSearchUnavailableError("Vector store query failed. Please retry.") from exc

    # Parse and format results
    search_results: list[SearchResult] = []
    highest_score: Optional[float] = None

    ids = results.get("ids", [[]])[0] if results.get("ids") else []
    distances = results.get("distances", [[]])[0] if results.get("distances") else []
    print("RAW DISTANCES:", distances)
    documents = results.get("documents", [[]])[0] if results.get("documents") else []
    metadatas = results.get("metadatas", [[]])[0] if results.get("metadatas") else []

    for idx, (vec_id, distance, doc_text, metadata) in enumerate(
        zip(ids, distances, documents, metadatas)
    ):
        if not metadata:
            continue

        # Convert distance to similarity score (ChromaDB returns distances, we convert to similarity)
        # For cosine distance, similarity = 1 - distance/2 (normalized to 0-1)
        # similarity_score = max(0.0, 1.0 - float(distance))
        similarity_score = 1.0 / (1.0 + float(distance))

        result = SearchResult(
            document_id=int(metadata.get("document_id", 0)),
            chunk_id=int(metadata.get("chunk_id", 0)),
            filename=str(metadata.get("filename", "Unknown")),
            chunk_text=doc_text or "",
            similarity_score=round(similarity_score, 4),
            chunk_index=int(metadata.get("chunk_index", 0)),
        )

        search_results.append(result)

        if highest_score is None or result.similarity_score > highest_score:
            highest_score = result.similarity_score

    # Calculate search time
    search_time_ms = round((time.time() - start_time) * 1000, 2)

    return SearchResponse(
        query=cleaned_query,
        results=search_results,
        total_results=len(search_results),
        search_time_ms=search_time_ms,
        highest_similarity_score=highest_score,
    )


def get_search_statistics(db: Session, user_id: int) -> dict:
    """
    Get aggregate search statistics for a user.

    Args:
        db: Database session
        user_id: ID of the user

    Returns:
        Dictionary with search statistics
    """
    from models import DocumentChunk, ChunkEmbedding

    # Count user's documents and chunks
    docs_count = db.query(KnowledgeDocument).filter(
        KnowledgeDocument.user_id == user_id
    ).count()

    chunks_count = db.query(DocumentChunk).join(
        KnowledgeDocument,
        DocumentChunk.document_id == KnowledgeDocument.id
    ).filter(
        KnowledgeDocument.user_id == user_id
    ).count()

    embeddings_count = db.query(ChunkEmbedding).join(
        DocumentChunk,
        ChunkEmbedding.chunk_id == DocumentChunk.id
    ).join(
        KnowledgeDocument,
        DocumentChunk.document_id == KnowledgeDocument.id
    ).filter(
        KnowledgeDocument.user_id == user_id
    ).count()

    return {
        "documents_count": docs_count,
        "chunks_count": chunks_count,
        "embeddings_count": embeddings_count,
        "searchable": embeddings_count > 0,
    }
