from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..services.analytics.context import UserContext, build_context


def get_user(user_id: int, db: Session = Depends(get_db)) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, f"User {user_id} not found")
    return user


def get_ctx(user: User = Depends(get_user), db: Session = Depends(get_db)) -> UserContext:
    return build_context(db, user)
