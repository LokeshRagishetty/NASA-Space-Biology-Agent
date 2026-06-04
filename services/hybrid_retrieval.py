import re
import time
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from models import DocumentChunk, KnowledgeDocument
from services.semantic_search import (
    DEFAULT_TOP_K,
    MAX_TOP_K,
    SearchResult,
    SemanticSearchError,
    SemanticSearchValidationError,
    search_documents,
    validate_search_query,
    validate_top_k,
)


FTS_TABLE = "knowledge_chunk_fts"
MAX_KEYWORD_CANDIDATES = 60
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
ID_RE = re.compile(r"\b(?:[A-Z]{2,}[-_ ]?\d{2,}|\d{4,})\b")
WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.@+-]*")
STOP_WORDS = {
    "a",
    "about",
    "all",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "how",
    "in",
    "is",
    "it",
    "mentioned",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "used",
    "was",
    "were",
    "what",
    "which",
    "with",
}


class HybridRetrievalError(Exception):
    """Base class for user-safe hybrid retrieval failures."""

    status_code = 500


class HybridRetrievalValidationError(HybridRetrievalError):
    status_code = 400


@dataclass(frozen=True)
class SourceCitation:
    document_id: int
    filename: str
    chunk_index: int
    chunk_id: int


@dataclass(frozen=True)
class HybridRetrievalResult:
    document_id: int
    chunk_id: int
    filename: str
    chunk_text: str
    chunk_index: int
    semantic_score: float = 0.0
    keyword_score: float = 0.0
    combined_score: float = 0.0
    matched_by: tuple[str, ...] = ()


@dataclass(frozen=True)
class HybridRetrievalResponse:
    query: str
    results: list[HybridRetrievalResult]
    semantic_matches: int
    keyword_matches: int
    merged_results: int
    final_context_count: int
    retrieval_time_ms: float


@dataclass(frozen=True)
class _KeywordCandidate:
    result: HybridRetrievalResult
    raw_score: float


def retrieve_hybrid(
    db: Session,
    query: str,
    user_id: int,
    top_k: Optional[int] = None,
    document_id: Optional[int] = None,
) -> HybridRetrievalResponse:
    start_time = time.perf_counter()
    cleaned_query = _validate_query(query)
    final_top_k = _validate_top_k(top_k or DEFAULT_TOP_K)

    semantic_results = _semantic_retrieval(db, cleaned_query, user_id, final_top_k, document_id=document_id)
    keyword_results = keyword_search(
        db,
        cleaned_query,
        user_id,
        limit=max(final_top_k * 3, final_top_k),
        document_id=document_id,
    )
    merged_results = merge_results(semantic_results, keyword_results)
    final_results = merged_results[:final_top_k]

    return HybridRetrievalResponse(
        query=cleaned_query,
        results=final_results,
        semantic_matches=len(semantic_results),
        keyword_matches=len(keyword_results),
        merged_results=len(merged_results),
        final_context_count=len(final_results),
        retrieval_time_ms=round((time.perf_counter() - start_time) * 1000, 2),
    )


def keyword_search(
    db: Session,
    query: str,
    user_id: int,
    limit: int = MAX_KEYWORD_CANDIDATES,
    document_id: Optional[int] = None,
) -> list[HybridRetrievalResult]:
    cleaned_query = _validate_query(query)
    terms = extract_keyword_terms(cleaned_query)
    safe_limit = max(1, min(limit, MAX_KEYWORD_CANDIDATES))
    candidates: dict[int, _KeywordCandidate] = {}

    for candidate in _search_keywords_fts(db, cleaned_query, terms, user_id, safe_limit, document_id=document_id):
        _upsert_keyword_candidate(candidates, candidate)

    for candidate in _search_keywords_like(db, cleaned_query, terms, user_id, document_id=document_id):
        _upsert_keyword_candidate(candidates, candidate)

    print("QUERY:", cleaned_query)

    for candidate in candidates.values():
        print(
            f"Chunk={candidate.result.chunk_id}, "
            f"Score={candidate.raw_score}, "
            f"Doc={candidate.result.filename}"
        )

    if not candidates:
        return []

    max_score = max(candidate.raw_score for candidate in candidates.values()) or 1.0
    normalized = [
        _with_scores(
            candidate.result,
            keyword_score=round(min(1.0, candidate.raw_score / max_score), 4),
        )
        for candidate in candidates.values()
        if candidate.raw_score > 0
    ]
    return sorted(normalized, key=lambda item: item.keyword_score, reverse=True)[:safe_limit]


