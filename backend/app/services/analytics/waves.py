"""Spending waves: periods where costs surge above the user's normal rhythm - in the past and forecast ahead.

Waves are measured on *variable* spending: everything except regular bills that recur monthly or more
often (rent, phone, subscriptions). Those are predictable rhythm, not waves. What remains - big
purchases, seasonal peaks, annual/quarterly bills, bursts of eating out - is what catches people out.
"""
import numpy as np
import pandas as pd

from .context import UserContext
from .forecast import ForecastResult

MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
FREQUENT_DAYS = 31.0  # recurring series with this period or shorter count as rhythm


def _variable_outflows(ctx: UserContext) -> pd.DataFrame:
    frequent = {i for s in ctx.recurring if s.direction == "out" and s.period_days <= FREQUENT_DAYS for i in s.txn_ids}
    out = ctx.flows[(ctx.flows["amount"] < 0) & ~ctx.flows["id"].isin(frequent)].copy()
    out["week"] = out["date"].dt.to_period("W-SUN").dt.start_time
    return out


def _weekly_history(ctx: UserContext) -> pd.DataFrame:
    out = _variable_outflows(ctx)
    weeks = pd.date_range(ctx.flows["date"].min().to_period("W-SUN").start_time,
                          ctx.as_of.to_period("W-SUN").start_time, freq="7D")
    total = out.groupby("week")["amount"].sum().abs().reindex(weeks, fill_value=0.0)
    by_cat = (out.pivot_table(index="week", columns="category", values="amount", aggfunc="sum").abs()
              .reindex(weeks, fill_value=0.0).fillna(0.0))
    return pd.DataFrame({"outflow": total}).join(by_cat)


