import re


MAX_EXPANDED_VARIANTS = 5


def expand_research_query(query: str) -> list[str]:
    cleaned_query = normalize_query(query)
    if not cleaned_query:
        return []

    variants = [cleaned_query]
    variants.extend(build_domain_variants(cleaned_query))
    variants.extend(build_general_variants(cleaned_query))

    return dedupe_queries(variants)[: MAX_EXPANDED_VARIANTS + 1]


def normalize_query(query: str) -> str:
    cleaned = re.sub(r"\s+", " ", query or "").strip()
    return cleaned.strip(" .?;:")


def build_domain_variants(query: str) -> list[str]:
    query_lower = query.lower()

    if "microbiome" in query_lower or "gut" in query_lower:
        return [
            "astronaut gut microbiome",
            "spaceflight gut microbiome",
            "human microbiome during spaceflight",
            "astronaut microbiome research",
            "microbiome changes in astronauts",
        ]

    if "radiation" in query_lower and "dna" in query_lower:
        return [
            "space radiation DNA damage",
            "radiation induced DNA damage astronauts",
            "cosmic radiation DNA repair",
            "astronaut radiation exposure genetics",
            "space radiation DNA repair mechanisms",
        ]

    if "plant" in query_lower and ("microgravity" in query_lower or "spaceflight" in query_lower):
        return [
            "plant growth microgravity",
            "spaceflight plant growth",
            "microgravity effects on plant development",
            "plant biology spaceflight",
            "crop growth in microgravity",
        ]

    if "bone" in query_lower and ("astronaut" in query_lower or "space" in query_lower):
        return [
            "astronaut bone density loss",
            "spaceflight bone loss",
            "microgravity skeletal deconditioning",
            "astronaut osteoporosis microgravity",
            "bone remodeling during spaceflight",
        ]

    if "microgravity" in query_lower and ("human" in query_lower or "astronaut" in query_lower):
        return [
            "microgravity effects on humans",
            "astronaut physiology microgravity",
            "human adaptation to microgravity",
            "spaceflight human health microgravity",
            "microgravity physiological effects astronauts",
        ]

    return []


def build_general_variants(query: str) -> list[str]:
    keywords = extract_keywords(query)
    if not keywords:
        return []

    base = " ".join(keywords[:6])
    variants = [base]

    if "spaceflight" not in base.lower():
        variants.append(f"{base} spaceflight")
    if "astronaut" not in base.lower() and "astronauts" not in base.lower():
        variants.append(f"{base} astronauts")
    if "research" not in base.lower():
        variants.append(f"{base} research")

    return variants


def extract_keywords(query: str) -> list[str]:
    stop_words = {
        "a",
        "an",
        "and",
        "are",
        "does",
        "during",
        "exist",
        "gaps",
        "how",
        "in",
        "of",
        "on",
        "the",
        "to",
        "what",
        "which",
        "with",
    }
    words = re.findall(r"[A-Za-z0-9]+", query)
    return [word for word in words if word.lower() not in stop_words]


def dedupe_queries(queries: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()

    for query in queries:
        cleaned = normalize_query(query)
        key = cleaned.lower()
        if not cleaned or key in seen:
            continue
        deduped.append(cleaned)
        seen.add(key)

    return deduped
