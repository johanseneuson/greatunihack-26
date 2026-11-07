"""Personalised budget: built from the user's own history and circumstances, not a generic template."""
import numpy as np
import pandas as pd

from ..categories import FLEXIBILITY, group_of
from .context import UserContext
from .forecast import ForecastResult


def _target_savings_rate(ctx: UserContext, current_rate: float) -> tuple[float, str]:
    u = ctx.user
    if u.income_type in ("student", "benefits"):
        target, why = 0.05, "a gentle 5% target fits a student/benefits income"
    elif u.income_type in ("irregular", "mixed"):
        target, why = 0.15, "irregular income needs a steady 15% to smooth lean months"
    else:
        target, why = 0.20, "the classic 20% savings target for a regular salary"
    if u.dependents:
        target -= 0.05
        why += f", eased slightly for {u.dependents} dependent(s)"
    if "debt" in (u.challenges or []):
        why += "; repayments count toward this goal"
    if current_rate > target:
        target, why = current_rate, "you already save more than a typical target - keep it up"
    return float(np.clip(target, 0.0, 0.5)), why


def build_budget(ctx: UserContext, fc: ForecastResult) -> dict:
    if not ctx.has_data:
        return {"categories": [], "totals": {}, "safe_to_spend": None}
    months_window = min(6.0, max(1.0, ctx.history_days / 30.44))
    window = ctx.flows[(ctx.flows["date"] > ctx.as_of - pd.Timedelta(days=round(months_window * 30.44)))
                       & (ctx.flows["category"] != "Income")]
    w = window.assign(month=window["date"].dt.to_period("M"))
    per_month = (-w.pivot_table(index="month", columns="category", values="amount", aggfunc="sum")).fillna(0.0)
    full = per_month[per_month.index < ctx.as_of.to_period("M")]
    per_month_hist = full if len(full) else per_month
    avg = per_month_hist.mean()
    income = ctx.monthly_income
    spend_total = float(avg[avg > 0].sum())
    current_rate = (income - spend_total) / income if income else 0.0
    target_rate, why = _target_savings_rate(ctx, current_rate)

    essentials = float(avg[[c for c in avg.index if group_of(c) == "essential"]].clip(lower=0).sum())
    discretionary = {c: float(v) for c, v in avg.items() if group_of(c) == "discretionary" and v > 0}
    allowance = max(0.0, income * (1 - target_rate) - essentials)
    disc_total = sum(discretionary.values())
    gap = max(0.0, disc_total - allowance)

    # Spread the needed cut by flexibility (eating out trims more easily than personal care), max 40% each.
    cuts = {c: 0.0 for c in discretionary}
    remaining = gap
    for _ in range(5):
        if remaining < 1:
            break
        weights = {c: v * FLEXIBILITY.get(c, 0.5) for c, v in discretionary.items() if cuts[c] < 0.4 * v}
        wsum = sum(weights.values())
        if not wsum:
            break
        for c, wt in weights.items():
            add = min(remaining * wt / wsum, 0.4 * discretionary[c] - cuts[c])
            cuts[c] += add
        remaining = gap - sum(cuts.values())

    this_month = ctx.as_of.to_period("M")
    spent_now = per_month.loc[this_month] if this_month in per_month.index else pd.Series(dtype=float)
    month_progress = ctx.as_of.day / ctx.as_of.days_in_month

    rows = []
    for c in sorted(avg.index, key=lambda c: -avg[c]):
        if avg[c] <= 0:
            continue
        limit = avg[c] - cuts.get(c, 0.0)
        spent = float(spent_now.get(c, 0.0))
        pace = spent / (limit * month_progress) if limit and month_progress else 0
        rows.append({
            "category": c, "group": group_of(c),
            "avg_monthly": round(float(avg[c]), 2),
            "suggested_limit": round(float(np.ceil(limit / 5) * 5), 2),
            "change": round(-cuts.get(c, 0.0), 2),
            "spent_this_month": round(spent, 2),
            "remaining": round(float(limit - spent), 2),
            "status": "over" if spent > limit else "watch" if pace > 1.1 else "on_track",
        })

    # Safe to spend: what's left today after bills due before next payday and keeping the buffer.
    incomes = [e for e in fc.scheduled if e["kind"] == "income"]
    next_pay = pd.Timestamp(incomes[0]["date"]) if incomes else ctx.as_of + pd.Timedelta(days=30)
    days_to_pay = max(1, (next_pay - ctx.as_of).days)
    committed = -sum(e["amount"] for e in fc.scheduled if e["kind"] == "bill" and pd.Timestamp(e["date"]) < next_pay)
    free = ctx.balance - committed - ctx.buffer_target
    # Cap by what's left of this month's flexible budget, so a big balance doesn't mean "spend it all".
    flex_limit = sum(r["suggested_limit"] for r in rows if r["group"] == "discretionary")
    flex_spent = sum(r["spent_this_month"] for r in rows if r["group"] == "discretionary")
    days_left = max(1, ctx.as_of.days_in_month - ctx.as_of.day + 1)
    budget_daily = max(0.0, flex_limit - flex_spent) / days_left
    safe = {
        "today": round(max(0.0, min(free / days_to_pay, budget_daily)), 2),
        "max_without_overdraft_risk": round(max(0.0, free / days_to_pay), 2),
        "flexible_budget_left_this_month": round(max(0.0, flex_limit - flex_spent), 2),
        "until_payday": round(max(0.0, free), 2),
        "next_payday": next_pay.date().isoformat(),
        "days_to_payday": days_to_pay,
        "bills_before_payday": round(committed, 2),
        "buffer_kept": ctx.buffer_target,
    }

    # Subscriptions: regular (monthly or more often) discretionary payments, whatever their category.
    subs = [s.to_dict() for s in ctx.recurring
            if s.active and s.direction == "out" and s.period_days <= 31 and s.group == "discretionary"]
    return {
        "monthly_income": round(income, 2),
        "income_source": ctx.income_source,
        "target_savings_rate": round(target_rate, 3),
        "current_savings_rate": round(current_rate, 3),
        "why": why,
        "totals": {
            "essentials": round(essentials, 2),
            "discretionary_now": round(disc_total, 2),
            "discretionary_suggested": round(disc_total - sum(cuts.values()), 2),
            "savings_suggested": round(income * target_rate, 2),
            "split_now": _split(income, essentials, disc_total),
            "split_suggested": _split(income, essentials, disc_total - sum(cuts.values())),
        },
        "categories": rows,
        "safe_to_spend": safe,
        "subscriptions": {"items": subs, "monthly_total": round(sum(s["monthly_equivalent"] for s in subs), 2)},
    }


def _split(income: float, needs: float, wants: float) -> dict:
    if income <= 0:
        return {"needs": None, "wants": None, "savings": None}
    return {"needs": round(needs / income, 3), "wants": round(wants / income, 3),
            "savings": round(max(0.0, income - needs - wants) / income, 3)}

