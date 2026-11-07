"""Getting financial data in: CSV uploads, manual/JSON transactions and bank connections."""
from datetime import date

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Account, Transaction, User
from ..schemas import AccountCreate, BankLinkRequest, TransactionIn, TransactionOut, TransactionUpdate
from ..services.analytics.context import account_exists, accounts_summary, invalidate
from ..services.categories import CATEGORIES
from ..services.connectors import CONNECTORS
from ..services.datasets import DATASETS
from ..services.ingest import import_rows, parse_csv
from .deps import get_user

router = APIRouter(tags=["data"])
MAX_UPLOAD = 10 * 1024 * 1024


@router.get("/categories", summary="Canonical categories and their budget group")
def categories():
    return [{"category": c, "group": g} for c, g in CATEGORIES.items()]


@router.get("/users/{user_id}/accounts")
def list_accounts(user: User = Depends(get_user), db: Session = Depends(get_db)):
    return accounts_summary(db, user)


@router.post("/users/{user_id}/accounts", status_code=201)
def create_account(body: AccountCreate, user: User = Depends(get_user), db: Session = Depends(get_db)):
    if account_exists(db, user.id, body.name):
        raise HTTPException(409, "Account with that name already exists")
    acc = Account(user_id=user.id, **body.model_dump())
    db.add(acc)
    db.commit()
    return {"id": acc.id, "name": acc.name, "kind": acc.kind, "opening_balance": acc.opening_balance}


@router.post("/users/{user_id}/uploads", summary="Upload a bank statement CSV (Monzo, Starling, Revolut, generic, Kaggle...)")
async def upload_statement(
    file: UploadFile = File(...),
    account_name: str = Form("Main account", description="Used when the CSV has no account column"),
    account_kind: str = Form("current"),
    user: User = Depends(get_user),
    db: Session = Depends(get_db),
):
    content = await file.read()
    if len(content) > MAX_UPLOAD:
        raise HTTPException(413, "File too large (max 10 MB)")
    try:
        parsed = parse_csv(content, default_account=account_name)
    except (ValueError, UnicodeDecodeError, pd.errors.ParserError) as e:
        raise HTTPException(422, f"Couldn't read that CSV: {e}") from e
    result = import_rows(db, user, parsed.rows, source=f"upload:{file.filename}", account_kind=account_kind)
    return {**result, "detected_columns": parsed.columns, "notes": parsed.notes}


@router.post("/users/{user_id}/transactions", status_code=201, summary="Add transactions as JSON (manual entry or app sync)")
def add_transactions(body: list[TransactionIn], user: User = Depends(get_user), db: Session = Depends(get_db)):
    rows = pd.DataFrame([{"date": pd.Timestamp(t.date), "description": t.description, "amount": round(t.amount, 2),
                          "raw_category": t.category, "account": t.account} for t in body])
    if rows.empty:
        raise HTTPException(422, "No transactions supplied")
    return import_rows(db, user, rows, source="api")


@router.get("/users/{user_id}/transactions", response_model=list[TransactionOut])
def list_transactions(
    user: User = Depends(get_user),
    db: Session = Depends(get_db),
    date_from: date | None = None,
    date_to: date | None = None,
    category: str | None = None,
    account_id: int | None = None,
    search: str | None = None,
    include_transfers: bool = True,
    limit: int = Query(100, le=1000),
    offset: int = 0,
):
    q = select(Transaction).where(Transaction.user_id == user.id)
    if date_from:
        q = q.where(Transaction.date >= date_from)
    if date_to:
        q = q.where(Transaction.date <= date_to)
    if category:
        q = q.where(Transaction.category == category)
    if account_id:
        q = q.where(Transaction.account_id == account_id)
    if search:
        q = q.where(Transaction.description.ilike(f"%{search}%"))
    if not include_transfers:
        q = q.where(Transaction.is_transfer.is_(False))
    return db.scalars(q.order_by(Transaction.date.desc(), Transaction.id.desc()).limit(limit).offset(offset)).all()


@router.patch("/users/{user_id}/transactions/{txn_id}", response_model=TransactionOut, summary="Re-categorise a transaction")
def update_transaction(txn_id: int, body: TransactionUpdate, user: User = Depends(get_user), db: Session = Depends(get_db)):
    txn = db.get(Transaction, txn_id)
    if not txn or txn.user_id != user.id:
        raise HTTPException(404, "Transaction not found")
    if body.category is not None:
        if body.category not in CATEGORIES:
            raise HTTPException(422, f"Unknown category. Use one of: {list(CATEGORIES)}")
        txn.category = body.category
        txn.is_transfer = body.category == "Transfer"
    if body.is_transfer is not None:
        txn.is_transfer = body.is_transfer
    db.commit()
    invalidate(user.id)
    return txn


@router.delete("/users/{user_id}/transactions", summary="Delete all of a user's transactions and accounts")
def clear_transactions(user: User = Depends(get_user), db: Session = Depends(get_db)):
    n = db.scalar(select(func.count(Transaction.id)).where(Transaction.user_id == user.id))
    for a in list(user.accounts):
        db.delete(a)
    db.commit()
    return {"deleted_transactions": n}


@router.get("/bank-connectors", summary="Banks the user can link")
def list_connectors():
    return [{"id": c.id, "name": c.name, "description": c.description} for c in CONNECTORS.values()]


@router.post("/users/{user_id}/bank-connections", summary="Link a bank and import its transactions")
def link_bank(body: BankLinkRequest, user: User = Depends(get_user), db: Session = Depends(get_db)):
    conn = CONNECTORS.get(body.connector)
    if not conn:
        raise HTTPException(404, f"Unknown connector. Available: {list(CONNECTORS)}")
    try:
        rows, shift = conn.fetch()
    except OSError as e:
        raise HTTPException(502, f"Couldn't reach the data source: {e}") from e
    result = import_rows(db, user, rows, source=conn.id, provider=conn.id, date_shift_days=shift)
    return {"connector": conn.id, **result, "date_shift_days": shift}


@router.get("/datasets", summary="Kaggle datasets backing the sandbox bank")
def datasets():
    return [{"key": d.key, "title": d.title, "description": d.description, "kaggle_url": d.url,
             "license": d.license, "downloaded": d.path.exists()} for d in DATASETS.values()]
