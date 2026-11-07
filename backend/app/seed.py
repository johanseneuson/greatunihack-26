"""Demo users backed by the Kaggle datasets. Run automatically on first start (or: python -m app.seed)."""
import logging
from datetime import date, timedelta

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import SessionLocal, init_db
from .models import Account, Goal, Transaction, User
from .services.connectors import CONNECTORS
from .services.ingest import import_rows

log = logging.getLogger(__name__)

DEMO_USERS = [
    {
        "connector": "sandbox:personal-finance",
        "user": dict(
            name="Alex Morgan", email="alex@demo.financebuddy", income_type="salary", housing="mortgage",
            household_size=2, dependents=0, challenges=["home_renovation"],
            notes="Homeowner paid fortnightly, uses two credit cards for daily spending. "
                  "Doing up the house in bursts, which causes big spending spikes.",
        ),
        "min_balance": 900.0,  # opening balance chosen so the history never went overdrawn
        "goals": [("Kitchen refresh", 6000, 240), ("Summer holiday", 2500, 300)],
    },
    {
        "connector": "sandbox:personal-budget-transactions-dataset",
        "user": dict(
            name="Jordan Lee", email="jordan@demo.financebuddy", income_type="salary", housing="family",
            household_size=3, dependents=0, declared_monthly_income=3000.0, income_day=25, current_balance=2100.0,
            challenges=["first_job", "saving_for_deposit", "irregular_spending"],
            notes="First full-time job, lives with family and wants to move out within a year. "
                  "Coffee, lunches with colleagues and taxis add up; occasional big trips.",
        ),
        "goals": [("Rental deposit", 1800, 180), ("Emergency fund", 1000, 120)],
    },
]


def seed(db: Session) -> list[int]:
    created = []
    for spec in DEMO_USERS:
        if db.scalar(select(User).where(User.email == spec["user"]["email"])):
            continue
        user = User(**spec["user"])
        db.add(user)
        db.flush()
        conn = CONNECTORS[spec["connector"]]
        rows, shift = conn.fetch()
        import_rows(db, user, rows, source=conn.id, provider=conn.id, date_shift_days=shift)

        if "min_balance" in spec:
            daily = db.execute(
                select(Transaction.date, func.sum(Transaction.amount)).where(Transaction.user_id == user.id)
                .group_by(Transaction.date).order_by(Transaction.date)
            ).all()
            low = float(pd.Series([a for _, a in daily]).cumsum().min())
            main = db.scalar(select(Account).where(Account.user_id == user.id, Account.kind == "current"))
            if main is not None:
                main.opening_balance = round(max(0.0, spec["min_balance"] - low), 2)

        for name, amount, days in spec["goals"]:
            db.add(Goal(user_id=user.id, name=name, target_amount=amount, target_date=date.today() + timedelta(days=days)))
        db.commit()
        created.append(user.id)
        log.info("Seeded demo user %s (%s)", user.name, conn.id)
    return created


def seed_safely() -> None:
    db = SessionLocal()
    try:
        seed(db)
    except OSError as e:  # offline and datasets not cached yet
        log.warning("Skipping demo seed - couldn't fetch Kaggle data: %s", e)
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    init_db()
    seed_safely()
