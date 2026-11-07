"""Backtest: how good is the forecast for *this* user?

Hide the most recent weeks, forecast them from the older history only, and compare with what actually
happened. Gives an honest accuracy figure for the UI and lets us check that model changes really help.
"""
import dataclasses

import numpy as np
import pandas as pd

from .context import UserContext
from .forecast import run_forecast
from .recurring import detect_recurring


def _weekly_actual(flows: pd.DataFrame, start: pd.Timestamp, weeks: int) -> np.ndarray:
    out = flows[(flows["amount"] < 0) & (flows["date"] >= start) & (flows["date"] < start + pd.Timedelta(weeks=weeks))]
    wk = ((out["date"] - start).dt.days // 7).to_numpy()
    actual = np.zeros(weeks)
    np.add.at(actual, wk, out["amount"].abs().to_numpy())
    return actual


def backtest(ctx: UserContext, weeks: int = 12, sims: int = 500) -> dict | None:
    if not ctx.has_data or ctx.history_days < 7 * weeks + 120:
        return None  # need enough history both to train on and to test against
    cutoff = ctx.as_of - pd.Timedelta(weeks=weeks)
    past = ctx.flows[ctx.flows["date"] <= cutoff].reset_index(drop=True)
    train = dataclasses.replace(
        ctx, df=ctx.df[ctx.df["date"] <= cutoff], flows=past, as_of=cutoff,
        recurring=detect_recurring(past, cutoff), cache={}, standing=(),
        history_days=int((cutoff - past["date"].min()).days + 1),
    )
    fc = run_forecast(train, weeks * 7, sims, seed=ctx.user.id * 7919 + 17)
    start = fc.dates[0]
    weekly_sims = fc.outflows.reshape(sims, weeks, 7).sum(axis=2)
    pred = np.median(weekly_sims, axis=0)
    lo, hi = np.percentile(weekly_sims, 10, axis=0), np.percentile(weekly_sims, 90, axis=0)
    actual = _weekly_actual(ctx.flows, start, weeks)

    # Naive benchmark: "next week = your average week over the last year"
    hist = past[(past["amount"] < 0) & (past["date"] > cutoff - pd.Timedelta(days=364))]
    naive = float(hist["amount"].abs().sum() / (min(364, train.history_days) / 7))

    mae = float(np.mean(np.abs(actual - pred)))
    naive_mae = float(np.mean(np.abs(actual - naive)))
    return {
        "weeks": weeks,
        "from": start.date().isoformat(),
        "to": fc.dates[-1].date().isoformat(),
        "mae_weekly": round(mae, 2),
        "naive_mae_weekly": round(naive_mae, 2),
        "improvement_vs_naive_pct": round((1 - mae / naive_mae) * 100, 1) if naive_mae else None,
        "coverage_80": round(float(np.mean((actual >= lo) & (actual <= hi))), 3),
        "weekly": [
            {"week_start": (start + pd.Timedelta(weeks=i)).date().isoformat(), "actual": round(float(a), 2),
             "forecast": round(float(p), 2), "p10": round(float(l), 2), "p90": round(float(h), 2)}
            for i, (a, p, l, h) in enumerate(zip(actual, pred, lo, hi))
        ],
    }
