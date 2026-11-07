"""Financial time travel: Monte Carlo simulation of future daily balances.

Each simulated future is built from four parts:
  1. Scheduled recurring flows (salary, rent, bills, subscriptions) detected from history.
  2. Everyday spending: bootstrap-resampled historical days, matched by weekday, adjusted for
     the user's seasonality (e.g. December) and recent trend.
  3. Shocks (unexpected expenses): large one-off costs arrive as a Poisson process at the user's
     historical rate, with sizes resampled from their real past shocks.
  4. Scenario adjustments ("what if I cut eating out by 20%?", "holiday in March", "pay rise").
Running thousands of these gives percentile bands and probabilities (e.g. chance of overdraft).
"""
from dataclasses import dataclass
import datetime as dt

import numpy as np
import pandas as pd

from .context import UserContext


@dataclass
class Adjustment:
    type: str  # category | income | one_off | new_recurring | cancel_recurring
    category: str | None = None
    change_pct: float | None = None
    amount: float | None = None  # signed for one_off / new_recurring (negative = cost)
    date: dt.date | None = None
    day_of_month: int | None = None
    series_id: str | None = None
    label: str | None = None


@dataclass
class ForecastResult:
    dates: pd.DatetimeIndex
    start_balance: float
    balances: np.ndarray  # (S, H)
    outflows: np.ndarray  # (S, H) positive amounts
    inflows: np.ndarray  # (S, H)
    scheduled: list[dict]  # deterministic scheduled events (bills, income, one-offs)
    shock_rate_per_day: float
    shock_typical: float
    seasonal: dict[int, float]
    trend: float
    buffer_target: float

    def pct(self, q, arr=None):
        return np.percentile(self.balances if arr is None else arr, q, axis=0)

    def prob_below(self, threshold: float, days: int) -> float:
        days = min(days, self.balances.shape[1])
        return float((self.balances[:, :days].min(axis=1) < threshold).mean())

    def snapshot(self, day_index: int) -> dict:
        i = min(max(day_index, 0), len(self.dates) - 1)
        col = self.balances[:, i]
        return {
            "date": self.dates[i].date().isoformat(),
            "p10": round(float(np.percentile(col, 10)), 2),
            "p50": round(float(np.percentile(col, 50)), 2),
            "p90": round(float(np.percentile(col, 90)), 2),
            "prob_negative": round(float((col < 0).mean()), 3),
        }

    def summary(self) -> dict:
        p10, p50, p90 = self.pct(10), self.pct(50), self.pct(90)
        p_neg = (self.balances < 0).mean(axis=0)
        low = int(np.argmin(p50))
        risky = np.nonzero(p_neg >= 0.2)[0]
        H = len(self.dates)
        return {
            "start_balance": round(self.start_balance, 2),
            "horizon_days": H,
            "end": self.snapshot(H - 1),
            "lowest_point": {"date": self.dates[low].date().isoformat(), "p50": round(float(p50[low]), 2),
                             "p10": round(float(p10[low]), 2)},
            "prob_overdraft": {f"{d}d": round(self.prob_below(0, d), 3) for d in (30, 90, H) if d <= H},
            "prob_below_buffer": {f"{d}d": round(self.prob_below(self.buffer_target, d), 3) for d in (30, 90) if d <= H},
            "first_risk_date": self.dates[risky[0]].date().isoformat() if len(risky) else None,
            "expected_income": round(float(self.inflows.sum(axis=1).mean()), 2),
            "expected_spending": round(float(self.outflows.sum(axis=1).mean()), 2),
            "prob_unexpected_expense_90d": round(1 - float(np.exp(-self.shock_rate_per_day * min(90, H))), 3),
            "typical_unexpected_expense": round(self.shock_typical, 2),
            "buffer_target": self.buffer_target,
            "assumptions": {"seasonality": {k: round(v, 2) for k, v in self.seasonal.items()}, "trend": round(self.trend, 3)},
        }

    def daily(self, step: int = 1) -> list[dict]:
        p10, p50, p90 = self.pct(10), self.pct(50), self.pct(90)
        p_neg = (self.balances < 0).mean(axis=0)
        out_m, in_m = self.outflows.mean(axis=0), self.inflows.mean(axis=0)
        return [
            {"date": self.dates[i].date().isoformat(), "p10": round(float(p10[i]), 2), "p50": round(float(p50[i]), 2),
             "p90": round(float(p90[i]), 2), "prob_negative": round(float(p_neg[i]), 3),
             "expected_out": round(float(out_m[i]), 2), "expected_in": round(float(in_m[i]), 2)}
            for i in range(0, len(self.dates), step)
        ]

    def monthly(self) -> list[dict]:
        months = self.dates.to_period("M")
        out = []
        for m in months.unique():
            idx = np.nonzero(months == m)[0]
            last = idx[-1]
            out.append({
                "month": str(m), "days": len(idx),
                "expected_in": round(float(self.inflows[:, idx].sum(axis=1).mean()), 2),
                "expected_out": round(float(self.outflows[:, idx].sum(axis=1).mean()), 2),
                "end_balance_p10": round(float(np.percentile(self.balances[:, last], 10)), 2),
                "end_balance_p50": round(float(np.percentile(self.balances[:, last], 50)), 2),
                "end_balance_p90": round(float(np.percentile(self.balances[:, last], 90)), 2),
            })
        for m in out:
            m["expected_net"] = round(m["expected_in"] - m["expected_out"], 2)
        return out


