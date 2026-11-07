from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(200), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    # --- Personal circumstances: these drive personalisation of budgets, buffers and warnings ---
    income_type: Mapped[str] = mapped_column(String(30), default="salary")  # salary | irregular | student | benefits | mixed
    declared_monthly_income: Mapped[float | None] = mapped_column(Float)  # used when income isn't visible in the data
    income_day: Mapped[int | None] = mapped_column(Integer)  # day of month income lands (declared income)
    housing: Mapped[str | None] = mapped_column(String(30))  # rent | mortgage | family | other
    household_size: Mapped[int] = mapped_column(Integer, default=1)
    dependents: Mapped[int] = mapped_column(Integer, default=0)
    current_balance: Mapped[float | None] = mapped_column(Float)  # overrides balance derived from transactions
    savings_buffer_target: Mapped[float | None] = mapped_column(Float)  # "never go below" amount
    challenges: Mapped[list] = mapped_column(JSON, default=list)  # e.g. ["irregular_income", "debt", "new_baby"]
    notes: Mapped[str | None] = mapped_column(Text)  # free text about their situation, fed to the AI coach

    accounts: Mapped[list["Account"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    goals: Mapped[list["Goal"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(30), default="current")  # current | credit | savings
    provider: Mapped[str] = mapped_column(String(60), default="upload")  # upload | sandbox:<dataset> | <open banking provider>
    opening_balance: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped[User] = relationship(back_populates="accounts")

    __table_args__ = (UniqueConstraint("user_id", "name"),)


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    description: Mapped[str] = mapped_column(String(300))
    amount: Mapped[float] = mapped_column(Float)  # signed: negative = money out, positive = money in
    raw_category: Mapped[str | None] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(60), index=True)
    is_transfer: Mapped[bool] = mapped_column(Boolean, default=False)  # moves between own accounts; excluded from spend/income
    source: Mapped[str] = mapped_column(String(60), default="upload")
    dedupe_hash: Mapped[str] = mapped_column(String(64))

    __table_args__ = (UniqueConstraint("user_id", "dedupe_hash"),)


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    target_amount: Mapped[float] = mapped_column(Float)
    target_date: Mapped[date | None] = mapped_column(Date)
    saved_amount: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped[User] = relationship(back_populates="goals")


class PlannedExpense(Base):
    """A known future one-off cost the user (or the chat assistant, after confirmation) added. Feeds the forecast."""
    __tablename__ = "planned_expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date)
    description: Mapped[str] = mapped_column(String(80))
    amount: Mapped[float] = mapped_column(Float)  # signed: negative = cost
    essential: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class PausedSeries(Base):
    """A detected recurring payment the user chose to pause/cancel. The forecast treats it as cancelled."""
    __tablename__ = "paused_series"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    series_id: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("user_id", "series_id"),)


class Debt(Base):
    """A debt the user is paying off (credit card, buy-now-pay-later, loan). Drives the debt-free countdown."""
    __tablename__ = "debts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(20), default="credit_card")  # credit_card | bnpl | loan | overdraft | other
    balance: Mapped[float] = mapped_column(Float)
    apr: Mapped[float] = mapped_column(Float, default=0.0)  # % per year
    min_payment: Mapped[float] = mapped_column(Float)  # per month
    # Recurring payment in the transactions that already pays this debt (so the forecast isn't double-counted)
    series_id: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
