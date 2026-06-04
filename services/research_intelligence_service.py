import logging
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Optional, Union

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate

from services.rag_service import (
    DEFAULT_CONTEXT_CHAR_LIMIT,
    GroqUnavailableError,
    RagTimeoutError,
    get_groq_llm,
    is_timeout_error,
    validate_rag_query,
)
from services.research_rag_service import (
    DEFAULT_RESEARCH_TOP_K,
    INSUFFICIENT_RESEARCH_CONTEXT_MESSAGE,
    ResearchCitation,
    ResearchContextWindow,
    ResearchPaper,
    ResearchRagResponse,
    answer_query_with_research_rag,
    build_research_context,
    format_study_label,
    retrieve_nasa_ads_papers_with_metadata,
)


logger = logging.getLogger(__name__)

MODE_STANDARD = "standard"
MODE_COMPARISON = "comparison"
MODE_RESEARCH_GAP = "research_gap"
MODE_EVIDENCE = "evidence"
MODE_CONTRADICTION = "contradiction"
MODE_REPORT = "report"
MODE_REVIEW = "review"

MODE_LABELS = {
    MODE_STANDARD: "Standard Research RAG",
    MODE_COMPARISON: "Comparison",
    MODE_RESEARCH_GAP: "Research Gap Analysis",
    MODE_EVIDENCE: "Evidence Ranking",
    MODE_CONTRADICTION: "Contradiction Analysis",
    MODE_REPORT: "Report Generation",
    MODE_REVIEW: "Literature Review",
}

INTELLIGENCE_MAX_TOKENS = 1800
REPORT_MAX_TOKENS = 1200


@dataclass(frozen=True)
class ResearchIntelligenceResponse:
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
    research_mode: str
    research_mode_key: str

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
            "research_mode": self.research_mode,
            "research_mode_key": self.research_mode_key,
        }


@dataclass(frozen=True)
class EvidenceScore:
    paper_index: int
    source_label: str
    title: str
    score: int
    confidence: str
    reasoning: list[str]


COMPARISON_PROMPT = PromptTemplate.from_template(
    """You are a NASA Space Biology Research Assistant.

Use ONLY the supplied NASA ADS papers. Compare the retrieved papers together.
Do not use outside knowledge. Do not fabricate citations, methods, samples, or contradictions.
If a category cannot be supported by the abstracts, say so explicitly.
Never refer to sources using generic numbered paper labels.
Use paper titles, first author + year, or concise shortened titles.

Required output format:

## Study A: <paper title>
- Findings: <finding grounded in the abstract>

## Study B: <paper title>
- Findings: <finding grounded in the abstract>

## Areas of Agreement
- ...

## Areas of Difference
- ...

## Research Limitations
- ...

## Overall Conclusion
- ...

NASA ADS papers:
{context}

Question:
{question}

Answer:"""
)

RESEARCH_GAP_PROMPT = PromptTemplate.from_template(
    """You are a NASA Space Biology Research Assistant.

Analyze ALL retrieved NASA ADS abstracts and identify gaps only when they are grounded in the supplied papers.
Use ONLY the supplied papers. Do not use outside knowledge. Do not invent missing work.
If the abstracts do not establish a gap, state that the retrieved abstracts do not provide enough evidence for that gap.
Never refer to sources using generic numbered paper labels.
Use paper titles, first author + year, or concise shortened titles.

Required output format:

## Research Gaps
- ...

## Future Research Opportunities
- ...

## Open Questions
- ...

NASA ADS papers:
{context}

Question:
{question}

Answer:"""
)

EVIDENCE_PROMPT = PromptTemplate.from_template(
    """You are a NASA Space Biology Research Assistant.

Rank the retrieved studies by evidence strength using ONLY the supplied NASA ADS abstracts and evidence signals.
Evidence scoring is based on citation count when available, review article indicators, sample size references,
experimental detail, and recency. Do not claim reliability details absent from the abstracts or evidence signals.
Never refer to sources using generic numbered paper labels.
Use paper titles, first author + year, or concise shortened titles.

Required output format:

## High Confidence
- <paper title>: <reasoning>

## Medium Confidence
- <paper title>: <reasoning>

## Low Confidence
- <paper title>: <reasoning>

## Overall Ranking
1. <paper title> - <confidence> - <reasoning>

Evidence signals:
{evidence_signals}

NASA ADS papers:
{context}

Question:
{question}

Answer:"""
)

