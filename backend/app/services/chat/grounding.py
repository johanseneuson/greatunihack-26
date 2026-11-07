"""Deterministic hallucination check.

Every £ figure in a reply must come from the retrieved context or the user's own messages, or be a simple
sum / difference / x12 of such figures (allowing for rounding). Otherwise the reply is rejected and retried.
"""
import re

_MONEY = re.compile(r"£\s?(\d[\d,]*(?:\.\d+)?)")
_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _vals(rx: re.Pattern, text: str) -> list[float]:
    out = []
    for m in rx.finditer(text or ""):
        try:
            out.append(float((m.group(1) if rx.groups else m.group(0)).replace(",", "")))
        except ValueError:
            pass
    return out


def unsupported_figures(reply: str, context: str, user_text: str) -> list[float]:
    used = _vals(_MONEY, reply)
    if not used:
        return []
    base = sorted({round(n, 2) for n in _vals(_MONEY, context) + _vals(_MONEY, user_text) + _vals(_NUM, user_text)})[:140]
    allowed = set(base)
    for a in base:
        allowed.update({round(a * 12, 2), round(a * 2, 2), round(a * 4, 2), round(a / 2, 2), round(a / 4, 2)})
    small = len(base) <= 70
    for i, a in enumerate(base):
        for j in range(i, len(base)):
            b = base[j]
            allowed.add(round(a + b, 2))
            allowed.add(round(abs(a - b), 2))
            if small:
                for k in range(j, len(base)):
                    allowed.add(round(a + b + base[k], 2))
    return [u for u in used if not any(abs(a - u) <= 0.51 for a in allowed)]
