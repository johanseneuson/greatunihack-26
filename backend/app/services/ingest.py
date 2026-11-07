"""Parse bank statement CSVs (Kaggle datasets, Monzo, Starling, Revolut, Wise, generic) into normalised rows."""
import hashlib
import io
import re
from dataclasses import dataclass, field

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Account, Transaction, User
from .categories import categorise

SYNONYMS = {
    "date": ["date", "transaction date", "posted date", "booking date", "created on", "completed date", "started date", "value date", "timestamp", "time"],
    "description": ["description", "name", "merchant", "payee", "details", "narrative", "counter party", "counterparty", "transaction description", "memo", "reference", "notes"],
    "amount": ["amount", "value", "transaction amount", "amount (gbp)", "amount(gbp)", "net amount"],
    "money_out": ["money out", "paid out", "debit", "debit amount", "withdrawal", "withdrawals", "out"],
    "money_in": ["money in", "paid in", "credit", "credit amount", "deposit", "deposits", "in"],
    "type": ["transaction type", "type", "dr/cr", "debit/credit", "direction", "credit/debit"],
    "category": ["category", "categories", "spending category"],
    "account": ["account name", "account", "account_name"],
}
DIRECTION_WORDS = {"debit": -1, "dr": -1, "d": -1, "out": -1, "credit": 1, "cr": 1, "c": 1, "in": 1}
INCOME_HINT = re.compile(r"income|salary|paycheck|wage|refund", re.I)


@dataclass
class ParsedStatement:
    rows: pd.DataFrame  # date, description, amount, raw_category, account
    columns: dict[str, str]
    notes: list[str] = field(default_factory=list)


def _find(cols: dict[str, str], key: str) -> str | None:
    for syn in SYNONYMS[key]:
        if syn in cols:
            return cols[syn]
    return None


def _to_number(s: pd.Series) -> pd.Series:
    txt = s.astype(str).str.strip()
    neg = txt.str.match(r"^\(.*\)$")
    txt = txt.str.replace(r"[£$€,\s()]", "", regex=True).replace({"": None, "nan": None, "None": None})
    num = pd.to_numeric(txt, errors="coerce")
    return num.where(~neg, -num.abs())


def _parse_dates(s: pd.Series) -> pd.Series:
    txt = s.astype(str).str.strip()
    if txt.str.match(r"^\d{4}-\d{2}-\d{2}").mean() > 0.9:
        parsed = pd.to_datetime(txt, utc=True, format="ISO8601", errors="coerce")
    else:
        parts = txt.str.extract(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-]")
        first, second = pd.to_numeric(parts[0], errors="coerce"), pd.to_numeric(parts[1], errors="coerce")
        # US style (MM/DD) only when a day > 12 shows up in the second slot and never in the first; UK default.
        dayfirst = not ((second > 12).any() and not (first > 12).any())
        parsed = pd.to_datetime(txt, utc=True, dayfirst=dayfirst, format="mixed", errors="coerce")
    return parsed.dt.tz_localize(None).dt.normalize()