def merge_results(
    semantic_results: list[HybridRetrievalResult],
    keyword_results: list[HybridRetrievalResult],
) -> list[HybridRetrievalResult]:
    merged: dict[int, HybridRetrievalResult] = {}

    for result in semantic_results + keyword_results:
        if result.chunk_id <= 0 or result.document_id <= 0:
            continue

        current = merged.get(result.chunk_id)
        if current is None:
            merged[result.chunk_id] = _with_scores(
                result,
                combined_score=_combined_score(result.semantic_score, result.keyword_score),
            )
            continue

        semantic_score = max(current.semantic_score, result.semantic_score)
        keyword_score = max(current.keyword_score, result.keyword_score)
        matched_by = tuple(sorted(set(current.matched_by) | set(result.matched_by)))
        merged[result.chunk_id] = _with_scores(
            current,
            semantic_score=semantic_score,
            keyword_score=keyword_score,
            combined_score=_combined_score(semantic_score, keyword_score),
            matched_by=matched_by,
        )

    return sorted(
        merged.values(),
        key=lambda item: (item.combined_score, item.keyword_score, item.semantic_score),
        reverse=True,
    )


def citation_for_result(result: HybridRetrievalResult) -> SourceCitation:
    return SourceCitation(
        document_id=result.document_id,
        filename=result.filename,
        chunk_index=result.chunk_index,
        chunk_id=result.chunk_id,
    )


def extract_keyword_terms(query: str) -> list[str]:
    terms = []
    for match in WORD_RE.finditer(query.lower()):
        term = match.group(0).strip("._+-")
        if len(term) < 2 or term in STOP_WORDS:
            continue
        terms.append(term)
    return list(dict.fromkeys(terms))


def _semantic_retrieval(
    db: Session,
    query: str,
    user_id: int,
    final_top_k: int,
    document_id: Optional[int] = None,
) -> list[HybridRetrievalResult]:
    semantic_top_k = min(MAX_TOP_K, max(final_top_k, final_top_k * 2))

    try:
        response = search_documents(
            db=db,
            query=query,
            user_id=user_id,
            top_k=semantic_top_k,
            document_id=document_id,
        )
    except SemanticSearchValidationError as exc:
        raise HybridRetrievalValidationError(str(exc)) from exc
    except SemanticSearchError:
        return []

    chunk_ids = [result.chunk_id for result in response.results if result.chunk_id > 0]
    owned_chunks = _owned_chunk_rows(db, user_id, chunk_ids, document_id=document_id)
    semantic_results: list[HybridRetrievalResult] = []

    for result in response.results:
        row = owned_chunks.get(result.chunk_id)
        if row is None:
            continue

        chunk, document = row
        semantic_results.append(
            HybridRetrievalResult(
                document_id=document.id,
                chunk_id=chunk.id,
                filename=document.original_filename or result.filename or "Unknown",
                chunk_text=chunk.content or result.chunk_text or "",
                chunk_index=chunk.chunk_index,
                semantic_score=max(0.0, min(1.0, result.similarity_score)),
                keyword_score=0.0,
                combined_score=0.0,
                matched_by=("semantic",),
            )
        )

    return semantic_results


def _search_keywords_fts(
    db: Session,
    query: str,
    terms: list[str],
    user_id: int,
    limit: int,
    document_id: Optional[int] = None,
) -> list[_KeywordCandidate]:
    if not _is_sqlite(db) or not terms:
        return []

    fts_query = _build_fts_query(terms)
    if not fts_query:
        return []

    document_filter = "AND document_id = :document_id" if document_id is not None else ""
    params = {"query": fts_query, "user_id": int(user_id), "limit": int(limit)}
    if document_id is not None:
        params["document_id"] = int(document_id)

    try:
        _refresh_fts_table(db, user_id)
        rows = (
            db.execute(
                text(
                    f"""
                    SELECT
                        chunk_id,
                        document_id,
                        filename,
                        chunk_index,
                        chunk_text,
                        extracted_text,
                        bm25({FTS_TABLE}) AS rank
                    FROM {FTS_TABLE}
                    WHERE {FTS_TABLE} MATCH :query
                      AND user_id = :user_id
                      {document_filter}
                    ORDER BY rank
                    LIMIT :limit
                    """
                ),
                params,
            )
            .mappings()
            .all()
        )
    except SQLAlchemyError:
        return []

    candidates: list[_KeywordCandidate] = []
    rank_bonus = len(rows)

    for index, row in enumerate(rows):
        raw_score = score_keyword_match(
            query=query,
            terms=terms,
            chunk_text=row.get("chunk_text") or "",
            extracted_text=row.get("extracted_text") or "",
        )
        raw_score += max(0.1, rank_bonus - index)
        candidates.append(_candidate_from_mapping(row, raw_score))

    return candidates


