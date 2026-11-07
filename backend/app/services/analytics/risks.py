"""Early warnings: anticipate hardship and unexpected costs before they happen.

Every warning pairs the risk with a concrete action and the positive outcome of taking it,
so the app nudges rather than scolds.
"""
import pandas as pd

from ...config import settings
from .context import UserContext
from .forecast import Adjustment, ForecastResult, run_forecast

SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2, "positive": 3}


def _m(x: float) -> str:
    return f"{settings.currency_symbol}{abs(x):,.0f}"


def _w(kind, severity, title, message, action=None, upside=None, **extra) -> dict:
    return {"kind": kind, "severity": severity, "title": title, "message": message, "action": action, "upside": upside, **extra}


def build_warnings(ctx: UserContext, fc: ForecastResult, waves: dict, budget: dict) -> list[dict]:
    if not ctx.has_data:
        return [_w("no_data", "info", "Add your first statement",
                   "Upload a CSV or link a bank to see your financial future.", "Upload transactions")]
    out: list[dict] = []
    s = fc.summary()
    p10 = fc.pct(10)

    # 1. Overdraft / hardship risk
    p30 = s["prob_overdraft"].get("30d", 0)
    p90 = s["prob_overdraft"].get("90d", p30)
    if p90 >= 0.1:
        idx = next((i for i, v in enumerate((fc.balances < 0).mean(axis=0)) if v >= 0.1), 0)
        when = fc.dates[idx].date()
        shortfall_30 = max(0.0, -float(p10[: min(30, len(p10))].min()))
        sev = "critical" if p30 >= 0.3 else "warning"
        # What does following the personalised budget do to this risk? Simulate it.
        cuts = [Adjustment(type="category", category=c["category"], change_pct=c["change"] / c["avg_monthly"] * 100)
                for c in budget.get("categories", []) if c["change"] < 0 and c["avg_monthly"] > 0]
        with_budget = None
        if cuts:
            alt = run_forecast(ctx, len(fc.dates), 400, cuts, seed=ctx.user.id * 7919 + 17)
            with_budget = round(alt.prob_below(0, 90), 3)
        trim = budget["totals"]["discretionary_now"] - budget["totals"]["discretionary_suggested"] if cuts else 0
        if with_budget is not None and with_budget < p90:
            action = (f"Following your suggested budget (about {_m(trim)} less flexible spending a month) "
                      f"cuts this risk from {round(p90 * 100)}% to {round(with_budget * 100)}%.")
        elif shortfall_30 and shortfall_30 < max(ctx.monthly_income, 1) * 0.5:
            action = f"Keeping {_m(shortfall_30)} spare over the next month covers even a bad month."
        else:
            action = "Pause non-essential spending until payday and talk to your bank early about an overdraft buffer."
        out.append(_w(
            "overdraft_risk", sev, f"Possible dip below zero around {when:%d %b}",
            f"In {round(p90 * 100)}% of your simulated futures your balance goes negative within 90 days "
            f"(earliest real risk from {when:%d %b}).",
            action,
            "Avoiding one overdraft typically saves £20-£40 in fees and keeps your credit score healthy.",
            probability=round(p90, 3), probability_with_budget=with_budget, date=when.isoformat(),
            amount=round(shortfall_30, 2),
        ))

    # 2. Buffer erosion
    p50 = fc.pct(50)
    below = [i for i, v in enumerate(p50[:90]) if v < ctx.buffer_target]
    if below and p90 < 0.1:
        when = fc.dates[below[0]].date()
        out.append(_w(
            "low_buffer", "warning", f"Cushion running thin from {when:%d %b}",
            f"Your expected balance drops under your {_m(ctx.buffer_target)} safety buffer.",
            "Pausing one non-essential purchase that week keeps you above it.",
            "Staying above your buffer means surprises don't turn into stress.",
            date=when.isoformat(), amount=round(ctx.buffer_target - float(p50[below[0]]), 2),
        ))

    # 3. Upcoming spending waves
    for wave in waves.get("upcoming_waves", [])[:3]:
        start = pd.Timestamp(wave["start"]).date()
        out.append(_w(
            "spending_wave", "warning" if wave["excess_over_normal"] > ctx.monthly_income * 0.1 else "info",
            f"Spending wave ahead: week of {start:%d %b}",
            f"Expect about {_m(wave['expected_spend'])} out - {_m(wave['excess_over_normal'])} more than a normal week. "
            + "; ".join(wave["reasons"]) + ".",
            f"Put {_m(wave['excess_over_normal'])} aside now so the wave doesn't hit your everyday money.",
            "Riding out the wave calmly keeps the rest of your month on plan.",
            date=wave["start"], amount=wave["excess_over_normal"],
        ))

    # 3b. Heavy months ahead (seasonal waves over the next year)
    for m in waves.get("upcoming_wave_months", [])[:2]:
        label = pd.Period(m["month"]).strftime("%B %Y")
        out.append(_w(
            "wave_month", "info", f"{label} looks like a heavier month",
            f"Expect about {_m(m['excess_over_normal'])} more flexible spending than a typical month. "
            + "; ".join(m["reasons"]) + ".",
            f"Setting aside {_m(m['excess_over_normal'] / max(1, (pd.Period(m['month']) - ctx.as_of.to_period('M')).n))} "
            "a month from now spreads the cost.",
            "Planned for, a heavy month is just another month.",
            date=m["month"], amount=m["excess_over_normal"],
        ))

    # 4. Bill clusters in the next 30 days
    horizon = ctx.as_of + pd.Timedelta(days=30)
    bills = [e for e in fc.scheduled if e["kind"] == "bill" and pd.Timestamp(e["date"]) <= horizon]
    for i, b in enumerate(bills):
        start = pd.Timestamp(b["date"])
        group = [x for x in bills[i:] if pd.Timestamp(x["date"]) <= start + pd.Timedelta(days=6)]
        total = -sum(x["amount"] for x in group)
        if len(group) >= 3 and ctx.monthly_income and total > 0.35 * ctx.monthly_income:
            out.append(_w(
                "bill_cluster", "info", f"{len(group)} bills land within a week of {start:%d %b}",
                f"{', '.join(x['name'] for x in group[:4])} add up to {_m(total)}.",
                "Ask providers to move one due date closer to payday.",
                "Spreading bills evens out your month.",
                date=start.date().isoformat(), amount=round(total, 2),
            ))
            break

    # 5. Category creep (last 90 days vs the 90 before)
    f = ctx.flows
    cur = f[(f["date"] > ctx.as_of - pd.Timedelta(days=90)) & (f["amount"] < 0) & (f["group"] == "discretionary")]
    prev = f[(f["date"] <= ctx.as_of - pd.Timedelta(days=90)) & (f["date"] > ctx.as_of - pd.Timedelta(days=180))
             & (f["amount"] < 0) & (f["group"] == "discretionary")]
    if ctx.history_days >= 150:
        c_tot = -cur.groupby("category")["amount"].sum() / 3
        p_tot = -prev.groupby("category")["amount"].sum() / 3
        creep = [(c, c_tot[c], p_tot.get(c, 0)) for c in c_tot.index if p_tot.get(c, 0) > 0
                 and c_tot[c] > p_tot.get(c, 0) * 1.25 and c_tot[c] - p_tot.get(c, 0) > 40]
        for c, now_v, before in sorted(creep, key=lambda x: -(x[1] - x[2]))[:2]:
            yearly = (now_v - before) * 12
            out.append(_w(
                "category_creep", "info", f"{c} is creeping up",
                f"You're averaging {_m(now_v)}/month on {c}, up from {_m(before)} ({round((now_v / before - 1) * 100)}%).",
                f"Bringing it back to {_m(before)} a month.",
                f"That's {_m(yearly)} a year back in your pocket.",
                category=c, amount=round(now_v - before, 2),
            ))

    # 6. Income drop (only when income is visible in the data)
    if ctx.income_source == "detected":
        inc = f[(f["category"] == "Income") & (f["amount"] > 0)]
        last30 = inc[inc["date"] > ctx.as_of - pd.Timedelta(days=30)]["amount"].sum()
        prior = inc[(inc["date"] <= ctx.as_of - pd.Timedelta(days=30)) & (inc["date"] > ctx.as_of - pd.Timedelta(days=210))]["amount"].sum() / 6
        if prior > 0 and last30 < 0.75 * prior:
            out.append(_w(
                "income_drop", "warning", "Income lower than usual",
                f"You received {_m(last30)} in the last 30 days vs a usual {_m(prior)}.",
                "If this is a timing quirk, no action needed; otherwise update your profile so forecasts adjust.",
                None, amount=round(prior - last30, 2),
            ))

    # 7. Spending more than earning
    if ctx.monthly_income > 0 and budget.get("current_savings_rate", 0) < 0:
        gap = -budget["current_savings_rate"] * ctx.monthly_income
        out.append(_w(
            "negative_cashflow", "warning", "Spending a little more than you earn",
            f"On average you're {_m(gap)} a month over your income.",
            f"The suggested budget closes the gap and starts you saving by trimming {_m(budget['totals']['discretionary_now'] - budget['totals']['discretionary_suggested'])} of flexible spending.",
            "Closing it turns your balance line from down to up.",
            amount=round(gap, 2),
        ))

    # 8. Unexpected-expense readiness
    if s["typical_unexpected_expense"] > 0:
        prob = s["prob_unexpected_expense_90d"]
        typical = s["typical_unexpected_expense"]
        low_point = float(fc.pct(50)[: min(90, len(fc.dates))].min())
        covered = low_point - ctx.buffer_target >= typical
        out.append(_w(
            "unexpected_expense", "positive" if covered else "warning",
            "You're ready for a surprise cost" if covered else "A surprise cost could sting",
            f"Based on your history there's a {round(prob * 100)}% chance of an unplanned cost around {_m(typical)} in the next 3 months.",
            None if covered else f"Building a {_m(typical)} 'surprise pot' takes about {_m(typical / 3)} a month for 3 months.",
            "You can absorb it without touching your buffer." if covered else "Then a surprise is an inconvenience, not a crisis.",
            probability=prob, amount=typical,
        ))

    # 9. Subscriptions
    subs = budget.get("subscriptions", {})
    if subs.get("items"):
        n = len(subs["items"])
        out.append(_w(
            "subscriptions", "info", f"{n} subscription{'s' if n > 1 else ''}, {_m(subs['monthly_total'])}/month",
            ", ".join(f"{x['name']} ({_m(x['amount'])})" for x in subs["items"][:5]) + ".",
            "Quick audit: keep the ones you used this month.",
            f"Cancelling one of them saves up to {_m(max(x['monthly_equivalent'] for x in subs['items']) * 12)} a year.",
            amount=subs["monthly_total"],
        ))

    # 10. Positive momentum
    end = s["end"]["p50"]
    if end > ctx.balance:
        out.append(_w(
            "on_track", "positive", "Your future self is better off",
            f"On your current path you'll likely have {_m(end)} by {pd.Timestamp(s['end']['date']):%B %Y} - "
            f"{_m(end - ctx.balance)} more than today.",
            None, "Keep it up - small consistent wins compound.",
            amount=round(end - ctx.balance, 2),
        ))

    for i, w in enumerate(sorted(out, key=lambda w: SEVERITY_ORDER[w["severity"]])):
        w["id"] = f"{w['kind']}-{i}"
    return sorted(out, key=lambda w: SEVERITY_ORDER[w["severity"]])
