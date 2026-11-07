"""Understand the past: cash flow, category breakdowns, trends and a financial resilience score."""
import numpy as np
import pandas as pd

from .context import UserContext


def monthly_cashflow(ctx: UserContext, months: int = 12) -> list[dict]:
    if not ctx.has_data:
        return []
    f = ctx.flows.assign(month=ctx.flows["date"].dt.to_period("M"))
    out = []
    for m, g in f.groupby("month"):
        spend = g[g["amount"] < 0]
        income = g[(g["amount"] > 0) & (g["category"] == "Income")]["amount"].sum()
        refunds = g[(g["amount"] > 0) & (g["category"] != "Income")]["amount"].sum()
        total_spend = -spend["amount"].sum() - refunds
        out.append({
            "month": str(m),
            "income": round(float(income), 2),
            "spending": round(float(total_spend), 2),
            "essential": round(float(-spend[spend["group"] == "essential"]["amount"].sum()), 2),
            "discretionary": round(float(-spend[spend["group"] == "discretionary"]["amount"].sum()), 2),
            "net": round(float(income - total_spend), 2),
            "partial": bool(m == ctx.as_of.to_period("M")),
        })
    return out[-months:]


def category_breakdown(ctx: UserContext, days: int = 90) -> list[dict]:
    if not ctx.has_data:
        return []
    now = ctx.as_of
    cur = ctx.flows[(ctx.flows["date"] > now - pd.Timedelta(days=days)) & (ctx.flows["category"] != "Income")]
    prev = ctx.flows[(ctx.flows["date"] <= now - pd.Timedelta(days=days)) & (ctx.flows["date"] > now - pd.Timedelta(days=2 * days))
                     & (ctx.flows["category"] != "Income")]
    cur_t = -cur.groupby("category")["amount"].sum()
    prev_t = -prev.groupby("category")["amount"].sum()
    total = cur_t[cur_t > 0].sum()
    rows = []
    for c, v in cur_t.sort_values(ascending=False).items():
        if v <= 0:
            continue
        p = float(prev_t.get(c, 0.0))
        rows.append({
            "category": c,
            "group": cur[cur["category"] == c]["group"].iat[0],
            "amount": round(float(v), 2),
            "monthly_avg": round(float(v) / (days / 30.44), 2),
            "share": round(float(v / total), 3) if total else 0,
            "change_vs_previous_pct": round((v - p) / p * 100, 1) if p > 0 else None,
            "transactions": int((cur["category"] == c).sum()),
        })
    return rows


def top_merchants(ctx: UserContext, days: int = 90, n: int = 8) -> list[dict]:
    if not ctx.has_data:
        return []
    cur = ctx.flows[(ctx.flows["date"] > ctx.as_of - pd.Timedelta(days=days)) & (ctx.flows["amount"] < 0)]
    g = cur.groupby("merchant").agg(name=("description", lambda s: s.mode().iat[0]), total=("amount", "sum"),
                                    count=("amount", "size"), category=("category", lambda s: s.mode().iat[0]))
    g["total"] = -g["total"]
    return [{"name": r.name, "category": r.category, "total": round(float(r.total), 2), "count": int(r.count)}
            for r in g.sort_values("total", ascending=False).head(n).itertuples()]


def avg_monthly_spend(ctx: UserContext, days: int = 180) -> float:
    if not ctx.has_data:
        return 0.0
    w = ctx.flows[(ctx.flows["date"] > ctx.as_of - pd.Timedelta(days=days)) & (ctx.flows["category"] != "Income")]
    months = max(1.0, min(days, ctx.history_days) / 30.44)
    return float(-w["amount"].sum() / months)


def resilience_score(ctx: UserContext, summary: dict) -> dict:
    """0-100 score of how well the user can absorb shocks. Shown positively: what lifts it next."""
    spend = avg_monthly_spend(ctx)
    income = ctx.monthly_income
    savings_rate = (income - spend) / income if income > 0 else -1.0
    runway_months = ctx.balance / ctx.essential_monthly if ctx.essential_monthly > 0 else 6.0
    p_od = summary["prob_overdraft"].get("90d", 0.0)

    monthly = ctx.flows[ctx.flows["category"] != "Income"].groupby(ctx.flows["date"].dt.to_period("M"))["amount"].sum().abs() \
        if ctx.has_data else pd.Series(dtype=float)
    monthly = monthly.iloc[1:-1] if len(monthly) > 3 else monthly
    volatility = float(monthly.std() / monthly.mean()) if len(monthly) > 2 and monthly.mean() else 0.3

    parts = {
        "overdraft_safety": (1 - p_od) * 30,
        "emergency_fund": float(np.clip(runway_months / 3, 0, 1)) * 25,
        "savings_rate": float(np.clip(savings_rate / 0.2, 0, 1)) * 20,
        "income_stability": (15.0 if ctx.income_source == "detected" else 10.0 if ctx.income_source == "declared" else 5.0)
        * (0.7 if ctx.user.income_type in ("irregular", "mixed") else 1.0),
        "spending_steadiness": float(np.clip(1 - volatility, 0, 1)) * 10,
    }
    score = round(sum(parts.values()))
    label = "Thriving" if score >= 80 else "Steady" if score >= 60 else "Stretched" if score >= 40 else "At risk"
    weakest = min(parts, key=lambda k: parts[k] / {"overdraft_safety": 30, "emergency_fund": 25, "savings_rate": 20,
                                                     "income_stability": 15, "spending_steadiness": 10}[k])
    tips = {
        "overdraft_safety": "Smoothing out your next spending wave is the quickest win.",
        "emergency_fund": f"Building your cushion towards {round(ctx.essential_monthly * 3):,} (3 months of essentials) lifts this most.",
        "savings_rate": "Saving even 5% more of each payday moves this score fastest.",
        "income_stability": "Adding your income details to your profile makes forecasts sharper.",
        "spending_steadiness": "Spreading big purchases across months keeps your cash flow calmer.",
    }
    return {
        "score": score, "label": label,
        "components": {k: round(v, 1) for k, v in parts.items()},
        "savings_rate": round(savings_rate, 3),
        "emergency_fund_months": round(runway_months, 1),
        "spending_volatility": round(volatility, 2),
        "next_best_step": tips[weakest],
    }