def _seasonality(base_out: pd.DataFrame, as_of: pd.Timestamp) -> dict[int, float]:
    """Calendar-month spending factors relative to the user's average, shrunk when data is thin."""
    if base_out.empty:
        return {m: 1.0 for m in range(1, 13)}
    first = base_out["date"].min()
    monthly = base_out.groupby(base_out["date"].dt.to_period("M"))["amount"].sum().abs()
    # Only complete months
    monthly = monthly[(monthly.index > first.to_period("M")) & (monthly.index < as_of.to_period("M"))]
    if len(monthly) < 10:
        return {m: 1.0 for m in range(1, 13)}
    mean = monthly.mean()
    out = {}
    for m in range(1, 13):
        vals = monthly[monthly.index.month == m]
        if len(vals) == 0:
            out[m] = 1.0
            continue
        raw = vals.mean() / mean
        weight = min(1.0, len(vals) / 2) * 0.7  # shrink toward 1: single-year months are noisy
        out[m] = float(np.clip(1 + (raw - 1) * weight, 0.7, 1.6))
    return out


def _cat_multiplier(adjustments: list[Adjustment], category: str) -> float:
    m = 1.0
    for a in adjustments:
        if a.type == "category" and a.category == category and a.change_pct is not None:
            m *= max(0.0, 1 + a.change_pct / 100)
    return m