CONTRADICTION_PROMPT = PromptTemplate.from_template(
    """You are a NASA Space Biology Research Assistant.

Analyze the retrieved NASA ADS papers for agreements and contradictions.
Use ONLY the supplied abstracts. Do not invent contradictions.
If no direct contradiction is present in the abstracts, state that no direct contradiction was detected.
Never refer to sources using generic numbered paper labels.
Use paper titles, first author + year, or concise shortened titles.

Required output format:

## Agreements
- ...

## Contradictions
- ...

## Possible Explanations
- ...

NASA ADS papers:
{context}

Question:
{question}

Answer:"""
)

REPORT_PROMPT = PromptTemplate.from_template(
    """You are a NASA Space Biology Research Assistant.

Generate an export-ready markdown research report using ONLY the supplied NASA ADS papers.
Do not use outside knowledge. Keep every claim grounded in the retrieved abstracts.
Use the provided reference list only.
Never refer to sources using generic numbered paper labels.
Use paper titles, first author + year, or concise shortened titles.

Required markdown structure:

# Title

## Abstract

## Introduction

## Methods Summary

## Findings

## Discussion

## Research Gaps

## Future Directions

## References

Reference list to use:
{references}

NASA ADS papers:
{context}

Question:
{question}

Markdown report:"""
)

REVIEW_PROMPT = PromptTemplate.from_template(
    """You are a NASA Space Biology Research Assistant.

Generate an export-ready markdown literature review using ONLY the supplied NASA ADS papers.
Do not use outside knowledge. Keep every claim grounded in the retrieved abstracts.
Use the provided reference list only.
Never refer to sources using generic numbered paper labels.
Use paper titles, first author + year, or concise shortened titles.

Required markdown structure:

# Literature Review

## Background

## Current Findings

## Themes

## Comparative Analysis

## Research Gaps

## Future Directions

## References

Reference list to use:
{references}

NASA ADS papers:
{context}

Question:
{question}

Markdown literature review:"""
)


INTELLIGENCE_PROMPTS = {
    MODE_COMPARISON: COMPARISON_PROMPT,
    MODE_RESEARCH_GAP: RESEARCH_GAP_PROMPT,
    MODE_EVIDENCE: EVIDENCE_PROMPT,
    MODE_CONTRADICTION: CONTRADICTION_PROMPT,
    MODE_REPORT: REPORT_PROMPT,
    MODE_REVIEW: REVIEW_PROMPT,
}


def answer_query_with_research_intelligence(
    query: str,
    top_k: int = DEFAULT_RESEARCH_TOP_K,
    original_query: Optional[str] = None,
) -> Union[ResearchIntelligenceResponse, ResearchRagResponse]:
    cleaned_query = validate_rag_query(query)
    
    cleaned_original_query = validate_rag_query(original_query or cleaned_query)
    mode = classify_research_mode(cleaned_original_query)
    if mode == MODE_STANDARD:
        mode = classify_research_mode(cleaned_query)

    if mode == MODE_STANDARD:
        response = answer_query_with_research_rag(
            cleaned_query,
            top_k=top_k,
            original_query=cleaned_original_query,
        )
        return response

    start_time = time.perf_counter()
    retrieval_query = build_retrieval_query(cleaned_original_query, cleaned_query, mode)
    effective_top_k = (
    3
    if mode in {MODE_REPORT, MODE_REVIEW}
    else top_k
)

    retrieval_result = retrieve_nasa_ads_papers_with_metadata(
    retrieval_query,
    top_k=effective_top_k,
)
    papers = retrieval_result.papers
    max_context = (
    5000
    if mode in {MODE_REPORT, MODE_REVIEW}
    else DEFAULT_CONTEXT_CHAR_LIMIT
)

    context_window = build_research_context(
    papers,
    max_characters=max_context
)

    logger.info(
        "Research intelligence mode=%s original=%r resolved=%r retrieval=%r papers=%d used=%d",
        MODE_LABELS[mode],
        cleaned_original_query,
        cleaned_query,
        retrieval_query,
        len(papers),
        context_window.papers_used,
    )

    if context_window.papers_used == 0:
        return build_intelligence_response(
            start_time=start_time,
            answer=INSUFFICIENT_RESEARCH_CONTEXT_MESSAGE,
            papers_retrieved=len(papers),
            context_window=context_window,
            original_query=cleaned_original_query,
            resolved_query=retrieval_query,
            query_expansion_used=retrieval_result.query_expansion_used,
            expanded_queries=retrieval_result.expanded_queries,
            mode=mode,
        )

    used_papers = select_context_papers(papers, context_window)

    try:
        answer = generate_mode_answer(
            mode=mode,
            context=context_window.context,
            question=cleaned_original_query,
            citations=context_window.citations,
            papers=used_papers,
        )
    except Exception as exc:
        if is_timeout_error(exc):
            raise RagTimeoutError(
                "Groq timed out while generating the NASA ADS research analysis. Please retry."
            ) from exc
        raise GroqUnavailableError(
            "Groq is unavailable while generating the NASA ADS research analysis. Please retry."
        ) from exc

    cleaned_answer = (answer or "").strip() or INSUFFICIENT_RESEARCH_CONTEXT_MESSAGE
    if mode in {MODE_REPORT, MODE_REVIEW}:
        cleaned_answer = ensure_references_section(cleaned_answer, context_window.citations)

    return build_intelligence_response(
        start_time=start_time,
        answer=cleaned_answer,
        papers_retrieved=len(papers),
        context_window=context_window,
        original_query=cleaned_original_query,
        resolved_query=retrieval_query,
        query_expansion_used=retrieval_result.query_expansion_used,
        expanded_queries=retrieval_result.expanded_queries,
        mode=mode,
    )


