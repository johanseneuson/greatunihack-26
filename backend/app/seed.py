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


# Everyday-spending data has no subscriptions, so give Jordan a few realistic ones (monthly, same day each month).
# This makes subscription detection, pausing from the chat/call and the Expenses tab easy to try.
DEMO_SUBSCRIPTIONS = {
    "jordan@demo.financebuddy": [
        ("Netflix", 10.99, 3), ("Spotify Premium", 11.99, 9), ("PureGym membership", 24.99, 14),
        ("Disney Plus", 7.99, 21), ("Apple.com/bill iCloud", 2.99, 26),
    ],
}


def add_subscriptions(db: Session, user: User, subs: list[tuple], months: int = 8) -> int:
    """Add monthly subscription charges to a user's history (up to their last transaction). Safe to run repeatedly."""
    last = db.scalar(select(func.max(Transaction.date)).where(Transaction.user_id == user.id))
    account = db.scalar(select(Account.name).where(Account.user_id == user.id).order_by(Account.id))
    if not last or not account:
        return 0
    rows = []
    for back in range(months + 1):
        y, m = divmod(last.year * 12 + last.month - 1 - back, 12)
        for name, amount, dom in subs:
            d = date(y, m + 1, min(dom, 28))
            if last - timedelta(days=months * 31) <= d <= last:
                rows.append({"date": pd.Timestamp(d), "description": name, "amount": -amount, "raw_category": None, "account": account})
    if not rows:
        return 0
    return import_rows(db, user, pd.DataFrame(rows), source="demo-subscriptions", provider="demo")["imported"]


MAYA_EMAIL = "maya@demo.financebuddy"


def _maya_rows(days: int = 150) -> tuple[pd.DataFrame, float]:
    """A realistic statement for a young woman on irregular low pay: weekly wages that don't cover rent, bills, five
    streaming services and a Klarna plan. Deterministic. Returns (rows, net movement)."""
    import random
    rng = random.Random(42)
    end = date.today() - timedelta(days=1)
    rows = []

    def add(d, desc, amount):
        rows.append({"date": pd.Timestamp(d), "description": desc, "amount": round(amount, 2), "raw_category": None, "account": "Current account"})

    for i in range(days):
        d = end - timedelta(days=days - 1 - i)
        dom, dow = d.day, d.weekday()
        if dow == 4:
            add(d, "Highstreet Retail Ltd wages", rng.uniform(150, 235))
        monthly = {1: ("Rent - Flat 4", -520), 3: ("Octopus Energy", -48), 12: ("Giffgaff mobile", -16), 18: ("Broadband", -22),
                   14: ("Klarna", -35), 28: ("WorldRemit - family", -40), 3.1: None}
        if dom in monthly and monthly[dom]:
            add(d, *monthly[dom])
        for day_, name, amt in STREAMING:
            if dom == day_:
                add(d, name, -amt)
        if dom == 28:
            add(d, "Overdraft interest", -rng.uniform(5.5, 8.0))
        if rng.random() < 0.6:
            add(d, rng.choice(["Bus - TfGM", "Tram - Metrolink"]), -rng.uniform(2.5, 6.5))
        if dow in (0, 3, 5) and rng.random() < 0.85:
            add(d, rng.choice(["Tesco", "Aldi", "Lidl", "Co-op"]), -rng.uniform(8, 30))
        if rng.random() < 0.18:
            add(d, rng.choice(["Greggs", "Costa", "Pret", "Deliveroo"]), -rng.uniform(4, 15))
        if rng.random() < 0.05:
            add(d, rng.choice(["Primark", "Boots", "Amazon"]), -rng.uniform(10, 35))
    df = pd.DataFrame(rows)
    return df, float(df["amount"].sum())


# Five video streaming services (plus music) on a very tight budget: a clear thing for the assistant to help cut.
STREAMING = [(3, "Netflix", 10.99), (9, "Spotify Premium", 11.99), (11, "Amazon Prime Video", 8.99),
             (17, "NOW TV Entertainment", 9.99), (21, "Disney Plus", 7.99), (26, "Apple.com/bill Apple TV+", 8.99)]


def seed_maya(db: Session) -> bool:
    """Demo user in real financial difficulty. No network needed."""
    if db.scalar(select(User).where(User.email == MAYA_EMAIL)):
        return False
    user = User(
        name="Maya Rahman", email=MAYA_EMAIL, income_type="irregular", housing="rent", household_size=3, dependents=0,
        challenges=["irregular_income", "debt", "sends_money_home", "struggling_to_save"],
        notes="24 years old, lives in Manchester. Retail assistant on a flexible-hours contract, paid weekly and it varies with shifts. Rents a room in a shared flat. "
              "Sends £40 a month to family abroad. Uses her overdraft most months and has a Klarna plan. Finds money stressful and "
              "wants plain, practical help.",
    )
    db.add(user)
    db.flush()
    rows, net = _maya_rows()
    import_rows(db, user, rows, source="demo-maya", provider="demo")
    acc = db.scalar(select(Account).where(Account.user_id == user.id))
    acc.opening_balance = round(123.16 - net, 2)  # ends the history with £123.16 in the account
    db.add_all([Goal(user_id=user.id, name="£300 emergency buffer", target_amount=300, saved_amount=0, target_date=date.today() + timedelta(days=150)),
                Goal(user_id=user.id, name="Clear Klarna", target_amount=210, saved_amount=0, target_date=date.today() + timedelta(days=180))])
    db.commit()
    log.info("Seeded demo user Maya Rahman")
    return True


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
        seed_maya(db)  # synthetic, works offline
        seed(db)
        for email, subs in DEMO_SUBSCRIPTIONS.items():  # also tops up databases seeded before this existed
            user = db.scalar(select(User).where(User.email == email))
            if user and add_subscriptions(db, user, subs):
                log.info("Added demo subscriptions for %s", user.name)
    except OSError as e:  # offline and datasets not cached yet
        log.warning("Skipping demo seed - couldn't fetch Kaggle data: %s", e)
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    init_db()
    seed_safely()
