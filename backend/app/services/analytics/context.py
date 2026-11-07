"""Builds the per-user analysis context shared by every insight (history frame, recurring series, balances)."""
import datetime as dt
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...models import Account, PausedSeries, PlannedExpense, Transaction, User
from ..categories import group_of, merchant_key
from .recurring import RecurringSeries, detect_recurring


@dataclass(frozen=True)
class GoalSnapshot:
    id: int
    name: str
    target_amount: float
    saved_amount: float
    target_date: dt.date | None


@dataclass(frozen=True)
class ProfileSnapshot:
    """Plain copy of the user's profile, safe to cache across requests (no DB session attached)."""
    id: int
    name: str
    income_type: str
    declared_monthly_income: float | None
    income_day: int | None
    housing: str | None
    household_size: int
    dependents: int
    current_balance: float | None
    savings_buffer_target: float | None
    challenges: list
    notes: str | None
    goals: tuple[GoalSnapshot, ...]
    address_as: str | None = None

    @classmethod
    def of(cls, u: User) -> "ProfileSnapshot":
        return cls(
            id=u.id, name=u.name, income_type=u.income_type, declared_monthly_income=u.declared_monthly_income,
            income_day=u.income_day, housing=u.housing, household_size=u.household_size or 1,
            dependents=u.dependents or 0, current_balance=u.current_balance, savings_buffer_target=u.savings_buffer_target,
            challenges=list(u.challenges or []), notes=u.notes,
            goals=tuple(GoalSnapshot(g.id, g.name, g.target_amount, g.saved_amount or 0.0, g.target_date) for g in u.goals),
            address_as=u.address_as,
        )


@dataclass
class UserContext:
    user: ProfileSnapshot
    df: pd.DataFrame  # all transactions
    flows: pd.DataFrame  # excluding transfers between own accounts
    as_of: pd.Timestamp  # last day of known data ("today" for the analysis)
    recurring: list[RecurringSeries]
    balance: float
    balance_source: str
    monthly_income: float
    income_source: str  # detected | declared | average | none
    essential_monthly: float
    buffer_target: float
    history_days: int
    cache: dict = field(default_factory=dict)
    # Standing decisions made in the app (paused subscriptions, planned one-offs). Applied to every forecast.
    standing: tuple = ()

    @property
    def has_data(self) -> bool:
        return not self.flows.empty


_CACHE: dict[tuple, UserContext] = {}


def invalidate(user_id: int) -> None:
    """Drop cached analysis for a user (call after edits the cache key can't see, e.g. re-categorising)."""
    for k in [k for k in _CACHE if k[0] == user_id]:
        del _CACHE[k]


def _load_frame(db: Session, user_id: int) -> pd.DataFrame:
    rows = db.execute(
        select(Transaction.id, Transaction.date, Transaction.description, Transaction.amount,
               Transaction.category, Transaction.is_transfer, Transaction.account_id)
        .where(Transaction.user_id == user_id)
    ).all()
    df = pd.DataFrame(rows, columns=["id", "date", "description", "amount", "category", "is_transfer", "account_id"])
    if df.empty:
        return df.assign(group=[], merchant=[])
    df["date"] = pd.to_datetime(df["date"])
    df["group"] = df["category"].map(group_of)
    df["merchant"] = df["description"].map(merchant_key)
    return df.sort_values(["date", "id"]).reset_index(drop=True)


def monthly_equivalent(series: RecurringSeries) -> float:
    return series.amount * 365.25 / 12 / series.period_days


