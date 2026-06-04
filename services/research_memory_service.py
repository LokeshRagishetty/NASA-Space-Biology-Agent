import logging
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate

from services.rag_service import get_groq_llm, is_timeout_error, validate_rag_query


MAX_MEMORY_EXCHANGES = 5
MAX_MEMORY_CHARACTERS = 10000
FOLLOW_UP_PATTERNS = [
    r"\bthat\b",
    r"\bthose\b",
    r"\bthey\b",
    r"\bthem\b",
    r"\bit\b",
    r"\bthese\b",
    r"\bsuch studies\b",
    r"\bsuch findings\b",
    r"\bthat conclusion\b",
    r"\bthose papers\b",
]

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ResearchMemoryExchange:
    user_question: str
    assistant_answer: str
    retrieved_paper_titles: list[str] = field(default_factory=list)
    retrieved_paper_citations: list[dict[str, Any]] = field(default_factory=list)
    original_retrieval_query: Optional[str] = None
    resolved_retrieval_query: Optional[str] = None


@dataclass(frozen=True)
class ResearchConversationMemory:
    exchanges: list[ResearchMemoryExchange]
    context: str
    char_count: int

    @property
    def has_history(self) -> bool:
        return bool(self.exchanges and self.context.strip())


QUERY_REWRITE_PROMPT = PromptTemplate.from_template(
    """You are a NASA Space Biology Research Assistant.

Given:

1. Conversation history
2. Current question

Generate a standalone scientific query
that preserves the user's intended meaning.

Use concise NASA ADS search keywords, not a full sentence.
Keep the rewritten query under 12 words.
Do not mention retrieved papers, retrieved results, or NASA ADS.
Return only the rewritten query.

Conversation history:
{history}

Current question:
{question}

Rewritten query:"""
)


def build_research_memory(messages: list[Any]) -> ResearchConversationMemory:
    exchanges: list[ResearchMemoryExchange] = []
    pending_user_question: Optional[str] = None

    for message in messages:
        role = getattr(message, "role", None)
        content = (getattr(message, "content", "") or "").strip()
        if not content:
            continue

        if role == "user":
            pending_user_question = content
            continue

        if role != "assistant" or pending_user_question is None:
            continue

        metadata = getattr(message, "rag_metadata", None) or {}
        if metadata.get("mode") == "research_rag":
            exchange = build_exchange(pending_user_question, content, metadata)
            exchanges.append(exchange)

        pending_user_question = None

    recent_exchanges = exchanges[-MAX_MEMORY_EXCHANGES:]
    context = build_memory_context(recent_exchanges)

    while len(context) > MAX_MEMORY_CHARACTERS and len(recent_exchanges) > 1:
        recent_exchanges = recent_exchanges[1:]
        context = build_memory_context(recent_exchanges)

    if len(context) > MAX_MEMORY_CHARACTERS:
        context = context[-MAX_MEMORY_CHARACTERS:].lstrip()

    return ResearchConversationMemory(
        exchanges=recent_exchanges,
        context=context,
        char_count=len(context),
    )


def build_exchange(
    user_question: str,
    assistant_answer: str,
    metadata: dict[str, Any],
) -> ResearchMemoryExchange:
    citations = metadata.get("citations") if isinstance(metadata.get("citations"), list) else []
    paper_titles = [
        title
        for citation in citations
        if isinstance(citation, dict) and (title := str(citation.get("title") or "").strip())
    ]

    return ResearchMemoryExchange(
        user_question=user_question,
        assistant_answer=assistant_answer,
        retrieved_paper_titles=paper_titles,
        retrieved_paper_citations=[citation for citation in citations if isinstance(citation, dict)],
        original_retrieval_query=normalize_optional_string(metadata.get("original_query")),
        resolved_retrieval_query=normalize_optional_string(metadata.get("resolved_query")),
    )


