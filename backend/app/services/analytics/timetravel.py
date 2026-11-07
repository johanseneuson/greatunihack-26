"""'Future you': balance snapshots months ahead, goal timelines and what-if scenarios."""
import numpy as np
import pandas as pd

from ...config import settings
from ..categories import FLEXIBILITY
from .context import UserContext
from .forecast import Adjustment, ForecastResult, run_forecast


def _m(x: float) -> str:
    return f"{'-' if x < 0 else ''}{settings.currency_symbol}{abs(x):,.0f}"


def snapshots(ctx: UserContext, fc: ForecastResult, months=(1, 3, 6, 12)) -> list[dict]:
    out = []
    for m in months:
        target = ctx.as_of + pd.DateOffset(months=m)
        i = (target - fc.dates[0]).days
        if i >= len(fc.dates):
            continue
        snap = fc.snapshot(i)
        delta = snap["p50"] - ctx.balance
        snap.update({
            "months_ahead": m,
            "change_vs_today": round(delta, 2),
            "headline": (f"In {m} month{'s' if m > 1 else ''} you're likely to have {_m(snap['p50'])} "
                         + (f"- {_m(delta)} more than today." if delta >= 0 else f"- {_m(-delta)} less than today.")),
        })
        out.append(snap)
    return out


def goal_timelines(ctx: UserContext, fc: ForecastResult) -> list[dict]:
    """When does the median path free up enough money (above the buffer) to fund each goal?"""
    # Money is only really "free" on a day if the balance never needs it again later:
    # use the lowest future balance from each day onward (reverse running minimum).
    p50 = np.minimum.accumulate(fc.pct(50)[::-1])[::-1]
    p25 = np.minimum.accumulate(fc.pct(25)[::-1])[::-1]
    spare = p50 - ctx.buffer_target
    out = []
    cumulative = 0.0
    for g in sorted(ctx.user.goals, key=lambda g: (g.target_date or pd.Timestamp.max.date())):
        need = max(0.0, g.target_amount - g.saved_amount)
        cumulative += need
        hit = np.nonzero(spare >= cumulative)[0]
        likely = fc.dates[hit[0]].date() if len(hit) else None
        cautious_hit = np.nonzero(p25 - ctx.buffer_target >= cumulative)[0]
        on_time = None
        if g.target_date:
            on_time = bool(likely and likely <= g.target_date)
        months_left = max(1, ((pd.Timestamp(g.target_date) - ctx.as_of).days / 30.44)) if g.target_date else None
        out.append({
            "id": g.id, "name": g.name, "target_amount": g.target_amount, "saved_amount": g.saved_amount,
            "target_date": g.target_date.isoformat() if g.target_date else None,
            "likely_date": likely.isoformat() if likely else None,
            "cautious_date": fc.dates[cautious_hit[0]].date().isoformat() if len(cautious_hit) else None,
            "on_track": on_time,
            "monthly_needed": round(need / months_left, 2) if months_left else None,
            "message": (f"You could fund {g.name} today and still keep your safety buffer." if len(hit) and hit[0] == 0
                        else f"On track for {g.name} by {likely:%B %Y}." if likely and on_time is not False
                        else f"{g.name} is within reach by {likely:%B %Y} - a little later than planned." if likely
                        else f"{g.name} needs a boost - see the smart moves to get there."),
        })
    return out


def compare(ctx: UserContext, base: ForecastResult, alt: ForecastResult) -> dict:
    b, a = base.summary(), alt.summary()
    snaps_b = {s["months_ahead"]: s for s in snapshots(ctx, base)}
    snaps_a = {s["months_ahead"]: s for s in snapshots(ctx, alt)}
    return {
        "baseline": b, "scenario": a,
        "difference_at": {
            m: round(snaps_a[m]["p50"] - snaps_b[m]["p50"], 2) for m in snaps_b if m in snaps_a
        },
        "overdraft_risk_change_90d": round(a["prob_overdraft"].get("90d", 0) - b["prob_overdraft"].get("90d", 0), 3),
        "scenario_snapshots": list(snaps_a.values()),
        "scenario_monthly": alt.monthly(),
    }


def run_scenario(ctx: UserContext, base: ForecastResult, adjustments: list[Adjustment], sims: int) -> dict:
    # Same seed as the baseline: differences come from the adjustment, not from random noise.
    alt = run_forecast(ctx, len(base.dates), sims, adjustments, seed=ctx.user.id * 7919 + 17)
    return compare(ctx, base, alt)


def smart_moves(ctx: UserContext, base: ForecastResult, sims: int = 400, n: int = 3) -> list[dict]:
    """Auto-suggested positive scenarios: small, realistic cuts in the user's most flexible categories."""
    if not ctx.has_data:
        return []
    f = ctx.flows
    recent = f[(f["date"] > ctx.as_of - pd.Timedelta(days=90)) & (f["amount"] < 0) & (f["group"] == "discretionary")]
    monthly = (-recent.groupby("category")["amount"].sum() / 3).sort_values(ascending=False)
    candidates = [(c, v) for c, v in monthly.items() if v >= 30 and FLEXIBILITY.get(c, 0.5) >= 0.5][:n]
    H = len(base.dates)
    seed = ctx.user.id * 7919 + 17
    base_small = run_forecast(ctx, H, sims, seed=seed)
    b6 = base_small.snapshot(min(H - 1, 182))
    moves = []
    for c, v in candidates:
        pct = 20 if FLEXIBILITY.get(c, 0.5) >= 0.9 else 15
        alt = run_forecast(ctx, H, sims, [Adjustment(type="category", category=c, change_pct=-pct)], seed=seed)
        a6 = alt.snapshot(min(H - 1, 182))
        gain = a6["p50"] - b6["p50"]
        moves.append({
            "title": f"Trim {c} by {pct}%",
            "category": c, "change_pct": -pct,
            "monthly_saving": round(v * pct / 100, 2),
            "balance_gain_6m": round(gain, 2),
            "overdraft_risk_change_90d": round(alt.prob_below(0, 90) - base_small.prob_below(0, 90), 3),
            "message": f"Spend {_m(v * pct / 100)} less a month on {c} and future you has about {_m(gain)} more in 6 months.",
            "adjustment": {"type": "category", "category": c, "change_pct": -pct},
        })
    return sorted(moves, key=lambda m: -m["balance_gain_6m"])
