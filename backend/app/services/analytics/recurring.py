"""Detect recurring payments and income (salary, rent, bills, subscriptions) from transaction history."""
import hashlib
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

PERIODS = [  # name, days, tolerance
    ("weekly", 7.0, 2.0),
    ("fortnightly", 14.0, 3.0),
    ("monthly", 30.44, 5.0),
    ("bi-monthly", 61.0, 8.0),
    ("quarterly", 91.3, 12.0),
    ("yearly", 365.25, 25.0),
]


@dataclass
class RecurringSeries:
    id: str
    name: str
    merchant: str
    category: str
    group: str
    direction: str  # "in" | "out"
    period: str
    period_days: float
    amount: float  # typical absolute amount
    amount_cv: float
    occurrences: int
    last_date: pd.Timestamp
    next_date: pd.Timestamp
    active: bool
    confidence: float
    txn_ids: list[int] = field(default_factory=list, repr=False)
    # Calendar anchoring: monthly-type bills are paid on a day of the month, not every 30.44 days.
    day_of_month: int | None = None
    months_step: int = 0  # 1 monthly, 2 bi-monthly, 3 quarterly, 12 yearly; 0 = fixed-interval series
    avoid_weekends: bool = False  # history never lands on a weekend -> roll to Monday, like UK direct debits
    timing_sd: float = 0.0  # how many days the payment typically moves around its expected date

    def _calendar_dates(self, after: pd.Timestamp, end: pd.Timestamp) -> list[pd.Timestamp]:
        out = []
        m = self.last_date.to_period("M")
        while True:
            m += self.months_step
            d = pd.Timestamp(year=m.year, month=m.month, day=min(self.day_of_month, m.days_in_month))
            if self.avoid_weekends and d.weekday() >= 5:
                d += pd.Timedelta(days=7 - d.weekday())
            if d > end:
                return out
            if d > after:
                out.append(d)

    def schedule(self, start: pd.Timestamp, end: pd.Timestamp) -> list[pd.Timestamp]:
        if self.months_step and self.day_of_month:
            return [d for d in self._calendar_dates(self.last_date, end) if d >= start]
        out, i = [], 0
        while (d := self.next_date + pd.Timedelta(days=round(self.period_days * i))) <= end:
            if d >= start:
                out.append(d)
            i += 1
        return out

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "category": self.category, "group": self.group,
            "direction": self.direction, "period": self.period, "amount": round(self.amount, 2),
            "monthly_equivalent": round(self.amount * 365.25 / 12 / self.period_days, 2),
            "occurrences": self.occurrences, "last_date": self.last_date.date().isoformat(),
            "next_date": self.next_date.date().isoformat(), "active": self.active,
            "confidence": round(self.confidence, 2),
        }


MONTHS_STEP = {"monthly": 1, "bi-monthly": 2, "quarterly": 3, "yearly": 12}


def _anchor(dates: pd.Series, period_name: str, period: float, intervals: np.ndarray) -> tuple[int | None, int, bool, float]:
    """Day-of-month anchor, months step, weekend avoidance and timing spread for a series."""
    avoid_weekends = len(dates) >= 4 and float((dates.dt.day_of_week >= 5).mean()) == 0.0
    step = MONTHS_STEP.get(period_name, 0)
    if step:
        doms = dates.dt.day.to_numpy()
        dom = int(pd.Series(doms).mode().iat[0])
        # Distance to the anchor day, treating month ends (28th-31st) as the same day
        dist = np.minimum(np.abs(doms - dom), np.where((doms >= 28) & (dom >= 28), 0, 99))
        if np.mean(dist <= 3) >= 0.6:
            spread = float(np.clip(np.std(np.where(dist <= 3, doms - dom, 0)), 0, 3))
            return dom, step, avoid_weekends, spread
    return None, 0, avoid_weekends, float(np.clip(np.std(intervals - period), 0, 3)) if len(intervals) else 0.0


def detect_recurring(flows: pd.DataFrame, as_of: pd.Timestamp, anchor: bool = True) -> list[RecurringSeries]:
    series: list[RecurringSeries] = []
    if flows.empty:
        return series
    flows = flows.assign(direction=np.where(flows["amount"] > 0, "in", "out"))
    for (merchant, direction), g in flows.groupby(["merchant", "direction"], sort=False):
        if len(g) < 2:
            continue
        # One payment per day per merchant (merge splits)
        daily = g.groupby("date").agg(amount=("amount", "sum"), ids=("id", list)).reset_index()
        if len(daily) < 2:
            continue
        dates = daily["date"]
        intervals = dates.diff().dt.days.dropna().to_numpy()
        med = float(np.median(intervals))
        match = next(((n, p, t) for n, p, t in PERIODS if abs(med - p) <= t), None)
        if match is None:
            continue
        name, period, tol = match
        min_occ = 2 if period > 300 else 3
        if len(daily) < min_occ:
            continue
        regular = float(np.mean(np.abs(intervals - period) <= tol * 1.5))
        if regular < 0.6:
            continue
        amounts = daily["amount"].abs().to_numpy()
        cv = float(np.std(amounts) / np.mean(amounts)) if np.mean(amounts) else 1.0
        category = g["category"].mode().iat[0]
        group = g["group"].mode().iat[0]
        max_cv = 0.6 if group == "essential" or direction == "in" else 0.35
        if cv > max_cv:
            continue
        # Frequent everyday spending (e.g. coffee most days) is a habit, not a bill.
        if period <= 14 and direction == "out" and group != "essential" and np.mean(amounts) < 15:
            continue

        last = dates.iat[-1]
        active = (as_of - last).days <= period * 1.75 + tol
        nxt = last + pd.Timedelta(days=round(period))
        k = 1
        while nxt <= as_of:
            k += 1
            nxt = last + pd.Timedelta(days=round(period * k))
        dom, step, avoid_weekends, timing_sd = _anchor(dates, name, period, intervals) if anchor else (None, 0, False, 0.0)
        typical = float(np.median(amounts[-3:]))
        s = RecurringSeries(
            id=f"{direction}-{hashlib.sha1(merchant.encode()).hexdigest()[:8]}",
            name=g["description"].mode().iat[0], merchant=merchant, category=category, group=group,
            direction=direction, period=name, period_days=period, amount=typical, amount_cv=cv,
            occurrences=len(daily), last_date=last, next_date=nxt, active=active,
            confidence=regular * (1 - min(cv, 1.0)),
            txn_ids=[i for ids in daily["ids"] for i in ids],
            day_of_month=dom, months_step=step, avoid_weekends=avoid_weekends, timing_sd=timing_sd,
        )
        if step and dom:
            upcoming = s._calendar_dates(as_of, as_of + pd.Timedelta(days=400))
            if upcoming:
                s.next_date = upcoming[0]
        series.append(s)
    series.sort(key=lambda s: (not s.active, s.direction, -s.amount))
    return series