def classify_research_mode(query: str) -> str:
    text = normalize_for_detection(query)

    if any(re.search(pattern, text) for pattern in COMPARISON_PATTERNS):
        return MODE_COMPARISON
    if any(re.search(pattern, text) for pattern in RESEARCH_GAP_PATTERNS):
        return MODE_RESEARCH_GAP
    if any(re.search(pattern, text) for pattern in EVIDENCE_PATTERNS):
        return MODE_EVIDENCE
    if any(re.search(pattern, text) for pattern in CONTRADICTION_PATTERNS):
        return MODE_CONTRADICTION
    if any(re.search(pattern, text) for pattern in REPORT_PATTERNS):
        return MODE_REPORT
    if any(re.search(pattern, text) for pattern in REVIEW_PATTERNS):
        return MODE_REVIEW
    return MODE_STANDARD


COMPARISON_PATTERNS = [
    r"\bcompare\s+(?:(?:those|these|the)\s+)?(?:studies|papers|research|experiments)\b",
    r"\bhow\s+do\s+(?:they|these|those|studies|papers|results|findings)\s+differ\b",
    r"\bwhat\s+are\s+the\s+differences\s+between\s+(?:studies|papers|research|experiments)\b",
    r"\bdifferences\s+between\s+(?:studies|papers|research|experiments)\b",
]

RESEARCH_GAP_PATTERNS = [
    r"\bresearch\s+gaps?\b",
    r"\bwhat\s+is\s+missing\b",
    r"\bfuture\s+work\b",
    r"\bfuture\s+research\b",
    r"\bunanswered\s+questions?\b",
    r"\bopen\s+questions?\b",
]

EVIDENCE_PATTERNS = [
    r"\bstrongest\s+evidence\b",
    r"\bmost\s+reliable\b",
    r"\brank\s+(?:the\s+)?(?:studies|papers|research)\b",
    r"\brank\s+(?:them|these|those)\b",
    r"\bevidence\s+strength\b",
    r"\bwhich\s+(?:paper|study)\s+provides\b",
]

CONTRADICTION_PATTERNS = [
    r"\b(?:studies|papers|findings|results)\s+disagree\b",
    r"\bdo\s+(?:any\s+)?(?:studies|papers|findings|results)\s+disagree\b",
    r"\bdo\s+(?:they|these|those)\s+disagree\b",
    r"\bcontradictory\s+findings?\b",
    r"\bconflicting\s+evidence\b",
    r"\bcontradictions?\b",
]

REPORT_PATTERNS = [
    r"\b(?:generate|create|write|draft)\s+(?:a\s+)?report\s+(?:on|about|for)\b",
]

REVIEW_PATTERNS = [
    r"\b(?:generate|create|write|draft)\s+(?:a\s+)?literature\s+review\s+(?:on|about|for)\b",
    r"\bliterature\s+review\s+(?:on|about|for)\b",
]