def _search_keywords_like(
    db: Session,
    query: str,
    terms: list[str],
    user_id: int,
    document_id: Optional[int] = None,
) -> list[_KeywordCandidate]:
    query_rows = (
        db.query(DocumentChunk, KnowledgeDocument)
        .join(KnowledgeDocument, DocumentChunk.document_id == KnowledgeDocument.id)
        .filter(KnowledgeDocument.user_id == int(user_id))
    )
    if document_id is not None:
        query_rows = query_rows.filter(KnowledgeDocument.id == int(document_id))

    rows = query_rows.all()

    candidates: list[_KeywordCandidate] = []
    for chunk, document in rows:
        raw_score = score_keyword_match(
            query=query,
            terms=terms,
            chunk_text=chunk.content or "",
            extracted_text=document.extracted_text or "",
        )
        if raw_score <= 0:
            continue

        candidates.append(
            _KeywordCandidate(
                result=HybridRetrievalResult(
                    document_id=document.id,
                    chunk_id=chunk.id,
                    filename=document.original_filename or "Unknown",
                    chunk_text=chunk.content or "",
                    chunk_index=chunk.chunk_index,
                    keyword_score=0.0,
                    matched_by=("keyword",),
                ),
                raw_score=raw_score,
            )
        )

    return candidates


def score_keyword_match(query: str, terms: list[str], chunk_text: str, extracted_text: str) -> float:
    query_lower = query.lower()
    chunk_lower = chunk_text.lower()
    extracted_lower = extracted_text.lower()
    score = 0.0

    if len(query_lower) >= 4:
        if query_lower in chunk_lower:
            score += 8.0
        elif query_lower in extracted_lower:
            score += 3.0

    for term in terms:
        if term in chunk_lower:
            score += 3.0
        elif term in extracted_lower:
            score += 0.75

    if _is_email_query(query_lower) and EMAIL_RE.search(chunk_text):
        print("EMAIL MATCH FOUND")
        print(chunk_text[:500])
        score += 12.0

    if _is_id_query(query_lower) and ID_RE.search(chunk_text):
        score += 8.0

    if "objective" in terms and re.search(r"\bobjectives?\b", chunk_lower):
        score += 8.0

    if "future" in terms and re.search(r"\bfuture\b", chunk_lower):
        score += 4.0

    if any(term.startswith("enhancement") for term in terms) and re.search(r"\benhancements?\b", chunk_lower):
        score += 6.0

    if any(term in {"technology", "technologies", "tech"} for term in terms):
        if re.search(r"\b(technology|technologies|tech stack|tools?|frameworks?)\b", chunk_lower):
            score += 5.0

    return score


def _refresh_fts_table(db: Session, user_id: int) -> None:
    db.execute(
        text(
            f"""
            CREATE VIRTUAL TABLE IF NOT EXISTS {FTS_TABLE}
            USING fts5(
                chunk_id UNINDEXED,
                document_id UNINDEXED,
                user_id UNINDEXED,
                filename UNINDEXED,
                chunk_index UNINDEXED,
                chunk_text,
                extracted_text
            )
            """
        )
    )
    db.execute(text(f"DELETE FROM {FTS_TABLE} WHERE user_id = :user_id"), {"user_id": int(user_id)})
    db.execute(
        text(
            f"""
            INSERT INTO {FTS_TABLE}
                (chunk_id, document_id, user_id, filename, chunk_index, chunk_text, extracted_text)
            SELECT
                c.id,
                d.id,
                d.user_id,
                d.original_filename,
                c.chunk_index,
                c.content,
                COALESCE(d.extracted_text, '')
            FROM document_chunks c
            JOIN knowledge_documents d ON d.id = c.document_id
            WHERE d.user_id = :user_id
              AND COALESCE(c.content, '') != ''
            """
        ),
        {"user_id": int(user_id)},
    )


