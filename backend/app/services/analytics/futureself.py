"""Future Self: answer "what if...?" questions about your money with the forecast engine.

1. Claude turns the question into a structured scenario (strict JSON schema: categories and debts must be real ones).
   Without an API key a small rule-based parser handles the common phrasings.
2. The forecast + debt engines compute the outcome. Every figure in the answer comes from the engines, never from the
   language model, so nothing is made up.
"""
import json
import logging
import re

import anthropic
import numpy as np
import pandas as pd

from ...config import settings
from ..categories import CATEGORIES
from .context import UserContext
from .debts import DebtIn, balance_shift, simulate
from .forecast import Adjustment, ForecastResult, run_forecast

log = logging.getLogger(__name__)
SPEND_CATEGORIES = [c for c, g in CATEGORIES.items() if g in ("essential", "discretionary")]

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "restatement": {"type": "string", "description": "The question restated as the scenario being simulated, one short sentence, second person"},
        "horizon_months": {"type": "integer", "description": "How far ahead to look, 1-12. Default 6 if not stated"},
        "extra_debt_payment": {"type": "number", "description": "Extra paid towards debts each month in pounds, 0 if none"},
        "category_changes": {
            "type": "array",
            "items": {"type": "object", "properties": {"category": {"type": "string", "enum": SPEND_CATEGORIES},
                                                      "change_pct": {"type": "number"}},
                      "required": ["category", "change_pct"], "additionalProperties": False},
        },
        "income_change_pct": {"type": "number", "description": "Change to income in percent, 0 if none"},
        "one_offs": {
            "type": "array", "description": "One-off costs (negative) or windfalls (positive)",
            "items": {"type": "object", "properties": {"label": {"type": "string"}, "amount": {"type": "number"},
                                                      "months_from_now": {"type": "integer"}},
                      "required": ["label", "amount", "months_from_now"], "additionalProperties": False},
        },
        "new_monthly": {
            "type": "array", "description": "New regular monthly amounts: negative = new cost (e.g. gym, saving into a pot), positive = new income",
            "items": {"type": "object", "properties": {"label": {"type": "string"}, "amount": {"type": "number"}},
                      "required": ["label", "amount"], "additionalProperties": False},
        },
    },
    "required": ["restatement", "horizon_months", "extra_debt_payment", "category_changes", "income_change_pct", "one_offs", "new_monthly"],
    "additionalProperties": False,
}

SYSTEM = """You convert a person's 'what if' question about their own money into a scenario for a forecasting engine.
Only describe the change they asked about; if they ask what happens if they carry on as they are, return no changes.
Use the person's own numbers from the question. Debts listed in CONTEXT are the ones that exist; extra payments go to
debts. Spending categories must be from the allowed list. Never invent changes they didn't ask for."""


def _plan_ai(question: str, ctx: UserContext, debts: list[DebtIn]) -> dict:
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key) if settings.anthropic_api_key else anthropic.Anthropic()
    context = {
        "debts": [{"name": d.name, "balance": d.balance, "apr": d.apr, "min_payment": d.min_payment} for d in debts],
        "monthly_income": ctx.monthly_income,
        "subscriptions": [s.name for s in ctx.recurring if s.direction == "out" and s.active and s.group == "discretionary"],
    }
    r = client.beta.messages.create(
        model=settings.coach_model, max_tokens=2000, system=SYSTEM,
        messages=[{"role": "user", "content": f"CONTEXT: {json.dumps(context)}\n\nQUESTION: {question}"}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": PLAN_SCHEMA}},
        betas=["server-side-fallback-2026-07-01"], fallbacks="default",
    )
    if r.stop_reason == "refusal":
        raise RuntimeError("declined")
    return json.loads(next(b.text for b in r.content if b.type == "text"))


WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
         "eleven": 11, "twelve": 12}
CATEGORY_WORDS = {
    "eating out": "Eating out", "takeaway": "Eating out", "restaurant": "Eating out", "coffee": "Coffee & snacks",
    "shopping": "Shopping", "clothes": "Shopping", "entertainment": "Entertainment", "subscription": "Subscriptions",
    "streaming": "Subscriptions", "groceries": "Groceries", "food shop": "Groceries", "transport": "Transport",
    "taxi": "Transport", "travel": "Travel", "holiday": "Travel",
}


