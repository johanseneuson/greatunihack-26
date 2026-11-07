"""AI coach: turns the computed insights into a short, positive, personalised story.

All numbers come from the analytics engine; Claude only explains and prioritises them.
Works without an API key via a rule-based fallback, so the demo never breaks.
"""
import json
import logging

import anthropic
from pydantic import BaseModel, ValidationError

from ..config import settings

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the NatEast assistant, a warm, upbeat money guide inside a UK banking app.
You receive a JSON snapshot produced by the app's forecasting engine: the user's circumstances,
their resilience score, a Monte Carlo forecast of their balance ("financial time travel"),
detected spending waves, early warnings and a personalised budget.

Write for the user directly ("you"). Your job:
- Show them how their future can look, in a positive and motivating way, while being honest about risks.
- Anticipate hardship or unexpected costs before they happen, and give concrete, small, doable steps.
- Reflect their personal circumstances (income type, household, challenges, notes).
- Use only figures that appear in the snapshot; round money to whole pounds with the £ sign. Never invent numbers.
- No shaming, no jargon. British English. Keep each field short - this is shown on a phone.
- This is guidance, not regulated financial advice; don't recommend specific financial products."""


class CoachAction(BaseModel):
    title: str
    detail: str
    impact: str


class CoachReply(BaseModel):
    headline: str
    summary: str
    future_you: str
    watch_out: list[str]
    actions: list[CoachAction]
    encouragement: str


SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string", "description": "One upbeat line, max 12 words"},
        "summary": {"type": "string", "description": "2-3 sentences on where they are now"},
        "future_you": {"type": "string", "description": "2-3 sentences describing their likely future, positively framed"},
        "watch_out": {"type": "array", "items": {"type": "string"}, "description": "Up to 3 upcoming risks, each one sentence with a date or amount"},
        "actions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "detail": {"type": "string"}, "impact": {"type": "string"}},
                "required": ["title", "detail", "impact"],
                "additionalProperties": False,
            },
            "description": "Up to 3 concrete next steps, highest impact first",
        },
        "encouragement": {"type": "string", "description": "One short closing line"},
    },
    "required": ["headline", "summary", "future_you", "watch_out", "actions", "encouragement"],
    "additionalProperties": False,
}


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.anthropic_api_key) if settings.anthropic_api_key else anthropic.Anthropic()


def ai_coach(snapshot: dict, question: str | None = None) -> CoachReply:
    user_msg = "Here is my financial snapshot:\n" + json.dumps(snapshot, default=str)
    if question:
        user_msg += f"\n\nMy question: {question}"
    response = _client().beta.messages.create(
        model=settings.coach_model,
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("Coach request was declined")
    text = next(b.text for b in response.content if b.type == "text")
    return CoachReply.model_validate_json(text)


def fallback_coach(snapshot: dict) -> CoachReply:
    s = settings.currency_symbol
    res = snapshot.get("resilience", {})
    tt = snapshot.get("time_travel", [])
    warnings = [w for w in snapshot.get("warnings", []) if w["severity"] in ("critical", "warning")]
    six = next((t for t in tt if t["months_ahead"] == 6), tt[-1] if tt else None)
    moves = snapshot.get("smart_moves", [])
    actions = [CoachAction(title=m["title"], detail=m["message"], impact=f"+{s}{m['balance_gain_6m']:,.0f} in 6 months") for m in moves[:2]]
    actions += [CoachAction(title=w["title"], detail=w["action"] or w["message"], impact=w["upside"] or "") for w in warnings[:3 - len(actions)]]
    return CoachReply(
        headline=f"You're {res.get('label', 'on your way').lower()} - and your future can be brighter.",
        summary=f"Your resilience score is {res.get('score', '-')}/100. {res.get('next_best_step', '')}",
        future_you=six["headline"] if six else "Add more history to see your future.",
        watch_out=[f"{w['title']}: {w['message']}" for w in warnings[:3]],
        actions=actions,
        encouragement="Small steps today, a calmer future tomorrow.",
    )


def coach(snapshot: dict, question: str | None = None) -> dict:
    if settings.coach_enabled:
        try:
            return {"source": "ai", "model": settings.coach_model, **ai_coach(snapshot, question).model_dump()}
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
            log.info("AI coach unavailable (credentials): %s", e)
        except anthropic.RateLimitError as e:
            log.warning("AI coach rate limited: %s", e)
        except anthropic.APIStatusError as e:
            log.warning("AI coach API error %s: %s", e.status_code, e)
        except anthropic.APIConnectionError as e:
            log.warning("AI coach connection error: %s", e)
        except (RuntimeError, ValidationError, StopIteration, TypeError) as e:
            # TypeError: the SDK raises it when no credentials are configured at all
            log.warning("AI coach fallback: %s", e)
    return {"source": "rules", "model": None, **fallback_coach(snapshot).model_dump()}
