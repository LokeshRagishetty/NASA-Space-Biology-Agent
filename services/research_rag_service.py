import logging
import os
import re
import time
from dataclasses import asdict, dataclass
from typing import Optional
from urllib.parse import quote

import requests
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate

from services.query_expansion_service import expand_research_query
from services.rag_service import (
    DEFAULT_CONTEXT_CHAR_LIMIT,
    ContextWindow,
    GroqUnavailableError,
    RagRetrievalError,
    RagTimeoutError,
    build_rag_response,
    get_groq_llm,
    is_timeout_error,
    validate_rag_query,
)


logger = logging.getLogger(__name__)
ADS_SEARCH_URL = "https://api.adsabs.harvard.edu/v1/search/query"
ADS_FIELDS = "title,author,abstract,pubdate,doi,bibcode,score,citation_count"
DEFAULT_RESEARCH_TOP_K = int(os.getenv("RESEARCH_RAG_TOP_K", "5"))
ADS_TIMEOUT_SECONDS = float(os.getenv("NASA_ADS_TIMEOUT_SECONDS", "10"))
MIN_RESULTS_BEFORE_EXPANSION = int(os.getenv("RESEARCH_RAG_MIN_RESULTS_BEFORE_EXPANSION", "3"))
INSUFFICIENT_RESEARCH_CONTEXT_MESSAGE = (
    "I could not find enough evidence in the retrieved NASA ADS papers."
)


@dataclass(frozen=True)
class ResearchPaper:
    title: str
    authors: list[str]
    abstract: str
    pubdate: Optional[str]
    doi: Optional[str]
    bibcode: str
    score: float = 0.0
    citation_count: Optional[int] = None

    @property
    def year(self) -> Optional[int]:
        if not self.pubdate:
            return None
        match = re.search(r"\d{4}", self.pubdate)
        return int(match.group(0)) if match else None

    @property
    def ads_url(self) -> str:
        return f"https://ui.adsabs.harvard.edu/abs/{quote(self.bibcode, safe='')}/abstract"


@dataclass(frozen=True)
class ResearchCitation:
    title: str
    authors: list[str]
    year: Optional[int]
    doi: Optional[str]
    ads_url: str
    citation_count: Optional[int] = None


@dataclass(frozen=True)
class ResearchContextWindow:
    context: str
    papers_used: int
    context_length: int
    citations: list[ResearchCitation]


@dataclass(frozen=True)
class ResearchRetrievalResult:
    papers: list[ResearchPaper]
    query_expansion_used: bool
    expanded_queries: list[str]
    results_per_query: dict[str, int]


@dataclass(frozen=True)
class ResearchRagResponse:
    answer: str
    papers_retrieved: int
    papers_used: int
    context_length: int
    response_time_ms: float
    citations: list[ResearchCitation]
    original_query: str
    resolved_query: str
    query_expansion_used: bool
    expanded_queries: list[str]

    def to_dict(self) -> dict[str, object]:
        return {
            "answer": self.answer,
            "papers_retrieved": self.papers_retrieved,
            "papers_used": self.papers_used,
            "context_length": self.context_length,
            "response_time_ms": self.response_time_ms,
            "citations": [asdict(citation) for citation in self.citations],
            "original_query": self.original_query,
            "resolved_query": self.resolved_query,
            "query_expansion_used": self.query_expansion_used,
            "expanded_queries": self.expanded_queries,
        }


@dataclass(frozen=True)
class _ResearchRetrievalSummary:
    semantic_matches: int = 0
    keyword_matches: int = 0
    merged_results: int = 0


RESEARCH_RAG_PROMPT = PromptTemplate.from_template(
    """You are a NASA Space Biology Research Assistant.

Use ONLY the information contained in the supplied NASA ADS papers.

If the papers do not contain enough evidence,
reply exactly:

{insufficient_context_message}

Do not invent facts.
Do not use outside knowledge.
Do not fabricate citations.

Context:
{context}

Question:
{question}

Answer:"""
)


def retrieve_nasa_ads_papers(query: str, top_k: int = DEFAULT_RESEARCH_TOP_K) -> list[ResearchPaper]:
    return retrieve_nasa_ads_papers_with_metadata(query, top_k=top_k).papers