def _plan_rules(question: str) -> dict:
    q = question.lower()
    plan = {"restatement": question.strip(), "horizon_months": 6, "extra_debt_payment": 0.0, "category_changes": [],
            "income_change_pct": 0.0, "one_offs": [], "new_monthly": []}
    if m := re.search(r"(\d+|" + "|".join(WORDS) + r")\s*(month|year)", q):
        n = int(m.group(1)) if m.group(1).isdigit() else WORDS[m.group(1)]
        plan["horizon_months"] = n * 12 if m.group(2) == "year" else n
    elif "a year" in q or "next year" in q:
        plan["horizon_months"] = 12
    amount = (m := re.search(r"£\s?(\d+(?:[.,]\d+)?)", q)) and float(m.group(1).replace(",", ""))
    pct = (m := re.search(r"(\d+(?:\.\d+)?)\s*%", q)) and float(m.group(1))
    if amount and re.search(r"credit card|card|debt|klarna|loan|overdraft|repay|pay off|towards", q):
        plan["extra_debt_payment"] = amount
    elif re.search(r"pay rise|raise|earn|income|salary|wage", q) and (pct or amount):
        plan["income_change_pct"] = pct if pct else 0.0
        if amount and not pct:
            plan["new_monthly"].append({"label": "Extra income", "amount": amount})
    else:
        cat = next((c for w, c in CATEGORY_WORDS.items() if w in q), None)
        if cat and re.search(r"cut|less|reduce|stop|spend less|halve", q):
            change = -50.0 if "halve" in q else -100.0 if "stop" in q else -(pct or 20.0)
            plan["category_changes"].append({"category": cat, "change_pct": change})
        elif amount and re.search(r"save|saving|put aside|pot", q):
            plan["new_monthly"].append({"label": "Saving each month", "amount": -amount})
        elif amount and re.search(r"buy|holiday|trip|car|laptop|spend", q):
            plan["one_offs"].append({"label": "One-off purchase", "amount": -amount, "months_from_now": 1})
    plan["horizon_months"] = int(np.clip(plan["horizon_months"], 1, 12))
    return plan


def interpret(question: str, ctx: UserContext, debts: list[DebtIn]) -> tuple[dict, str]:
    if settings.coach_enabled:
        try:
            p = _plan_ai(question, ctx, debts)
            p["horizon_months"] = int(np.clip(p.get("horizon_months") or 6, 1, 12))
            return p, "ai"
        except (anthropic.AnthropicError, RuntimeError, ValueError, StopIteration, TypeError) as e:
            log.info("Future Self falling back to rules: %s", e)
    return _plan_rules(question), "rules"


def _daily_shift(fc: ForecastResult, monthly_shift: np.ndarray) -> np.ndarray:
    """Spread month-by-month balance changes onto days (payments assumed on the 1st of each month)."""
    # Number of 1sts-of-the-month reached on each day since the forecast started
    s0 = fc.dates[0]
    months_passed = np.array([(d.year - s0.year) * 12 + d.month - s0.month + (1 if s0.day == 1 else 0) for d in fc.dates])
    idx = np.clip(months_passed, 0, len(monthly_shift))
    padded = np.concatenate([[0.0], monthly_shift, [monthly_shift[-1] if len(monthly_shift) else 0.0]])
    return padded[idx]


def _m(x: float) -> str:
    return f"{'-' if x < 0 else ''}£{abs(x):,.0f}"