RETRIEVAL_STRIP_PATTERNS = {
    MODE_COMPARISON: [
        r"^compare\s+(?:(?:those|these|the)\s+)?(?:studies|papers|research|experiments)\s+(?:on|about|of|for|related\s+to)?\s*",
        r"^how\s+do\s+(?:studies|papers|results|findings)\s+differ\s+(?:on|about|for|regarding)?\s*",
        r"^how\s+do\s+(?:they|these|those)\s+differ\s*(?:on|about|for|regarding|related\s+to)?\s*",
        r"^what\s+are\s+the\s+differences\s+between\s+(?:studies|papers|research|experiments)\s+(?:on|about|of|for)?\s*",
        r"^differences\s+between\s+(?:studies|papers|research|experiments)\s+(?:on|about|of|for)?\s*",
    ],
    MODE_RESEARCH_GAP: [
        r"^what\s+research\s+gaps?\s+(?:exist|are\s+there)\s*(?:in|for|on|about|related\s+to)?\s*",
        r"^research\s+gaps?\s+(?:in|for|on|about)\s+",
        r"^what\s+is\s+missing\s+(?:in|from|for|on|about)\s+",
        r"^future\s+(?:work|research)\s+(?:for|on|about|in)\s+",
        r"^unanswered\s+questions?\s+(?:in|for|on|about)\s+",
        r"^open\s+questions?\s+(?:in|for|on|about)\s+",
    ],
    MODE_EVIDENCE: [
        r"^which\s+(?:paper|study)\s+provides\s+(?:the\s+)?strongest\s+evidence\s+(?:for|on|about|of)\s+",
        r"^which\s+(?:paper|study)\s+is\s+(?:the\s+)?most\s+reliable\s+(?:for|on|about|of)?\s*",
        r"^rank\s+(?:the\s+)?(?:studies|papers|research)\s+(?:on|about|for|of|by)?\s*",
        r"^rank\s+(?:them|these|those)\s*(?:on|about|for|of|by|related\s+to)?\s*",
        r"^evidence\s+strength\s+(?:for|on|about|of)?\s*",
    ],
    MODE_CONTRADICTION: [
        r"^do\s+(?:any\s+)?(?:studies|papers|findings|results)\s+disagree\s+(?:about|on|with|regarding)?\s*",
        r"^do\s+(?:they|these|those)\s+disagree\s*(?:about|on|with|regarding|related\s+to)?\s*",
        r"^contradictory\s+findings?\s+(?:about|on|for|in)?\s*",
        r"^conflicting\s+evidence\s+(?:about|on|for|in)?\s*",
        r"^contradictions?\s+(?:about|on|for|in)?\s*",
    ],
    MODE_REPORT: [
        r"^(?:generate|create|write|draft)\s+(?:a\s+)?report\s+(?:on|about|for)\s+",
    ],
    MODE_REVIEW: [
        r"^(?:generate|create|write|draft)\s+(?:a\s+)?literature\s+review\s+(?:on|about|for)\s+",
        r"^literature\s+review\s+(?:on|about|for)\s+",
    ],
}