def retrieve_nasa_ads_papers_with_metadata(
    query: str,
    top_k: int = DEFAULT_RESEARCH_TOP_K,
) -> ResearchRetrievalResult:
    cleaned_query = validate_rag_query(query)
    token = os.getenv("NASA_ADS_TOKEN")
    if not token:
        raise RagRetrievalError("NASA ADS is not configured. Add NASA_ADS_TOKEN and restart the backend.")

    rows = max(1, min(top_k, 10))
    results_per_query: dict[str, int] = {}
    original_papers = search_nasa_ads(cleaned_query, token=token, rows=rows)
    results_per_query[cleaned_query] = len(original_papers)

    logger.info("ORIGINAL QUERY: %s", cleaned_query)
    logger.info("ADS RESULTS PER QUERY: %s -> %d", cleaned_query, len(original_papers))

    if len(original_papers) >= MIN_RESULTS_BEFORE_EXPANSION:
        logger.info("EXPANDED QUERIES: []")
        final_papers = original_papers[:top_k]
        logger.info(
            "FINAL UNIQUE PAPERS: %d | %s",
            len(final_papers),
            [paper.bibcode for paper in final_papers],
        )
        return ResearchRetrievalResult(
            papers=final_papers,
            query_expansion_used=False,
            expanded_queries=[],
            results_per_query=results_per_query,
        )

    expanded_queries = expand_research_query(cleaned_query)
    logger.info("EXPANDED QUERIES: %s", expanded_queries)

    papers_by_bibcode = {paper.bibcode: paper for paper in original_papers}
    seen_queries = {query_dedupe_key(cleaned_query)}

    for expanded_query in expanded_queries:
        dedupe_key = query_dedupe_key(expanded_query)
        if dedupe_key in seen_queries:
            continue

        seen_queries.add(dedupe_key)
        expanded_papers = search_nasa_ads(expanded_query, token=token, rows=rows)
        results_per_query[expanded_query] = len(expanded_papers)
        logger.info("ADS RESULTS PER QUERY: %s -> %d", expanded_query, len(expanded_papers))

        for paper in expanded_papers:
            existing = papers_by_bibcode.get(paper.bibcode)
            if existing is None or paper.score > existing.score:
                papers_by_bibcode[paper.bibcode] = paper

    merged_papers = sorted(
        papers_by_bibcode.values(),
        key=lambda paper: paper.score,
        reverse=True,
    )
    final_papers = merged_papers[:top_k]
    logger.info(
        "FINAL UNIQUE PAPERS: %d of %d | %s",
        len(final_papers),
        len(merged_papers),
        [paper.bibcode for paper in final_papers],
    )

    return ResearchRetrievalResult(
        papers=final_papers,
        query_expansion_used=True,
        expanded_queries=expanded_queries,
        results_per_query=results_per_query,
    )


def query_dedupe_key(query: str) -> str:
    cleaned = re.sub(r"\s+", " ", query or "").strip()
    return cleaned.strip(" .?;:").lower()