def build_context(db: Session, user: User) -> UserContext:
    stats = db.execute(
        select(func.count(Transaction.id), func.max(Transaction.id), func.sum(Transaction.amount))
        .where(Transaction.user_id == user.id)
    ).one()
    paused = tuple(sorted(db.scalars(select(PausedSeries.series_id).where(PausedSeries.user_id == user.id)).all()))
    planned = tuple((p.id, p.date, p.description, p.amount) for p in
                    db.scalars(select(PlannedExpense).where(PlannedExpense.user_id == user.id).order_by(PlannedExpense.date)).all())
    key = (user.id, stats[0], stats[1], round(stats[2] or 0, 2), repr(ProfileSnapshot.of(user)), paused, planned,
           tuple((a.id, a.opening_balance) for a in user.accounts),
           tuple((g.id, g.target_amount, g.saved_amount, g.target_date) for g in user.goals))
    if key in _CACHE:
        return _CACHE[key]

    df = _load_frame(db, user.id)
    flows = df[~df["is_transfer"]].reset_index(drop=True) if not df.empty else df
    as_of = df["date"].max() if not df.empty else pd.Timestamp.today().normalize()
    recurring = detect_recurring(flows, as_of) if not flows.empty else []

    # Balance: user-stated balance wins, otherwise opening balances + all movements.
    opening = sum(a.opening_balance for a in user.accounts)
    if user.current_balance is not None:
        balance, balance_source = float(user.current_balance), "profile"
    else:
        balance, balance_source = float(opening + (df["amount"].sum() if not df.empty else 0)), "transactions"

    # Income: detected recurring income > declared in profile > average inflows.
    rec_income = sum(monthly_equivalent(s) for s in recurring if s.direction == "in" and s.active)
    if rec_income > 0:
        monthly_income, income_source = rec_income, "detected"
    elif user.declared_monthly_income:
        monthly_income, income_source = float(user.declared_monthly_income), "declared"
    else:
        recent = flows[(flows["amount"] > 0) & (flows["date"] > as_of - pd.Timedelta(days=180))] if not flows.empty else flows
        avg = float(recent["amount"].sum() / 6) if len(recent) else 0.0
        monthly_income, income_source = avg, "average" if avg else "none"

    history_days = int((as_of - df["date"].min()).days + 1) if not df.empty else 0
    if not flows.empty:
        window = flows[(flows["date"] > as_of - pd.Timedelta(days=180)) & (flows["amount"] < 0) & (flows["group"] == "essential")]
        months = max(1.0, min(180, history_days) / 30.44)
        essential_monthly = float(-window["amount"].sum() / months)
    else:
        essential_monthly = 0.0

    if user.savings_buffer_target is not None:
        buffer_target = float(user.savings_buffer_target)
    else:
        # Personalised default: irregular income / dependents need a bigger cushion.
        factor = 0.5 + (0.5 if user.income_type in ("irregular", "mixed") else 0) + 0.25 * min(user.dependents or 0, 2)
        buffer_target = float(np.round(max(200.0, essential_monthly * factor), -1))

    ctx = UserContext(
        user=ProfileSnapshot.of(user), df=df, flows=flows, as_of=as_of, recurring=recurring, balance=round(balance, 2),
        balance_source=balance_source, monthly_income=round(monthly_income, 2), income_source=income_source,
        essential_monthly=round(essential_monthly, 2), buffer_target=buffer_target, history_days=history_days,
        standing=tuple({"type": "cancel_recurring", "series_id": sid} for sid in paused)
        + tuple({"type": "one_off", "amount": amt, "date": d, "label": desc, "category": "Planned"} for _, d, desc, amt in planned),
    )
    if len(_CACHE) > 64:
        _CACHE.clear()
    _CACHE[key] = ctx
    return ctx


def accounts_summary(db: Session, user: User) -> list[dict]:
    out = []
    for a in user.accounts:
        total, n = db.execute(
            select(func.coalesce(func.sum(Transaction.amount), 0), func.count(Transaction.id)).where(Transaction.account_id == a.id)
        ).one()
        out.append({"id": a.id, "name": a.name, "kind": a.kind, "provider": a.provider,
                    "balance": round(a.opening_balance + total, 2), "transactions": n})
    return out


def account_exists(db: Session, user_id: int, name: str) -> Account | None:
    return db.scalar(select(Account).where(Account.user_id == user_id, Account.name == name))
