"""Actions the chat assistant can PROPOSE. Nothing runs until the user taps Confirm in the UI, and the server re-validates
every action against the database at that moment (the model's wording is never trusted; labels are built from DB data)."""
import datetime as dt
from dataclasses import dataclass
from typing import Callable

import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ...models import PausedSeries, PlannedExpense
from ..analytics.context import UserContext
from .corpus import gbp, is_essential

TOOLS = [
    {"name": "pause_subscription", "description": "Propose pausing/cancelling a NON-essential recurring payment (subscription). Use the series_id from the context. Never for essential bills such as rent, mortgage, energy, phone, debt or transfers.",
     "input_schema": {"type": "object", "properties": {"series_id": {"type": "string"}}, "required": ["series_id"]}},
    {"name": "resume_subscription", "description": "Propose switching a paused recurring payment back on.",
     "input_schema": {"type": "object", "properties": {"series_id": {"type": "string"}}, "required": ["series_id"]}},
    {"name": "remove_planned_expense", "description": "Propose removing a planned one-off future expense. Use the planned_id from the context.",
     "input_schema": {"type": "object", "properties": {"planned_id": {"type": "integer"}}, "required": ["planned_id"]}},
    {"name": "add_planned_expense", "description": "Propose adding a planned future one-off expense that the user explicitly told you about, with an exact amount and date (YYYY-MM-DD). Never invent values.",
     "input_schema": {"type": "object", "properties": {"description": {"type": "string"}, "amount": {"type": "number", "description": "positive pounds"}, "date": {"type": "string"}, "essential": {"type": "boolean"}},
                      "required": ["description", "amount", "date"]}},
]


@dataclass
class Checked:
    ok: bool
    label: str = ""
    error: str = ""
    run: Callable[[], str] | None = None


def _series(ctx: UserContext, sid):
    return next((s for s in ctx.recurring if s.id == sid), None)


def check(a: dict, ctx: UserContext, db: Session) -> Checked:
    uid, kind = ctx.user.id, a.get("type")
    if kind in ("pause_subscription", "resume_subscription"):
        s = _series(ctx, a.get("series_id"))
        if not s or s.direction != "out":
            return Checked(False, error="I could not find that payment.")
        paused = db.scalar(select(PausedSeries).where(PausedSeries.user_id == uid, PausedSeries.series_id == s.id))
        if kind == "pause_subscription":
            if is_essential(s):
                return Checked(False, error=f"{s.name} is an essential payment, so I can't cancel it here. Contact the provider, or free help like Citizens Advice, if you are struggling to pay it.")
            if paused:
                return Checked(False, error=f"{s.name} is already paused.")

            def run():
                db.add(PausedSeries(user_id=uid, series_id=s.id)); db.commit()
                return f"Paused {s.name}. It no longer counts in your upcoming payments or forecast."
            return Checked(True, f"Pause {s.name} ({gbp(s.amount)} {s.period})", run=run)
        if not paused:
            return Checked(False, error=f"{s.name} is already active.")

        def run():
            db.delete(paused); db.commit()
            return f"{s.name} is back on."
        return Checked(True, f"Switch {s.name} back on ({gbp(s.amount)} {s.period})", run=run)

    if kind == "remove_planned_expense":
        try:
            p = db.get(PlannedExpense, int(a.get("planned_id")))
        except (TypeError, ValueError):
            p = None
        if not p or p.user_id != uid:
            return Checked(False, error="I could not find that planned expense.")

        def run():
            db.delete(p); db.commit()
            return f"Removed {p.description}."
        return Checked(True, f"Remove planned expense: {p.description} ({gbp(p.amount)}, {p.date})", run=run)

    if kind == "add_planned_expense":
        try:
            amt, date = abs(float(a.get("amount"))), dt.date.fromisoformat(str(a.get("date")))
        except (TypeError, ValueError):
            return Checked(False, error="I need a clear description, amount and date to add that.")
        desc = str(a.get("description") or "").strip()[:80]
        if not desc or not 0 < amt <= 100000:
            return Checked(False, error="I need a clear description, amount and date to add that.")
        if date <= ctx.as_of.date():
            return Checked(False, error="That date is not in the future.")

        def run():
            db.add(PlannedExpense(user_id=uid, date=date, description=desc, amount=-amt, essential=bool(a.get("essential")))); db.commit()
            return f"Added {desc} on {date}. Your forecast now includes it."
        return Checked(True, f"Add planned expense: {desc} ({gbp(amt)}, {date})", run=run)
    return Checked(False, error="Unknown action.")


def propose(tool_uses: list[dict], ctx: UserContext, db: Session):
    actions, notes = [], []
    for t in tool_uses:
        a = {"type": t["name"], **(t.get("input") or {})}
        c = check(a, ctx, db)
        if c.ok:
            actions.append({"action": a, "label": c.label})
        else:
            notes.append(c.error)
    return actions, notes


def execute(a: dict, ctx: UserContext, db: Session) -> tuple[bool, str]:
    c = check(a, ctx, db)
    return (True, c.run()) if c.ok else (False, c.error)