def normalize_for_detection(query: str) -> str:
    lowered = (query or "").lower()
    lowered = re.sub(r"[^\w\s-]+", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def build_retrieval_query(original_query: str, resolved_query: str, mode: str) -> str:
    original_candidate = strip_mode_directive(original_query, mode)
    resolved_candidate = strip_mode_directive(resolved_query, mode)

    for candidate in [original_candidate, resolved_candidate, resolved_query, original_query]:
        cleaned = clean_retrieval_candidate(candidate)
        if is_usable_retrieval_query(cleaned):
            return validate_rag_query(cleaned)

    return validate_rag_query(resolved_query)


def strip_mode_directive(query: str, mode: str) -> str:
    candidate = normalize_for_detection(query)
    for pattern in RETRIEVAL_STRIP_PATTERNS.get(mode, []):
        candidate = re.sub(pattern, "", candidate, count=1).strip()
    return candidate


def clean_retrieval_candidate(candidate: str) -> str:
    cleaned = re.sub(r"\s+", " ", candidate or "").strip(" .?;:-")
    cleaned = re.sub(r"^related\s+to\s+", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"\b(?:studies|papers)\s*$", "", cleaned, flags=re.IGNORECASE).strip()
    return cleaned


def is_usable_retrieval_query(query: str) -> bool:
    words = re.findall(r"[A-Za-z0-9-]+", query or "")
    return len(words) >= 2


def select_context_papers(
    papers: list[ResearchPaper],
    context_window: ResearchContextWindow,
) -> list[ResearchPaper]:
    papers_with_abstracts = [paper for paper in papers if paper.abstract.strip()]
    return papers_with_abstracts[: context_window.papers_used]


def generate_mode_answer(
    mode: str,
    context: str,
    question: str,
    citations: list[ResearchCitation],
    papers: list[ResearchPaper],
) -> str:
    prompt = INTELLIGENCE_PROMPTS[mode]
    max_tokens = REPORT_MAX_TOKENS if mode in {MODE_REPORT, MODE_REVIEW} else INTELLIGENCE_MAX_TOKENS
    chain = prompt | get_groq_llm(temperature=0, max_tokens=max_tokens) | StrOutputParser()

    payload = {
        "context": context,
        "question": question,
        "references": format_references(citations),
        "evidence_signals": format_evidence_signals(papers),
    }
    return (chain.invoke(payload) or "").strip()


def build_intelligence_response(
    start_time: float,
    answer: str,
    papers_retrieved: int,
    context_window: ResearchContextWindow,
    original_query: str,
    resolved_query: str,
    query_expansion_used: bool,
    expanded_queries: list[str],
    mode: str,
) -> ResearchIntelligenceResponse:
    return ResearchIntelligenceResponse(
        answer=answer,
        papers_retrieved=papers_retrieved,
        papers_used=context_window.papers_used,
        context_length=context_window.context_length,
        response_time_ms=round((time.perf_counter() - start_time) * 1000, 2),
        citations=context_window.citations,
        original_query=original_query,
        resolved_query=resolved_query,
        query_expansion_used=query_expansion_used,
        expanded_queries=expanded_queries,
        research_mode=MODE_LABELS[mode],
        research_mode_key=mode,
    )


def format_references(citations: list[ResearchCitation]) -> str:
    if not citations:
        return "- No retrieved paper references available."

    lines = []
    for index, citation in enumerate(citations, start=1):
        year = citation.year if citation.year is not None else "Unknown year"
        doi = citation.doi or "No DOI listed"
        authors = format_authors(citation.authors)
        lines.append(
            f"{index}. {authors}. {citation.title} ({year}). DOI: {doi}. ADS: {citation.ads_url}"
        )
    return "\n".join(lines)


def format_authors(authors: list[str]) -> str:
    if not authors:
        return "Unknown authors"
    if len(authors) <= 4:
        return ", ".join(authors)
    return f"{', '.join(authors[:4])} et al."


def ensure_references_section(answer: str, citations: list[ResearchCitation]) -> str:
    if re.search(r"^#{1,3}\s+References\s*$", answer, flags=re.IGNORECASE | re.MULTILINE):
        return answer
    return f"{answer.rstrip()}\n\n## References\n{format_references(citations)}"


def format_evidence_signals(papers: list[ResearchPaper]) -> str:
    if not papers:
        return "No retrieved papers with abstracts were available for evidence scoring."

    scores = [score_evidence(paper, index) for index, paper in enumerate(papers, start=1)]
    lines = []
    for score in scores:
        lines.append(
            "\n".join(
                [
                    f"Study: {score.source_label}",
                    f"Title: {score.title}",
                    f"Computed evidence score: {score.score}/100",
                    f"Computed confidence: {score.confidence}",
                    "Scoring reasons:",
                    *[f"- {reason}" for reason in score.reasoning],
                ]
            )
        )
    return "\n\n".join(lines)


def score_evidence(paper: ResearchPaper, paper_index: int) -> EvidenceScore:
    score = 0
    reasoning: list[str] = []

    citation_points, citation_reason = score_citation_count(paper.citation_count)
    score += citation_points
    reasoning.append(citation_reason)

    review_points, review_reason = score_review_indicator(paper)
    score += review_points
    reasoning.append(review_reason)

    sample_points, sample_reason = score_sample_size_signal(paper.abstract)
    score += sample_points
    reasoning.append(sample_reason)

    detail_points, detail_reason = score_experimental_detail(paper.abstract)
    score += detail_points
    reasoning.append(detail_reason)

    recency_points, recency_reason = score_recency(paper.year)
    score += recency_points
    reasoning.append(recency_reason)

    bounded_score = min(score, 100)
    return EvidenceScore(
        paper_index=paper_index,
        source_label=format_study_label(paper),
        title=paper.title,
        score=bounded_score,
        confidence=confidence_label(bounded_score),
        reasoning=reasoning,
    )


def score_citation_count(citation_count: Optional[int]) -> tuple[int, str]:
    if citation_count is None:
        return 0, "Citation count is unavailable in the retrieved ADS metadata."
    if citation_count >= 100:
        return 25, f"Citation count is high ({citation_count})."
    if citation_count >= 50:
        return 20, f"Citation count is substantial ({citation_count})."
    if citation_count >= 20:
        return 15, f"Citation count is moderate ({citation_count})."
    if citation_count > 0:
        return 10, f"Citation count is available but limited ({citation_count})."
    return 0, "Citation count is zero in the retrieved ADS metadata."


def score_review_indicator(paper: ResearchPaper) -> tuple[int, str]:
    text = f"{paper.title} {paper.abstract}".lower()
    if "systematic review" in text or "meta-analysis" in text or "meta analysis" in text:
        return 18, "The paper includes a systematic review or meta-analysis indicator."
    if re.search(r"\breview(?:s|ed|ing)?\b", text):
        return 12, "The paper includes a review article indicator."
    return 0, "No review article indicator was detected in the title or abstract."


def score_sample_size_signal(abstract: str) -> tuple[int, str]:
    sample_size = extract_sample_size(abstract)
    if sample_size is None:
        sample_terms = re.search(
            r"\b(?:sample|samples|subjects|participants|astronauts|mice|rats|plants|seedlings|cells)\b",
            abstract,
            flags=re.IGNORECASE,
        )
        if sample_terms:
            return 5, "The abstract mentions sample-related terms but no explicit sample size."
        return 0, "No sample size reference was detected in the abstract."
    if sample_size >= 30:
        return 20, f"The abstract includes a larger explicit sample size signal (n={sample_size})."
    if sample_size >= 10:
        return 15, f"The abstract includes a moderate explicit sample size signal (n={sample_size})."
    return 10, f"The abstract includes a small explicit sample size signal (n={sample_size})."


def extract_sample_size(text: str) -> Optional[int]:
    patterns = [
        r"\bn\s*=\s*(\d{1,4})\b",
        r"\b(\d{1,4})\s+(?:astronauts|subjects|participants|mice|rats|plants|seedlings|samples|crew\s+members|volunteers|cell\s+lines)\b",
    ]
    matches: list[int] = []
    for pattern in patterns:
        for match in re.finditer(pattern, text or "", flags=re.IGNORECASE):
            try:
                matches.append(int(match.group(1)))
            except (TypeError, ValueError):
                continue
    return max(matches) if matches else None


def score_experimental_detail(abstract: str) -> tuple[int, str]:
    keywords = {
        "assay",
        "control",
        "dose",
        "experiment",
        "exposure",
        "flight",
        "ground",
        "iss",
        "measure",
        "measured",
        "microgravity",
        "mission",
        "radiation",
        "rna",
        "sequencing",
        "spaceflight",
    }
    text = (abstract or "").lower()
    matched = sorted(keyword for keyword in keywords if re.search(rf"\b{re.escape(keyword)}\b", text))
    if len(matched) >= 6:
        return 25, f"The abstract contains extensive experimental detail signals ({', '.join(matched[:8])})."
    if len(matched) >= 3:
        return 15, f"The abstract contains several experimental detail signals ({', '.join(matched)})."
    if matched:
        return 8, f"The abstract contains limited experimental detail signals ({', '.join(matched)})."
    return 0, "No experimental detail signal was detected in the abstract."


def score_recency(year: Optional[int]) -> tuple[int, str]:
    if year is None:
        return 0, "Publication year is unavailable."

    current_year = datetime.now().year
    age = current_year - year
    if age <= 5:
        return 15, f"The study is recent ({year})."
    if age <= 10:
        return 10, f"The study is moderately recent ({year})."
    if age <= 20:
        return 5, f"The study is older but still within the last two decades ({year})."
    return 0, f"The study is older ({year})."


def confidence_label(score: int) -> str:
    if score >= 70:
        return "High Confidence"
    if score >= 40:
        return "Medium Confidence"
    return "Low Confidence"