def ask(ctx: UserContext, base: ForecastResult, debts: list[DebtIn], question: str, sims: int) -> dict:
    plan, source = interpret(question, ctx, debts)
    h = plan["horizon_months"]
    adjustments: list[Adjustment] = []
    for c in plan["category_changes"]:
        if c["category"] in CATEGORIES and c["change_pct"]:
            adjustments.append(Adjustment(type="category", category=c["category"], change_pct=float(np.clip(c["change_pct"], -100, 300))))
    if plan["income_change_pct"]:
        adjustments.append(Adjustment(type="income", change_pct=float(np.clip(plan["income_change_pct"], -100, 200))))
    for o in plan["one_offs"]:
        if o["amount"]:
            when = (ctx.as_of + pd.DateOffset(months=max(0, int(o["months_from_now"])))).date()
            adjustments.append(Adjustment(type="one_off", amount=float(o["amount"]), date=max(when, (ctx.as_of + pd.Timedelta(days=1)).date()), label=o["label"]))
    for n in plan["new_monthly"]:
        if n["amount"]:
            adjustments.append(Adjustment(type="new_recurring", amount=float(n["amount"]), day_of_month=1, label=n["label"]))
    extra = max(0.0, float(plan["extra_debt_payment"] or 0)) if debts else 0.0

    alt = run_forecast(ctx, len(base.dates), sims, adjustments, seed=ctx.user.id * 7919 + 17) if adjustments else base
    months = min(12, len(base.dates) // 31)
    base_plan, new_plan = simulate(debts, 0.0), simulate(debts, extra)
    s_base, s_new = balance_shift(ctx, debts, base_plan, months), balance_shift(ctx, debts, new_plan, months)
    bal_base = base.balances + _daily_shift(base, s_base)[None, :]
    bal_new = alt.balances + _daily_shift(alt, s_new)[None, :]
    p50_base, p50_new = np.percentile(bal_base, 50, axis=0), np.percentile(bal_new, 50, axis=0)

    path = []
    for k in range(1, months + 1):
        i = int(((ctx.as_of + pd.DateOffset(months=k)).normalize() - base.dates[0]).days)
        if not 0 <= i < len(base.dates):
            break
        path.append({"month": base.dates[i].strftime("%Y-%m"), "date": base.dates[i].date().isoformat(),
                     "balance_current": round(float(p50_base[i]), 2), "balance_new": round(float(p50_new[i]), 2),
                     "debt_current": round(base_plan["remaining"][k - 1] if k <= len(base_plan["remaining"]) else 0.0, 2),
                     "debt_new": round(new_plan["remaining"][k - 1] if k <= len(new_plan["remaining"]) else 0.0, 2)})
    at = path[min(h, len(path)) - 1] if path else None
    risk_base = float((bal_base[:, :90].min(axis=1) < 0).mean())
    risk_new = float((bal_new[:, :90].min(axis=1) < 0).mean())

    def free(p):
        return (ctx.as_of + pd.DateOffset(months=p["months"])).strftime("%B %Y") if p["months"] else None

    changed = bool(adjustments or extra)
    lines = []
    if at:
        when = "in a year" if h == 12 else f"in {h} month{'s' if h > 1 else ''}"
        if changed:
            diff = at["balance_new"] - at["balance_current"]
            lines.append(f"{when.capitalize()} you'd likely have {_m(at['balance_new'])}, compared with {_m(at['balance_current'])} "
                         f"if nothing changes ({'+' if diff >= 0 else '-'}{_m(abs(diff))}).")
        else:
            lines.append(f"If you carry on as you are, {when} you'd likely have {_m(at['balance_current'])} (you have {_m(ctx.balance)} today).")
    debt_question = extra > 0 or not changed or bool(re.search(r"debt|credit|card|klarna|loan|owe|repay", question, re.I))
    if debts and debt_question:
        if extra and new_plan["months"] and base_plan["months"]:
            saved = base_plan["months"] - new_plan["months"]
            lines.append(f"Paying {_m(extra)} extra a month clears your debts by {free(new_plan)}"
                         + (f", {saved} month{'s' if saved != 1 else ''} sooner" if saved > 0 else "")
                         + (f", and saves {_m(base_plan['interest'] - new_plan['interest'])} in interest." if base_plan["interest"] - new_plan["interest"] >= 1 else "."))
        elif base_plan["months"]:
            lines.append(f"On minimum payments you'd be debt-free by {free(base_plan)}.")
        elif base_plan["never"]:
            lines.append("On minimum payments your debt isn't going down - a small extra payment would change that.")
    if changed and abs(risk_new - risk_base) >= 0.02:
        lines.append(f"Your chance of going overdrawn in the next 3 months goes from {round(risk_base * 100)}% to {round(risk_new * 100)}%.")
    if changed and at and at["balance_new"] < 0 <= at["balance_current"]:
        lines.append("That would leave you overdrawn by then - a smaller change might fit better.")

    return {
        "question": question, "source": source,
        "interpretation": {"restatement": plan["restatement"], "horizon_months": h, "extra_debt_payment": extra,
                           "changes": [{"type": a.type, "category": a.category, "change_pct": a.change_pct, "amount": a.amount,
                                        "label": a.label, "date": a.date.isoformat() if a.date else None} for a in adjustments]},
        "answer": " ".join(lines),
        "at_horizon": at,
        "risk_90d": {"current": round(risk_base, 3), "new": round(risk_new, 3)},
        "debt": {"date_current": free(base_plan), "date_new": free(new_plan),
                 "interest_current": base_plan["interest"], "interest_new": new_plan["interest"]} if debts else None,
        "path": path,
    }