def run_forecast(
    ctx: UserContext,
    horizon_days: int = 180,
    sims: int = 1000,
    adjustments: list[Adjustment] | None = None,
    seed: int | None = None,
    timing_jitter: bool = True,
) -> ForecastResult:
    adjustments = [Adjustment(**a) for a in ctx.standing] + list(adjustments or [])  # standing app decisions + what-if changes
    rng = np.random.default_rng(seed if seed is not None else ctx.user.id * 7919 + 17)
    H, S = int(horizon_days), int(sims)
    start = ctx.as_of + pd.Timedelta(days=1)
    dates = pd.date_range(start, periods=H, freq="D")
    end = dates[-1]
    flows = ctx.flows

    outflows = np.zeros((S, H))
    inflows = np.zeros((S, H))
    scheduled: list[dict] = []

    # ---------- 1. recurring schedule ----------
    cancelled = {a.series_id for a in adjustments if a.type == "cancel_recurring"}
    income_mult = 1.0
    for a in adjustments:
        if a.type == "income" and a.change_pct is not None:
            income_mult *= max(0.0, 1 + a.change_pct / 100)

    recurring_ids: set[int] = set()
    have_recurring_income = False
    for s in ctx.recurring:
        recurring_ids.update(s.txn_ids)
        if not s.active or s.id in cancelled:
            continue
        mult = income_mult if s.direction == "in" else _cat_multiplier(adjustments, s.category)
        if s.direction == "in":
            have_recurring_income = True
        noise_sd = min(s.amount_cv, 0.25) * s.amount
        target = inflows if s.direction == "in" else outflows
        for d in s.schedule(start, end):
            i = (d - start).days
            amt = np.maximum(0, s.amount * mult + rng.normal(0, noise_sd, S)) if noise_sd else np.full(S, s.amount * mult)
            if s.timing_sd >= 0.5 and timing_jitter:  # bills don't always land on the exact day
                days = np.clip(i + np.clip(np.rint(rng.normal(0, s.timing_sd, S)), -3, 3).astype(int), 0, H - 1)
                np.add.at(target, (np.arange(S), days), amt)
            else:
                target[:, i] += amt
            scheduled.append({"date": d.date().isoformat(), "name": s.name, "category": s.category,
                              "amount": round(s.amount * mult * (1 if s.direction == "in" else -1), 2),
                              "kind": "income" if s.direction == "in" else "bill", "series_id": s.id,
                              "period_days": s.period_days})

    # Declared income (profile) when the data has no income stream of its own
    use_declared = not have_recurring_income and ctx.income_source == "declared"
    if use_declared:
        day = ctx.user.income_day or 28
        for m in pd.period_range(start, end, freq="M"):
            d = pd.Timestamp(year=m.year, month=m.month, day=min(day, m.days_in_month))
            if start <= d <= end:
                amt = ctx.monthly_income * income_mult
                inflows[:, (d - start).days] += amt
                scheduled.append({"date": d.date().isoformat(), "name": "Income (from profile)", "category": "Income",
                                  "amount": round(amt, 2), "kind": "income", "series_id": None, "period_days": 30.44})

    # ---------- 2 & 3. everyday spending + shocks ----------
    lookback_start = max(flows["date"].min(), ctx.as_of - pd.Timedelta(days=364)) if not flows.empty else ctx.as_of
    L = int((ctx.as_of - lookback_start).days) + 1
    window = flows[(flows["date"] >= lookback_start) & ~flows["id"].isin(recurring_ids)] if not flows.empty else flows
    out_w = window[window["amount"] < 0]
    in_w = window[window["amount"] > 0]
    if use_declared:
        in_w = in_w[in_w["amount"] < 200]  # large inflows are likely the income we already model from the profile

    abs_out = out_w["amount"].abs()
    shock_thr = max(150.0, float(abs_out.quantile(0.97))) if len(out_w) >= 30 else np.inf
    shocks = out_w[abs_out >= shock_thr]
    base = out_w[abs_out < shock_thr]

    seasonal = _seasonality(base, ctx.as_of)
    if L >= 14 and not base.empty:
        cats = sorted(set(base["category"]))
        cat_idx = {c: i for i, c in enumerate(cats)}
        M = np.zeros((L, len(cats)))
        np.add.at(M, ((base["date"] - lookback_start).dt.days.to_numpy(), base["category"].map(cat_idx).to_numpy()),
                  base["amount"].abs().to_numpy())
        mult = np.array([_cat_multiplier(adjustments, c) for c in cats])
        daily_out = M @ mult
        daily_in = np.zeros(L)
        np.add.at(daily_in, (in_w["date"] - lookback_start).dt.days.to_numpy(), in_w["amount"].to_numpy())

        hist_wd = (pd.date_range(lookback_start, periods=L).day_of_week).to_numpy()
        recent = daily_out[-90:].mean() if L >= 120 else daily_out.mean()
        overall = daily_out.mean()
        trend = float(np.clip(1 + ((recent / overall if overall else 1) - 1) * 0.5, 0.85, 1.2))
        # Seasonal factors are relative to the average month; the lookback is ~a year so it averages to 1.
        season_f = np.array([seasonal[d.month] for d in dates])

        idx = np.empty((S, H), dtype=int)
        fut_wd = dates.day_of_week.to_numpy()
        for wd in range(7):
            pool = np.nonzero(hist_wd == wd)[0]
            cols = np.nonzero(fut_wd == wd)[0]
            if len(pool) == 0 or len(cols) == 0:
                continue
            idx[:, cols] = rng.choice(pool, size=(S, len(cols)))
        outflows += daily_out[idx] * season_f[None, :] * trend
        inflows += daily_in[idx]
    else:
        trend = 1.0

    shock_rate = len(shocks) / L if L >= 30 else 0.0
    shock_typical = float(shocks["amount"].abs().median()) if len(shocks) else 0.0
    if shock_rate > 0:
        sizes = shocks["amount"].abs().to_numpy() * np.array([_cat_multiplier(adjustments, c) for c in shocks["category"]])
        counts = rng.poisson(shock_rate, size=(S, H))
        hit = np.nonzero(counts)
        outflows[hit] += rng.choice(sizes, size=len(hit[0])) * counts[hit]

    # ---------- 4. one-offs & new recurring ----------
    for a in adjustments:
        if a.type == "one_off" and a.amount and a.date:
            i = (pd.Timestamp(a.date) - start).days
            if 0 <= i < H:
                (inflows if a.amount > 0 else outflows)[:, i] += abs(a.amount)
                scheduled.append({"date": a.date.isoformat(), "name": a.label or "One-off", "category": a.category or "Other",
                                  "amount": a.amount, "kind": "one_off", "series_id": None, "period_days": None})
        elif a.type == "new_recurring" and a.amount:
            day = a.day_of_month or 1
            for m in pd.period_range(start, end, freq="M"):
                d = pd.Timestamp(year=m.year, month=m.month, day=min(day, m.days_in_month))
                if start <= d <= end:
                    (inflows if a.amount > 0 else outflows)[:, (d - start).days] += abs(a.amount)

    net = inflows - outflows
    balances = ctx.balance + np.cumsum(net, axis=1)
    scheduled.sort(key=lambda e: e["date"])
    return ForecastResult(
        dates=dates, start_balance=ctx.balance, balances=balances, outflows=outflows, inflows=inflows,
        scheduled=scheduled, shock_rate_per_day=shock_rate, shock_typical=shock_typical, seasonal=seasonal,
        trend=trend, buffer_target=ctx.buffer_target,
    )


def baseline_forecast(ctx: UserContext, horizon_days: int, sims: int) -> ForecastResult:
    key = ("forecast", horizon_days, sims)
    if key not in ctx.cache:
        ctx.cache[key] = run_forecast(ctx, horizon_days, sims)
    return ctx.cache[key]
