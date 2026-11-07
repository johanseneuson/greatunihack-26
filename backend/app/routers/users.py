from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Debt, Goal, User
from ..schemas import DebtCreate, DebtOut, DebtUpdate, GoalCreate, GoalOut, UserCreate, UserOut, UserUpdate
from .deps import get_user

router = APIRouter(tags=["users"])


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.id)).all()


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db)):
    user = User(**body.model_dump())
    db.add(user)
    db.commit()
    return user


@router.get("/users/{user_id}", response_model=UserOut)
def read_user(user: User = Depends(get_user)):
    return user


@router.patch("/users/{user_id}", response_model=UserOut, summary="Update circumstances (re-personalises every insight)")
def update_user(body: UserUpdate, user: User = Depends(get_user), db: Session = Depends(get_db)):
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user: User = Depends(get_user), db: Session = Depends(get_db)):
    db.delete(user)
    db.commit()


@router.get("/users/{user_id}/goals", response_model=list[GoalOut])
def list_goals(user: User = Depends(get_user)):
    return user.goals


@router.post("/users/{user_id}/goals", response_model=GoalOut, status_code=201)
def create_goal(body: GoalCreate, user: User = Depends(get_user), db: Session = Depends(get_db)):
    goal = Goal(user_id=user.id, **body.model_dump())
    db.add(goal)
    db.commit()
    return goal


@router.delete("/users/{user_id}/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, user: User = Depends(get_user), db: Session = Depends(get_db)):
    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(404, "Goal not found")
    db.delete(goal)
    db.commit()


@router.get("/users/{user_id}/debts", response_model=list[DebtOut])
def list_debts(user: User = Depends(get_user), db: Session = Depends(get_db)):
    return db.scalars(select(Debt).where(Debt.user_id == user.id).order_by(Debt.apr.desc())).all()


@router.post("/users/{user_id}/debts", response_model=DebtOut, status_code=201)
def create_debt(body: DebtCreate, user: User = Depends(get_user), db: Session = Depends(get_db)):
    debt = Debt(user_id=user.id, **body.model_dump())
    db.add(debt)
    db.commit()
    return debt


@router.patch("/users/{user_id}/debts/{debt_id}", response_model=DebtOut)
def update_debt(debt_id: int, body: DebtUpdate, user: User = Depends(get_user), db: Session = Depends(get_db)):
    debt = db.get(Debt, debt_id)
    if not debt or debt.user_id != user.id:
        raise HTTPException(404, "Debt not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(debt, k, v)
    db.commit()
    return debt


@router.delete("/users/{user_id}/debts/{debt_id}", status_code=204)
def delete_debt(debt_id: int, user: User = Depends(get_user), db: Session = Depends(get_db)):
    debt = db.get(Debt, debt_id)
    if not debt or debt.user_id != user.id:
        raise HTTPException(404, "Debt not found")
    db.delete(debt)
    db.commit()

