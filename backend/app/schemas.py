import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

IncomeType = Literal["salary", "irregular", "student", "benefits", "mixed"]


class UserBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str | None = None
    income_type: IncomeType = "salary"
    declared_monthly_income: float | None = Field(None, ge=0, description="Used when income isn't in the uploaded data")
    income_day: int | None = Field(None, ge=1, le=31)
    housing: Literal["rent", "mortgage", "family", "other"] | None = None
    household_size: int = Field(1, ge=1, le=20)
    dependents: int = Field(0, ge=0, le=20)
    current_balance: float | None = Field(None, description="Overrides the balance derived from transactions")
    savings_buffer_target: float | None = Field(None, ge=0)
    challenges: list[str] = Field(default_factory=list, examples=[["irregular_income", "debt", "new_baby"]])
    notes: str | None = Field(None, max_length=2000)


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    income_type: IncomeType | None = None
    declared_monthly_income: float | None = None
    income_day: int | None = Field(None, ge=1, le=31)
    housing: Literal["rent", "mortgage", "family", "other"] | None = None
    household_size: int | None = Field(None, ge=1, le=20)
    dependents: int | None = Field(None, ge=0, le=20)
    current_balance: float | None = None
    savings_buffer_target: float | None = None
    challenges: list[str] | None = None
    notes: str | None = None


class UserOut(UserBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


class GoalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    target_amount: float = Field(gt=0)
    target_date: dt.date | None = None
    saved_amount: float = Field(0, ge=0)


class GoalOut(GoalCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["current", "credit", "savings"] = "current"
    opening_balance: float = 0.0


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    account_id: int
    date: dt.date
    description: str
    amount: float
    category: str
    raw_category: str | None
    is_transfer: bool
    source: str


class TransactionUpdate(BaseModel):
    category: str | None = None
    is_transfer: bool | None = None


class TransactionIn(BaseModel):
    date: dt.date
    description: str
    amount: float = Field(description="Negative = money out")
    category: str | None = None
    account: str = "Main account"


class BankLinkRequest(BaseModel):
    connector: str = Field(examples=["sandbox:personal-finance"])


class AdjustmentIn(BaseModel):
    type: Literal["category", "income", "one_off", "new_recurring", "cancel_recurring"]
    category: str | None = None
    change_pct: float | None = Field(None, ge=-100, le=500, description="For category/income: -20 = 20% less")
    amount: float | None = Field(None, description="For one_off/new_recurring: negative = cost, positive = income")
    date: dt.date | None = None
    day_of_month: int | None = Field(None, ge=1, le=31)
    series_id: str | None = None
    label: str | None = None


class ScenarioRequest(BaseModel):
    adjustments: list[AdjustmentIn] = Field(min_length=1)
    horizon_days: int = Field(365, ge=30, le=730)


class CoachRequest(BaseModel):
    question: str | None = Field(None, max_length=500)


DebtKind = Literal["credit_card", "bnpl", "loan", "overdraft", "other"]


class DebtCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: DebtKind = "credit_card"
    balance: float = Field(gt=0)
    apr: float = Field(0, ge=0, le=100, description="Interest rate, % per year")
    min_payment: float = Field(gt=0, description="Minimum monthly payment")
    series_id: str | None = Field(None, description="Recurring payment that already pays this debt, if any")


class DebtUpdate(BaseModel):
    name: str | None = None
    kind: DebtKind | None = None
    balance: float | None = Field(None, ge=0)
    apr: float | None = Field(None, ge=0, le=100)
    min_payment: float | None = Field(None, gt=0)


class DebtOut(DebtCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int


class FutureSelfRequest(BaseModel):
    question: str = Field(min_length=3, max_length=400)