def normalize_optional_string(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def build_memory_context(exchanges: list[ResearchMemoryExchange]) -> str:
    blocks: list[str] = []

    for index, exchange in enumerate(exchanges, start=1):
        answer = trim_text(exchange.assistant_answer, 1200)
        titles = exchange.retrieved_paper_titles[:5]
        citations = format_citation_lines(exchange.retrieved_paper_citations[:5])

        block_parts = [
            f"[Exchange {index}]",
            f"Previous user question: {exchange.user_question}",
        ]

        if exchange.original_retrieval_query:
            block_parts.append(f"Original retrieval query: {exchange.original_retrieval_query}")
        if exchange.resolved_retrieval_query:
            block_parts.append(f"Resolved retrieval query: {exchange.resolved_retrieval_query}")
        if titles:
            block_parts.append("Retrieved paper titles:\n" + "\n".join(f"- {title}" for title in titles))
        if citations:
            block_parts.append("Retrieved paper citations:\n" + citations)

        block_parts.append(f"Assistant answer: {answer}")
        blocks.append("\n".join(block_parts))

    return "\n\n".join(blocks)


def format_citation_lines(citations: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for citation in citations:
        title = str(citation.get("title") or "Untitled paper").strip()
        year = citation.get("year") or "Unknown year"
        doi = citation.get("doi") or "No DOI"
        ads_url = citation.get("ads_url") or "No ADS URL"
        lines.append(f"- {title} ({year}); DOI: {doi}; ADS: {ads_url}")
    return "\n".join(lines)


def trim_text(value: str, max_characters: int) -> str:
    text = re.sub(r"\s+", " ", value).strip()
    if len(text) <= max_characters:
        return text
    return text[:max_characters].rstrip() + "..."


def has_follow_up_reference(query: str) -> bool:
    query_lower = query.lower()
    return any(re.search(pattern, query_lower) for pattern in FOLLOW_UP_PATTERNS)


def is_short_contextual_question(query: str) -> bool:
    cleaned = re.sub(r"[^\w\s]", " ", query.lower())
    words = [word for word in cleaned.split() if word]
    if len(words) > 8:
        return False

    contextual_starts = {"what", "which", "how", "why", "where", "when"}
    contextual_terms = {
        "mitigation",
        "strategies",
        "exist",
        "support",
        "supports",
        "supported",
        "evidence",
        "strongest",
        "paper",
        "papers",
        "study",
        "studies",
        "conclusion",
        "finding",
        "findings",
    }
    return bool(words and words[0] in contextual_starts and contextual_terms.intersection(words))


def should_resolve_research_query(query: str, memory: ResearchConversationMemory) -> bool:
    if not memory.has_history:
        return False
    return has_follow_up_reference(query) or is_short_contextual_question(query)


def resolve_research_query(
    query: str,
    memory: ResearchConversationMemory,
) -> str:
    cleaned_query = validate_rag_query(query)

    if not should_resolve_research_query(cleaned_query, memory):
        return cleaned_query

    # STEP 1: Try fallback FIRST
    fallback_query = build_fallback_resolved_query(
        cleaned_query,
        memory,
    )

    if is_good_fallback_query(
        fallback_query,
        cleaned_query,
    ):
        logger.info(
            "Using fallback memory resolution: %r -> %r",
            cleaned_query,
            fallback_query,
        )
        return fallback_query

    # STEP 2: Only use Groq if fallback wasn't good enough
    try:
        rewritten = rewrite_query_with_groq(
            cleaned_query,
            memory.context,
        )
    except Exception as exc:
        logger.warning(

        "Research query rewrite failed; using fallback resolver: %s",

        exc,

    )
        rewritten = fallback_query

    if should_use_fallback_rewrite(rewritten):
        logger.info(
            "Research query rewrite was too verbose; using fallback resolver."
        )
        rewritten = fallback_query

    resolved = validate_resolved_query(
        rewritten,
        cleaned_query,
    )

    logger.info("=" * 80)
    logger.info("ORIGINAL QUERY: %s", cleaned_query)
    logger.info("RESOLVED QUERY: %s", resolved)
    logger.info("=" * 80)

    if resolved != cleaned_query:
        logger.info(
            "Resolved research query %r -> %r",
            cleaned_query,
            resolved,
        )

    return resolved



def rewrite_query_with_groq(query: str, history: str) -> str:
    try:
        chain = QUERY_REWRITE_PROMPT | get_groq_llm(temperature=0, max_tokens=160) | StrOutputParser()
        return (chain.invoke({"history": history, "question": query}) or "").strip()
    except Exception as exc:
        if is_timeout_error(exc):
            logger.warning("Research query rewrite timed out.")
        raise


def validate_resolved_query(rewritten: str, original_query: str) -> str:
    cleaned = re.sub(r"\s+", " ", (rewritten or "").strip().strip('"')).strip()
    if not cleaned:
        return original_query

    prefixes = ["rewritten query:", "standalone query:", "query:"]
    lowered = cleaned.lower()
    for prefix in prefixes:
        if lowered.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip()
            lowered = cleaned.lower()

    if len(cleaned) > 500:
        cleaned = cleaned[:500].rsplit(" ", 1)[0].strip()

    return cleaned or original_query


def should_use_fallback_rewrite(rewritten: str) -> bool:
    cleaned = re.sub(r"\s+", " ", (rewritten or "").strip())
    if not cleaned:
        return True

    words = cleaned.split()
    lowered = cleaned.lower()
    question_starts = ("what ", "which ", "how ", "why ", "where ", "when ")
    banned_phrases = ("retrieved", "nasa ads", "papers from the")

    return (
        len(words) > 16
        or lowered.startswith(question_starts)
        or any(phrase in lowered for phrase in banned_phrases)
    )

def is_good_fallback_query(
    fallback_query: str,
    original_query: str,
) -> bool:
    if not fallback_query:
        return False

    if fallback_query.strip().lower() == original_query.strip().lower():
        return False

    return len(fallback_query.split()) >= 2

def build_fallback_resolved_query(
    query: str,
    memory: ResearchConversationMemory,
) -> str:
    previous_topic = find_previous_topic(memory)
    if not previous_topic:
        return query

    query_lower = query.lower()
    if "mitigation" in query_lower or "strateg" in query_lower:
        return f"mitigation strategies for {previous_topic}"
    if "support" in query_lower or "conclusion" in query_lower or "evidence" in query_lower:
        if "strongest" in query_lower or "study" in query_lower or "studies" in query_lower:
            return f"{previous_topic} studies"
        return f"papers supporting {previous_topic}"
    if "paper" in query_lower or "study" in query_lower or "studies" in query_lower:
        return f"{query} related to {previous_topic}"

    return f"{query} related to {previous_topic}"


def find_previous_topic(memory: ResearchConversationMemory) -> Optional[str]:
    for exchange in reversed(memory.exchanges):
        if exchange.resolved_retrieval_query:
            return normalize_previous_topic(exchange.resolved_retrieval_query)
        if exchange.original_retrieval_query:
            return normalize_previous_topic(exchange.original_retrieval_query)
        if exchange.user_question:
            return normalize_previous_topic(exchange.user_question)
    return None


def normalize_previous_topic(topic: str) -> str:
    cleaned = re.sub(r"\s+", " ", topic).strip(" .?;:")
    lowered = cleaned.lower()

    affect_match = re.match(r"^how does (.+?) affect (.+)$", lowered)
    if affect_match:
        subject = affect_match.group(1).strip()
        target = affect_match.group(2).strip()
        if "dna" in target:
            return f"DNA damage caused by {subject}"
        return f"{target} affected by {subject}"

    compare_match = re.match(r"^compare studies (?:on|about|of) (.+)$", lowered)
    if compare_match:
        return compare_match.group(1).strip()

    return cleaned