def search_nasa_ads(query: str, token: str, rows: int) -> list[ResearchPaper]:
    ads_query = build_ads_query(query)
    params = {
        "q": ads_query,
        "fl": ADS_FIELDS,
        "rows": rows,
        "sort": "score desc",
    }
    headers = {"Authorization": f"Bearer {token}"}

    logger.info("ADS SEARCH QUERY: %s", ads_query)

    try:
        response = requests.get(
            ADS_SEARCH_URL,
            headers=headers,
            params=params,
            timeout=ADS_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except requests.Timeout as exc:
        raise RagRetrievalError("NASA ADS timed out while retrieving papers.", status_code=504) from exc
    except requests.RequestException as exc:
        raise RagRetrievalError("NASA ADS retrieval failed. Please retry.", status_code=502) from exc

    docs = response.json().get("response", {}).get("docs", [])
    return [paper for doc in docs if (paper := parse_ads_paper(doc))]


def build_ads_query(query: str) -> str:
    searchable = re.sub(r"[^\w\s\"'-]+", " ", query)
    searchable = re.sub(r"\s+", " ", searchable).strip()
    if not searchable:
        searchable = query
    return (
        f"(title:({searchable}) OR abstract:({searchable}) "
        f"OR keyword:({searchable})) "
        f"AND (database:astronomy OR database:physics)"
    )


def parse_ads_paper(doc: dict) -> Optional[ResearchPaper]:
    bibcode = str(doc.get("bibcode") or "").strip()
    if not bibcode:
        return None

    title = normalize_first_string(doc.get("title")) or "Untitled NASA ADS paper"
    authors = normalize_string_list(doc.get("author"))
    doi = normalize_first_string(doc.get("doi"))
    abstract = str(doc.get("abstract") or "").strip()
    pubdate = str(doc.get("pubdate") or "").strip() or None
    score = normalize_score(doc.get("score"))
    citation_count = normalize_optional_int(doc.get("citation_count"))

    return ResearchPaper(
        title=title,
        authors=authors,
        abstract=abstract,
        pubdate=pubdate,
        doi=doi,
        bibcode=bibcode,
        score=score,
        citation_count=citation_count,
    )


def normalize_first_string(value: object) -> Optional[str]:
    if isinstance(value, list):
        for item in value:
            text = str(item or "").strip()
            if text:
                return text
        return None

    text = str(value or "").strip()
    return text or None


def normalize_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        text = str(value or "").strip()
        return [text] if text else []
    return [text for item in value if (text := str(item or "").strip())]


def normalize_score(value: object) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def normalize_optional_int(value: object) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def build_research_context(
    papers: list[ResearchPaper],
    max_characters: int = DEFAULT_CONTEXT_CHAR_LIMIT,
) -> ResearchContextWindow:
    context_blocks: list[str] = []
    citations: list[ResearchCitation] = []
    used_characters = 0

    for paper in papers:
        abstract = paper.abstract.strip()
        if not abstract:
            continue

        block_prefix = format_paper_context_prefix(len(context_blocks) + 1, paper)
        available = max_characters - used_characters - len(block_prefix)
        if available <= 0:
            break

        if len(abstract) > available:
            abstract = abstract[:available].rstrip()

        block = f"{block_prefix}{abstract}"
        context_blocks.append(block)
        citations.append(citation_for_paper(paper))
        used_characters += len(block) + 3

        if used_characters >= max_characters:
            break

    context = "\n\n⸻\n\n".join(context_blocks)
    return ResearchContextWindow(
        context=context,
        papers_used=len(context_blocks),
        context_length=len(context),
        citations=citations,
    )


def format_paper_context_prefix(index: int, paper: ResearchPaper) -> str:
    authors = ", ".join(paper.authors) if paper.authors else "Unknown"
    year = paper.year if paper.year is not None else "Unknown"
    doi = paper.doi or "Not listed"
    citation_count = paper.citation_count if paper.citation_count is not None else "Not available"

    return (
        f"[Paper {index}]\n\n"
        f"Title: {paper.title}\n"
        f"Authors: {authors}\n"
        f"Year: {year}\n"
        f"DOI: {doi}\n"
        f"Citation Count: {citation_count}\n"
        "Abstract: "
    )


def citation_for_paper(paper: ResearchPaper) -> ResearchCitation:
    return ResearchCitation(
        title=paper.title,
        authors=paper.authors,
        year=paper.year,
        doi=paper.doi,
        ads_url=paper.ads_url,
        citation_count=paper.citation_count,
    )


def build_research_rag_chain():
    return RESEARCH_RAG_PROMPT | get_groq_llm(temperature=0) | StrOutputParser()


def answer_query_with_research_rag(
    query: str,
    top_k: int = DEFAULT_RESEARCH_TOP_K,
    original_query: Optional[str] = None,
) -> ResearchRagResponse:
    start_time = time.perf_counter()
    cleaned_query = validate_rag_query(query)
    retrieval_result = retrieve_nasa_ads_papers_with_metadata(cleaned_query, top_k=top_k)
    papers = retrieval_result.papers
    context_window = build_research_context(papers)
    cleaned_original_query = validate_rag_query(original_query or cleaned_query)

    if context_window.papers_used == 0:
        return build_research_rag_response(
            start_time=start_time,
            answer=INSUFFICIENT_RESEARCH_CONTEXT_MESSAGE,
            papers_retrieved=len(papers),
            context_window=context_window,
            original_query=cleaned_original_query,
            resolved_query=cleaned_query,
            query_expansion_used=retrieval_result.query_expansion_used,
            expanded_queries=retrieval_result.expanded_queries,
        )

    try:
        answer = build_research_rag_chain().invoke(
            {
                "context": context_window.context,
                "question": cleaned_query,
                "insufficient_context_message": INSUFFICIENT_RESEARCH_CONTEXT_MESSAGE,
            }
        )
    except Exception as exc:
        if is_timeout_error(exc):
            raise RagTimeoutError(
                "Groq timed out while generating the NASA ADS RAG answer. Please retry."
            ) from exc
        raise GroqUnavailableError(
            "Groq is unavailable while generating the NASA ADS RAG answer. Please retry."
        ) from exc

    cleaned_answer = (answer or "").strip() or INSUFFICIENT_RESEARCH_CONTEXT_MESSAGE
    return build_research_rag_response(
        start_time=start_time,
        answer=cleaned_answer,
        papers_retrieved=len(papers),
        context_window=context_window,
        original_query=cleaned_original_query,
        resolved_query=cleaned_query,
        query_expansion_used=retrieval_result.query_expansion_used,
        expanded_queries=retrieval_result.expanded_queries,
    )


def build_research_rag_response(
    start_time: float,
    answer: str,
    papers_retrieved: int,
    context_window: ResearchContextWindow,
    original_query: str,
    resolved_query: str,
    query_expansion_used: bool,
    expanded_queries: list[str],
) -> ResearchRagResponse:
    timed_response = build_rag_response(
        start_time,
        answer,
        ContextWindow(
            context=context_window.context,
            chunk_count=context_window.papers_used,
            context_length=context_window.context_length,
            citations=context_window.citations,
        ),
        _ResearchRetrievalSummary(),
    )

    return ResearchRagResponse(
        answer=timed_response.answer,
        papers_retrieved=papers_retrieved,
        papers_used=timed_response.retrieved_chunks,
        context_length=timed_response.context_length,
        response_time_ms=timed_response.response_time_ms,
        citations=context_window.citations,
        original_query=original_query,
        resolved_query=resolved_query,
        query_expansion_used=query_expansion_used,
        expanded_queries=expanded_queries,
    )