def _merge_runs(flags: np.ndarray) -> list[tuple[int, int]]:
    runs, i = [], 0
    while i < len(flags):
        if flags[i]:
            j = i
            while j + 1 < len(flags) and flags[j + 1]:
                j += 1
            runs.append((i, j))
            i = j + 1
        else:
            i += 1
    return runs


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def detect_waves(ctx: UserContext, fc: ForecastResult, weeks_ahead: int = 53) -> dict:
    empty = {"measure": "variable_spending", "baseline_weekly": 0, "series": [], "past_waves": [], "upcoming_waves": [],
             "seasonal_peaks": []}
    if not ctx.has_data:
        return empty

    # ---------- past waves ----------
    wk = _weekly_history(ctx)
    cats = [c for c in wk.columns if c != "outflow"]
    outflow = wk["outflow"]
    # Trailing baseline: median of the previous 12 weeks (robust to the waves themselves)
    baseline = outflow.shift(1).rolling(12, min_periods=4).median().bfill()
    mad = (outflow - baseline).abs().shift(1).rolling(12, min_periods=4).median().bfill() * 1.4826
    excess = outflow - baseline
    flags = ((outflow > baseline * 1.3) & (excess > np.maximum(mad * 1.5, 50))).to_numpy(copy=True)
    flags[-1] = flags[-1] and ctx.as_of.weekday() >= 3  # partial current week: only if most of it has passed

    cat_median = wk[cats].rolling(12, min_periods=4).median().shift(1).bfill()
    past_waves = []
    for a, b in _merge_runs(flags):
        seg = wk.iloc[a:b + 1]
        drivers = (seg[cats] - cat_median.iloc[a:b + 1]).clip(lower=0).sum().sort_values(ascending=False)
        drivers = drivers[drivers > 0].head(3)
        past_waves.append({
            "start": seg.index[0].date().isoformat(),
            "end": (seg.index[-1] + pd.Timedelta(days=6)).date().isoformat(),
            "weeks": len(seg),
            "total_spent": round(float(seg["outflow"].sum()), 2),
            "excess_over_normal": round(float(excess.iloc[a:b + 1].sum()), 2),
            "peak_week": seg["outflow"].idxmax().date().isoformat(),
            "drivers": [{"category": c, "excess": round(float(v), 2)} for c, v in drivers.items()],
        })

    # ---------- forecast waves ----------
    # Each simulated week's *median* variable spend is compared with the simulation's own typical week
    # (median across the horizon). Trend affects every week equally, so what stands out is seasonality
    # and quarterly/annual bills. Medians keep rare huge shocks from creating phantom waves.
    start = fc.dates[0]
    week_ids = ((fc.dates - start).days // 7).to_numpy()
    n_weeks = int(week_ids.max()) + (1 if (week_ids == week_ids.max()).sum() == 7 else 0)
    sched = pd.DataFrame(fc.scheduled)
    weeks = []
    for w in range(n_weeks):
        cols = np.nonzero(week_ids == w)[0]
        w_start, w_end = fc.dates[cols[0]], fc.dates[cols[-1]]
        in_week = (sched[(sched["date"] >= w_start.date().isoformat()) & (sched["date"] <= w_end.date().isoformat())
                         & (sched["amount"] < 0)] if not sched.empty else sched)
        regular = in_week["period_days"].fillna(0).between(0.5, FREQUENT_DAYS) if len(in_week) else []
        frequent = float(-in_week[regular]["amount"].sum()) if len(in_week) else 0.0
        weekly_var = fc.outflows[:, cols].sum(axis=1) - frequent
        weeks.append((w_start, w_end, in_week, in_week[~regular] if len(in_week) else in_week, frequent,
                      float(np.median(weekly_var)), float(np.percentile(weekly_var, 90)),
                      float(np.percentile(weekly_var, 10))))
    normal_week = float(np.median([wk_[5] for wk_ in weeks])) if weeks else 0.0

    upcoming, fut_series = [], []
    for w_start, w_end, in_week, infrequent, frequent, med, p90, p10 in weeks[:weeks_ahead]:
        extra = med - normal_week
        season = fc.seasonal.get(w_start.month, 1.0)
        # Only forecast waves we can explain: a seasonal peak or a less frequent (quarterly/annual) bill.
        explained = season > 1.05 or len(infrequent) > 0
        is_wave = bool(normal_week and explained and extra > max(40.0, 0.12 * normal_week))
        paydays = ([e["date"] for e in fc.scheduled if e["kind"] == "income"
                    and w_start.date().isoformat() <= e["date"] <= w_end.date().isoformat()])
        fut_series.append({"week_start": w_start.date().isoformat(), "week_end": w_end.date().isoformat(),
                           "outflow": round(med, 2), "p10": round(p10, 2), "p90": round(p90, 2),
                           "payday": paydays[0] if paydays else None,
                           "bills": [{"date": b["date"], "name": b["name"], "amount": b["amount"]}
                                     for b in in_week.sort_values("date").to_dict("records")] if len(in_week) else [],
                           "baseline": round(normal_week, 2), "is_wave": is_wave, "kind": "forecast"})
        if not is_wave:
            continue
        reasons = []
        if season > 1.05:
            reasons.append(f"{MONTHS[w_start.month]} is usually {round((season - 1) * 100)}% above your average month")
        if len(infrequent):
            names = ", ".join(infrequent["name"].head(3))
            reasons.append(f"{_plural(len(infrequent), 'less frequent bill')} due ({names})")
        upcoming.append({
            "start": w_start.date().isoformat(), "end": w_end.date().isoformat(),
            "expected_spend": round(med + frequent, 2), "expected_variable_spend": round(med, 2),
            "high_estimate": round(p90 + frequent, 2), "excess_over_normal": round(extra, 2),
            "bills": in_week.sort_values("amount").head(5)[["date", "name", "amount"]].to_dict("records") if len(in_week) else [],
            "reasons": reasons,
        })

    merged: list[dict] = []
    for u in upcoming:
        if merged and (pd.Timestamp(u["start"]) - pd.Timestamp(merged[-1]["end"])).days <= 1:
            m = merged[-1]
            m["end"] = u["end"]
            for k in ("expected_spend", "expected_variable_spend", "high_estimate", "excess_over_normal"):
                m[k] = round(m[k] + u[k], 2)
            m["bills"] += u["bills"]
            m["reasons"] = list(dict.fromkeys(m["reasons"] + u["reasons"]))
        else:
            merged.append(u)

    # ---------- monthly outlook (12 months): the big seasonal waves ----------
    months = fc.dates.to_period("M")
    month_rows = []
    for m in months.unique():
        cols = np.nonzero(months == m)[0]
        if len(cols) < 25:
            continue  # skip partial months at the edges
        m_sched = sched[sched["date"].str.startswith(str(m)) & (sched["amount"] < 0)] if not sched.empty else sched
        reg = m_sched["period_days"].fillna(0).between(0.5, FREQUENT_DAYS) if len(m_sched) else []
        frequent = float(-m_sched[reg]["amount"].sum()) if len(m_sched) else 0.0
        var = fc.outflows[:, cols].sum(axis=1) - frequent
        month_rows.append((m, float(np.median(var)), float(np.percentile(var, 90)), frequent,
                           m_sched[~reg] if len(m_sched) else m_sched))
    normal_month = float(np.median([r[1] for r in month_rows])) if month_rows else 0.0
    monthly_outlook = []
    for m, med, p90, frequent, infrequent in month_rows:
        season = fc.seasonal.get(m.month, 1.0)
        extra = med - normal_month
        is_wave = bool(normal_month and (season > 1.05 or len(infrequent)) and extra > max(100.0, 0.08 * normal_month))
        reasons = []
        if season > 1.05:
            reasons.append(f"{MONTHS[m.month]} is usually {round((season - 1) * 100)}% above your average month")
        if len(infrequent):
            reasons.append(f"{_plural(len(infrequent), 'less frequent bill')} due ({', '.join(infrequent['name'].head(3))})")
        monthly_outlook.append({
            "month": str(m), "expected_variable_spend": round(med, 2), "high_estimate": round(p90, 2),
            "regular_bills": round(frequent, 2), "normal_variable_spend": round(normal_month, 2),
            "excess_over_normal": round(extra, 2), "is_wave": is_wave, "reasons": reasons if is_wave else [],
        })

    hist_series = [{"week_start": d.date().isoformat(), "outflow": round(float(o), 2), "baseline": round(float(b), 2),
                    "is_wave": bool(f), "kind": "history"}
                   for d, o, b, f in zip(wk.index[-52:], outflow.iloc[-52:], baseline.iloc[-52:], flags[-52:])]

    peaks = sorted(((m, f) for m, f in fc.seasonal.items() if f >= 1.1), key=lambda x: -x[1])
    return {
        "measure": "variable_spending",
        "measure_note": "Weekly spending excluding regular monthly bills (rent, phone, subscriptions).",
        "baseline_weekly": round(normal_week, 2),
        "series": hist_series + fut_series,
        "past_waves": past_waves[-10:][::-1],
        "upcoming_waves": merged,
        "monthly_outlook": monthly_outlook,
        "upcoming_wave_months": [m for m in monthly_outlook if m["is_wave"]],
        "seasonal_peaks": [{"month": MONTHS[m], "factor": round(f, 2), "above_average_pct": round((f - 1) * 100)}
                           for m, f in peaks],
    }