def _owned_chunk_rows(
    db: Session,
    user_id: int,
    chunk_ids: list[int],
    document_id: Optional[int] = None,
) -> dict[int, tuple[DocumentChunk, KnowledgeDocument]]:
    if not chunk_ids:
        return {}

    query = (
        db.query(DocumentChunk, KnowledgeDocument)
        .join(KnowledgeDocument, DocumentChunk.document_id == KnowledgeDocument.id)
        .filter(
            KnowledgeDocument.user_id == int(user_id),
            DocumentChunk.id.in_(list(dict.fromkeys(chunk_ids))),
        )
    )
    if document_id is not None:
        query = query.filter(KnowledgeDocument.id == int(document_id))

    rows = query.all()
    return {chunk.id: (chunk, document) for chunk, document in rows}


def _candidate_from_mapping(row, raw_score: float) -> _KeywordCandidate:
    return _KeywordCandidate(
        result=HybridRetrievalResult(
            document_id=_safe_int(row.get("document_id")),
            chunk_id=_safe_int(row.get("chunk_id")),
            filename=str(row.get("filename") or "Unknown"),
            chunk_text=row.get("chunk_text") or "",
            chunk_index=_safe_int(row.get("chunk_index")),
            keyword_score=0.0,
            matched_by=("keyword",),
        ),
        raw_score=raw_score,
    )


def _upsert_keyword_candidate(candidates: dict[int, _KeywordCandidate], candidate: _KeywordCandidate) -> None:
    if candidate.result.chunk_id <= 0 or candidate.raw_score <= 0:
        return

    current = candidates.get(candidate.result.chunk_id)
    if current is None or candidate.raw_score > current.raw_score:
        candidates[candidate.result.chunk_id] = candidate


def _with_scores(
    result: HybridRetrievalResult,
    semantic_score: Optional[float] = None,
    keyword_score: Optional[float] = None,
    combined_score: Optional[float] = None,
    matched_by: Optional[tuple[str, ...]] = None,
) -> HybridRetrievalResult:
    return HybridRetrievalResult(
        document_id=result.document_id,
        chunk_id=result.chunk_id,
        filename=result.filename,
        chunk_text=result.chunk_text,
        chunk_index=result.chunk_index,
        semantic_score=result.semantic_score if semantic_score is None else semantic_score,
        keyword_score=result.keyword_score if keyword_score is None else keyword_score,
        combined_score=result.combined_score if combined_score is None else combined_score,
        matched_by=result.matched_by if matched_by is None else matched_by,
    )


def _combined_score(semantic_score: float, keyword_score: float) -> float:
    base_score = max(semantic_score, keyword_score)
    secondary_score = min(semantic_score, keyword_score) * 0.2
    dual_match_bonus = 0.15 if semantic_score > 0 and keyword_score > 0 else 0.0
    return round(min(1.0, base_score + secondary_score + dual_match_bonus), 4)


def _build_fts_query(terms: list[str]) -> str:
    safe_terms = [term.replace('"', '""') for term in terms if term]
    return " OR ".join(f'"{term}"' for term in safe_terms)


def _is_email_query(query_lower: str) -> bool:
    return "email" in query_lower or "e-mail" in query_lower


def _is_id_query(query_lower: str) -> bool:
    return bool(re.search(r"\b(ids?|identifiers?|accession|number)\b", query_lower))


def _is_sqlite(db: Session) -> bool:
    bind = db.get_bind()
    return bind.dialect.name == "sqlite"


def _validate_query(query: str) -> str:
    try:
        return validate_search_query(query)
    except SemanticSearchValidationError as exc:
        raise HybridRetrievalValidationError(str(exc)) from exc


def _validate_top_k(top_k: int) -> int:
    try:
        return validate_top_k(top_k)
    except SemanticSearchValidationError as exc:
        raise HybridRetrievalValidationError(str(exc)) from exc


def _safe_int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0