def parse_csv(content: bytes, default_account: str = "Main account") -> ParsedStatement:
    df = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False, encoding_errors="replace")
    if df.empty:
        raise ValueError("The file has no rows.")
    cols = {c.strip().lower(): c for c in df.columns}
    found = {k: _find(cols, k) for k in SYNONYMS}
    # Several exports have both "Name" and "Description" (Monzo: merchant is in Name). Use the best-filled one.
    desc_candidates = [cols[s] for s in SYNONYMS["description"] if s in cols]
    if desc_candidates:
        found["description"] = max(desc_candidates, key=lambda c: (df[c].str.strip() != "").mean())
    notes: list[str] = []

    if not found["date"]:
        raise ValueError(f"Couldn't find a date column. Columns seen: {list(df.columns)}")

    # Amount and sign
    if found["money_out"] and found["money_in"] and not found["amount"]:
        amount = _to_number(df[found["money_in"]]).fillna(0) - _to_number(df[found["money_out"]]).fillna(0).abs()
    elif found["amount"]:
        amount = _to_number(df[found["amount"]])
        direction = None
        if found["type"]:
            d = df[found["type"]].str.strip().str.lower().map(DIRECTION_WORDS)
            if d.notna().mean() > 0.9:
                direction = d
        if direction is not None:
            amount = amount.abs() * direction
        elif (amount < 0).sum() == 0:
            # Spending-only export (e.g. expense trackers): treat as money out unless the category says income.
            income = df[found["category"]].str.contains(INCOME_HINT) if found["category"] else False
            amount = amount.where(income, -amount)
            notes.append("No signs or debit/credit column found: amounts treated as spending (except income categories).")
    else:
        raise ValueError(f"Couldn't find an amount column. Columns seen: {list(df.columns)}")

    category = df[found["category"]].str.strip() if found["category"] else pd.Series([None] * len(df))
    if found["description"]:
        description = df[found["description"]].str.strip()
        description = description.where(description != "", category.fillna("Unknown"))
    else:
        description = category.fillna("Unknown")
        notes.append("No description column: using category as description.")

    rows = pd.DataFrame({
        "date": _parse_dates(df[found["date"]]),
        "description": description.astype(str).str.slice(0, 300),
        "amount": amount.round(2),
        "raw_category": category.where(category != "", None),
        "account": df[found["account"]].str.strip() if found["account"] else default_account,
    })
    bad = rows["date"].isna() | rows["amount"].isna()
    if bad.any():
        notes.append(f"Skipped {int(bad.sum())} rows with an unreadable date or amount.")
    rows = rows[~bad & (rows["amount"] != 0)].sort_values("date", kind="stable").reset_index(drop=True)
    return ParsedStatement(rows=rows, columns={k: v for k, v in found.items() if v}, notes=notes)


def _hash(user_id: int, account: str, d, desc: str, amount: float, n: int) -> str:
    key = f"{user_id}|{account}|{d:%Y-%m-%d}|{desc.lower()}|{amount:.2f}|{n}"
    return hashlib.sha256(key.encode()).hexdigest()[:40]


def import_rows(
    db: Session,
    user: User,
    rows: pd.DataFrame,
    *,
    source: str,
    account_kind: str = "current",
    provider: str = "upload",
    date_shift_days: int = 0,
) -> dict:
    """Insert parsed rows for a user, creating accounts as needed and skipping duplicates."""
    if date_shift_days:
        rows = rows.assign(date=rows["date"] + pd.Timedelta(days=date_shift_days))

    accounts = {a.name: a for a in user.accounts}
    existing = set(db.scalars(select(Transaction.dedupe_hash).where(Transaction.user_id == user.id)))
    seen: dict[tuple, int] = {}
    new, dupes = [], 0

    for r in rows.itertuples(index=False):
        acc_name = str(r.account) or "Main account"
        if acc_name not in accounts:
            kind = "credit" if re.search(r"card|credit", acc_name, re.I) and account_kind == "current" else account_kind
            acc = Account(user_id=user.id, name=acc_name, kind=kind, provider=provider)
            db.add(acc)
            db.flush()
            accounts[acc_name] = acc
        key = (acc_name, r.date, r.description.lower(), r.amount)
        seen[key] = seen.get(key, 0) + 1
        h = _hash(user.id, acc_name, r.date, r.description, r.amount, seen[key])
        if h in existing:
            dupes += 1
            continue
        existing.add(h)
        raw_cat = r.raw_category if isinstance(r.raw_category, str) and r.raw_category else None
        category, is_transfer = categorise(r.description, raw_cat, r.amount)
        new.append(Transaction(
            user_id=user.id, account_id=accounts[acc_name].id, date=r.date.date(), description=r.description,
            amount=float(r.amount), raw_category=raw_cat, category=category, is_transfer=is_transfer,
            source=source, dedupe_hash=h,
        ))

    db.add_all(new)
    db.commit()
    return {
        "imported": len(new),
        "duplicates_skipped": dupes,
        "accounts": sorted({str(a) for a in rows["account"]}),
        "date_from": rows["date"].min().date().isoformat() if len(rows) else None,
        "date_to": rows["date"].max().date().isoformat() if len(rows) else None,
    }
