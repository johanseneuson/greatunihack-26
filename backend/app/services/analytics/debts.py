"""Debt payoff plans and the Future Self milestones (debt-free countdown, emergency fund, payday shortfall).

The debt simulation is month by month: interest is added, every debt gets its minimum payment, and any extra
money goes to the debt with the highest interest rate first (the "avalanche" method - the cheapest way to clear
debt). When a debt is cleared its minimum payment rolls onto the next one.

These plans also correct the balance forecast: the forecast assumes a detected debt payment (e.g. Klarna) goes on
forever and knows nothing about debts that aren't in the transactions. `balance_shift` turns a plan into
month-by-month adjustments to the forecast's balances.
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .context import UserContext
from .forecast import ForecastResult

MAX_MONTHS = 360


@dataclass
class DebtIn:
    id: int
    name: str
    kind: str
    balance: float
    apr: float
    min_payment: float
    series_id: str | None = None


def simulate(debts: list[DebtIn], extra: float = 0.0, months: int = MAX_MONTHS) -> dict:
    """Month-by-month payoff. Returns payments per month, balances per debt and when each is cleared."""
    bal = {d.id: float(d.balance) for d in debts}
    rate = {d.id: d.apr / 100 / 12 for d in debts}
    order = sorted(debts, key=lambda d: (-d.apr, d.balance))  # avalanche: highest APR first
    cleared: dict[int, int] = {}
    payments, totals, interest_total = [], [], 0.0
    stuck = False
    for m in range(1, months + 1):
        if all(b <= 0.005 for b in bal.values()):
            break
        interest = {i: bal[i] * rate[i] for i in bal if bal[i] > 0}
        interest_total += sum(interest.values())
        for i, x in interest.items():
            bal[i] += x
        pot = extra + sum(d.min_payment for d in debts if d.id in cleared)  # freed-up minimums roll over
        paid = 0.0
        for d in debts:
            if bal[d.id] > 0:
                p = min(d.min_payment, bal[d.id])
                bal[d.id] -= p
                paid += p
        for d in order:
            if pot <= 0:
                break
            if bal[d.id] > 0:
                p = min(pot, bal[d.id])
                bal[d.id] -= p
                pot -= p
                paid += p
        for d in debts:
            if bal[d.id] <= 0.005 and d.id not in cleared:
                cleared[d.id] = m
        payments.append(paid)
        totals.append(sum(max(0.0, b) for b in bal.values()))
        if m == 12 and totals[-1] >= sum(d.balance for d in debts) - 0.01:
            stuck = True  # payments don't even cover interest
            break
    done = all(b <= 0.005 for b in bal.values()) and not stuck
    return {
        "months": len(payments) if done else None,
        "interest": round(interest_total, 2) if done else None,
        "cleared": cleared,
        "payments": payments,
        "remaining": totals,
        "never": not done,
    }


def debts_for(db_debts) -> list[DebtIn]:
    return [DebtIn(d.id, d.name, d.kind, d.balance, d.apr, d.min_payment, d.series_id) for d in db_debts if d.balance > 0]


def _assumed_payment(ctx: UserContext, d: DebtIn) -> float:
    """What the forecast already pays towards this debt each month (via a detected recurring payment)."""
    s = next((s for s in ctx.recurring if s.id == d.series_id and s.active), None)
    return s.amount * 30.44 / s.period_days if s else 0.0


def balance_shift(ctx: UserContext, debts: list[DebtIn], plan: dict, months: int) -> np.ndarray:
    """Cumulative change to the forecast balance at the end of each of the next `months` months."""
    assumed = sum(_assumed_payment(ctx, d) for d in debts)
    pay = np.array(plan["payments"][:months] + [0.0] * max(0, months - len(plan["payments"])))
    return np.cumsum(assumed - pay)


def _month_end_index(fc: ForecastResult, k: int, as_of: pd.Timestamp) -> int | None:
    target = (as_of + pd.DateOffset(months=k)).normalize()
    i = int((target - fc.dates[0]).days)
    return i if 0 <= i < len(fc.dates) else None


def _emergency_target(ctx: UserContext) -> tuple[float, str]:
    goal = next((g for g in ctx.user.goals if "emergency" in g.name.lower() or "buffer" in g.name.lower()), None)
    if goal:
        return float(goal.target_amount), goal.name
    target = float(np.ceil(max(300.0, 3 * ctx.essential_monthly) / 50) * 50)
    return target, "3 months of essentials"


def milestones(ctx: UserContext, fc: ForecastResult, debts: list[DebtIn], extra: float = 0.0) -> dict:
    """Debt-free countdown, emergency-fund progress and the before-payday check - with and without extra payments."""
    horizon = min(12, len(fc.dates) // 31)
    base_plan, plan = simulate(debts, 0.0), simulate(debts, extra)
    base_shift, shift = balance_shift(ctx, debts, base_plan, horizon), balance_shift(ctx, debts, plan, horizon)
    p50 = np.percentile(fc.balances, 50, axis=0)

    path = []
    for k in range(1, horizon + 1):
        i = _month_end_index(fc, k, ctx.as_of)
        if i is None:
            break
        path.append({
            "month": fc.dates[i].strftime("%Y-%m"), "date": fc.dates[i].date().isoformat(),
            "balance_current": round(float(p50[i] + base_shift[k - 1]), 2),
            "balance_with_plan": round(float(p50[i] + shift[k - 1]), 2),
            "debt_current": round(base_plan["remaining"][k - 1] if k <= len(base_plan["remaining"]) else 0.0, 2),
            "debt_with_plan": round(plan["remaining"][k - 1] if k <= len(plan["remaining"]) else 0.0, 2),
        })

    total_debt = sum(d.balance for d in debts)

    def free_date(p):
        return (ctx.as_of + pd.DateOffset(months=p["months"])).date().isoformat() if p["months"] else None

    debt = None
    if debts:
        debt = {
            "total": round(total_debt, 2),
            "min_payments": round(sum(d.min_payment for d in debts), 2),
            "months_current": base_plan["months"], "months_with_plan": plan["months"],
            "date_current": free_date(base_plan), "date_with_plan": free_date(plan),
            "interest_current": base_plan["interest"], "interest_with_plan": plan["interest"],
            "interest_saved": round(base_plan["interest"] - plan["interest"], 2) if base_plan["interest"] is not None and plan["interest"] is not None else None,
            "months_saved": (base_plan["months"] - plan["months"]) if base_plan["months"] and plan["months"] else None,
            "never_current": base_plan["never"], "never_with_plan": plan["never"],
            "items": [{
                "id": d.id, "name": d.name, "kind": d.kind, "balance": d.balance, "apr": d.apr, "min_payment": d.min_payment,
                "months_current": base_plan["cleared"].get(d.id), "months_with_plan": plan["cleared"].get(d.id),
            } for d in debts],
        }

    # Emergency fund: first month-end the (adjusted) balance reaches the target
    target, label = _emergency_target(ctx)

    def reach(key):
        if ctx.balance >= target:
            return 0
        return next((k + 1 for k, row in enumerate(path) if row[key] >= target), None)

    m_cur, m_plan = reach("balance_current"), reach("balance_with_plan")
    emergency = {
        "target": target, "label": label, "current": round(max(0.0, ctx.balance), 2),
        "progress": round(float(np.clip(ctx.balance / target, 0, 1)), 3) if target else 1.0,
        "months_current": m_cur, "months_with_plan": m_plan,
        "date_current": path[m_cur - 1]["date"] if m_cur else (ctx.as_of.date().isoformat() if m_cur == 0 else None),
        "date_with_plan": path[m_plan - 1]["date"] if m_plan else (ctx.as_of.date().isoformat() if m_plan == 0 else None),
    }

    # Before payday: lowest point and chance of going below £0 before the next income lands
    incomes = [e for e in fc.scheduled if e["kind"] == "income"]
    payday = None
    if incomes:
        pd_date = pd.Timestamp(incomes[0]["date"])
        n = max(1, int((pd_date - fc.dates[0]).days))
        lows = fc.balances[:, :n].min(axis=1)
        # Extra repayments are made on the 1st: they only bite before payday if the 1st comes first
        first = (ctx.as_of + pd.offsets.MonthBegin(1)).normalize()
        extra_before = extra if first < pd_date else 0.0
        payday = {
            "date": pd_date.date().isoformat(), "days": int((pd_date - ctx.as_of).days), "amount": incomes[0]["amount"],
            "lowest_current": round(float(np.percentile(lows, 50)), 2),
            "lowest_with_plan": round(float(np.percentile(lows, 50) - extra_before), 2),
            "prob_short_current": round(float((lows < 0).mean()), 3),
            "prob_short_with_plan": round(float((lows - extra_before < 0).mean()), 3),
        }

    return {"extra": extra, "horizon_months": horizon, "debt": debt, "emergency": emergency, "payday": payday, "path": path}
