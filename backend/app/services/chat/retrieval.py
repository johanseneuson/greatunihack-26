"""BM25 retrieval over the user's own data (built fresh per question, so edits show immediately) plus a guidance
knowledge base. To upgrade, swap `search` for an embedding model; callers don't change."""
import math
import re
from collections import Counter

STOP = set("a an the and or of to in on for is are was were be been it my me i you your we our with at by from that this what how can do does did if so as but not no about have has had will would should could into than then there their they them its".split())


def _tok(s: str) -> list[str]:
    return [re.sub(r"(ing|ed|es|s)$", "", w) for w in re.findall(r"[a-z0-9£]+", s.lower()) if w not in STOP]


def search(docs: list[dict], query: str, k: int = 5) -> list[dict]:
    """Core docs (profile, position, upcoming, subscriptions, planned...) are always returned: they are small and
    the assistant needs ids and dates from them. BM25 picks the best of the rest (transactions, guidance)."""
    for d in docs:
        d["_t"] = _tok(d["title"] + " " + d["title"] + " " + d["text"])
    n = len(docs)
    avg = sum(len(d["_t"]) for d in docs) / max(n, 1)
    df = Counter(t for d in docs for t in set(d["_t"]))
    q = _tok(query)
    scored = []
    for d in docs:
        if d.get("core"):
            continue
        tf = Counter(d["_t"])
        sc = 0.0
        for t in q:
            if t in tf:
                idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
                sc += idf * tf[t] * 2.2 / (tf[t] + 1.2 * (0.25 + 0.75 * len(d["_t"]) / avg))
        if sc > 0:
            scored.append((sc, d))
    scored.sort(key=lambda x: -x[0])
    return [d for d in docs if d.get("core")] + [d for _, d in scored[:k]]
