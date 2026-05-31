import os
import time
from dataclasses import dataclass
from typing import Optional

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_groq import ChatGroq
from sqlalchemy.orm import Session

from services.semantic_search import DEFAULT_TOP_K, SemanticSearchError, SearchResult, search_documents


INSUFFICIENT_CONTEXT_MESSAGE = "I could not find enough information in the uploaded knowledge base."
DEFAULT_RAG_MODEL = os.getenv("GROQ_RAG_MODEL", "llama-3.3-70b-versatile")
DEFAULT_RAG_TEMPERATURE = float(os.getenv("GROQ_RAG_TEMPERATURE", "0.1"))
DEFAULT_RAG_MAX_TOKENS = int(os.getenv("GROQ_RAG_MAX_TOKENS", "800"))
DEFAULT_RAG_TIMEOUT_SECONDS = float(os.getenv("GROQ_RAG_TIMEOUT_SECONDS", "30"))
DEFAULT_CONTEXT_CHAR_LIMIT = int(os.getenv("RAG_CONTEXT_CHAR_LIMIT", "12000"))


class RagServiceError(Exception):
    """Base class for user-safe RAG failures."""

    status_code = 500


class RagValidationError(RagServiceError):
    status_code = 400


class RagRetrievalError(RagServiceError):
    status_code = 503

    def __init__(self, message: str, status_code: int = 503):
        super().__init__(message)
        self.status_code = status_code


class GroqUnavailableError(RagServiceError):
    status_code = 503


class RagTimeoutError(RagServiceError):
    status_code = 504


@dataclass(frozen=True)
class RagResponse:
    answer: str
    retrieved_chunks: int
    context_length: int
    response_time_ms: float


@dataclass(frozen=True)
class ContextWindow:
    context: str
    chunk_count: int
    context_length: int


RAG_PROMPT = PromptTemplate.from_template(
    """You are a grounded knowledge-base assistant.

Use only the provided context to answer the question.
If the context does not explicitly contain enough information to answer, reply exactly:
{insufficient_context_message}

Do not invent facts. Do not use outside knowledge.

CONTEXT:
{context}

QUESTION:
{question}

ANSWER:"""
)


def get_groq_llm(
    model: Optional[str] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> ChatGroq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise GroqUnavailableError("Groq is not configured. Add GROQ_API_KEY and restart the backend.")

    return ChatGroq(
        model=model or DEFAULT_RAG_MODEL,
        temperature=DEFAULT_RAG_TEMPERATURE if temperature is None else temperature,
        max_tokens=DEFAULT_RAG_MAX_TOKENS if max_tokens is None else max_tokens,
        timeout=DEFAULT_RAG_TIMEOUT_SECONDS,
        max_retries=1,
        api_key=api_key,
    )


def build_context_window(
    results: list[SearchResult],
    max_characters: int = DEFAULT_CONTEXT_CHAR_LIMIT,
) -> ContextWindow:
    context_blocks: list[str] = []
    used_characters = 0

    for result in results:
        chunk_text = (result.chunk_text or "").strip()
        if not chunk_text:
            continue

        prefix = f"[Chunk {len(context_blocks) + 1}]\n"
        available = max_characters - used_characters - len(prefix)
        if available <= 0:
            break

        if len(chunk_text) > available:
            chunk_text = chunk_text[:available].rstrip()

        block = f"{prefix}{chunk_text}"
        context_blocks.append(block)
        used_characters += len(block) + 2

        if used_characters >= max_characters:
            break

    context = "\n\n".join(context_blocks)
    return ContextWindow(
        context=context,
        chunk_count=len(context_blocks),
        context_length=len(context),
    )


def build_rag_chain(llm: ChatGroq):
    return RAG_PROMPT | llm | StrOutputParser()


def answer_query_with_rag(
    db: Session,
    query: str,
    user_id: int,
    top_k: Optional[int] = None,
    model: Optional[str] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> RagResponse:
    start_time = time.perf_counter()
    cleaned_query = validate_rag_query(query)

    try:
        search_response = search_documents(
            db=db,
            query=cleaned_query,
            user_id=user_id,
            top_k=top_k or DEFAULT_TOP_K,
        )
    except SemanticSearchError as exc:
        raise RagRetrievalError(str(exc), status_code=getattr(exc, "status_code", 503)) from exc

    context_window = build_context_window(search_response.results)
    if context_window.chunk_count == 0:
        return build_rag_response(start_time, INSUFFICIENT_CONTEXT_MESSAGE, context_window)

    try:
        chain = build_rag_chain(get_groq_llm(model=model, temperature=temperature, max_tokens=max_tokens))
        answer = chain.invoke(
            {
                "context": context_window.context,
                "question": cleaned_query,
                "insufficient_context_message": INSUFFICIENT_CONTEXT_MESSAGE,
            }
        )
    except Exception as exc:
        if is_timeout_error(exc):
            raise RagTimeoutError("Groq timed out while generating the RAG answer. Please retry.") from exc
        raise GroqUnavailableError("Groq is unavailable while generating the RAG answer. Please retry.") from exc

    cleaned_answer = (answer or "").strip() or INSUFFICIENT_CONTEXT_MESSAGE
    return build_rag_response(start_time, cleaned_answer, context_window)


def validate_rag_query(query: str) -> str:
    if not query:
        raise RagValidationError("RAG query cannot be empty.")

    cleaned = query.strip()
    if not cleaned:
        raise RagValidationError("RAG query cannot be empty or whitespace only.")

    if len(cleaned) > 4000:
        raise RagValidationError("RAG query cannot exceed 4000 characters.")

    return cleaned


def build_rag_response(start_time: float, answer: str, context_window: ContextWindow) -> RagResponse:
    return RagResponse(
        answer=answer,
        retrieved_chunks=context_window.chunk_count,
        context_length=context_window.context_length,
        response_time_ms=round((time.perf_counter() - start_time) * 1000, 2),
    )


def is_timeout_error(exc: Exception) -> bool:
    if isinstance(exc, TimeoutError):
        return True

    name = exc.__class__.__name__.lower()
    message = str(exc).lower()
    return "timeout" in name or "timed out" in message or "timeout" in message
