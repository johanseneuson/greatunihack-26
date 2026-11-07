"""Chat assistant (RAG over the user's own data) and the Expenses tab (past, upcoming, subscriptions, planned)."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.analytics.context import UserContext
from ..services.chat import actions as act
from ..services.chat import assistant
from ..services.chat.corpus import is_essential, load_decisions, upcoming
from .deps import get_ctx

router = APIRouter(prefix="/users/{user_id}", tags=["chat"])


class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=40)
    language: str = Field("English", max_length=40)
    plain: bool = False


class ActionRequest(BaseModel):
    action: dict


@router.post("/chat", summary="Ask the assistant (RAG over your transactions, bills, forecast and guidance). May propose actions to confirm")
def chat(body: ChatRequest, ctx: UserContext = Depends(get_ctx), db: Session = Depends(get_db)):
    msgs = [m.model_dump() for m in body.messages]
    if msgs[-1]["role"] != "user":
        msgs.append({"role": "user", "content": "Continue."})
    return assistant.chat(ctx, db, msgs, body.language, body.plain)


@router.post("/actions", summary="Run an action the assistant proposed, after the user confirmed it. Re-validated server-side")
def run_action(body: ActionRequest, ctx: UserContext = Depends(get_ctx), db: Session = Depends(get_db)):
    ok, message = act.execute(body.action, ctx, db)
    return {"ok": ok, "message": message}


@router.get("/expenses", summary="Expenses tab: upcoming payments, subscriptions (with paused state) and past transactions")
def expenses(ctx: UserContext = Depends(get_ctx), db: Session = Depends(get_db)):
    planned, paused = load_decisions(ctx, db)
    subs = [{"series_id": s.id, "name": s.name, "category": s.category, "period": s.period, "amount": round(s.amount, 2),
             "next_date": s.next_date.date().isoformat(), "essential": is_essential(s), "paused": s.id in paused,
             "kind": "income" if s.direction == "in" else "essential" if is_essential(s) else "subscription"}
            for s in ctx.recurring if s.active and s.direction == "out"]
    past = []
    if ctx.has_data:
        for r in ctx.flows.sort_values(["date", "id"], ascending=False).head(80).itertuples():
            past.append({"date": r.date.date().isoformat(), "name": r.description, "category": r.category, "amount": round(r.amount, 2)})
    return {
        "as_of": ctx.as_of.date().isoformat(),
        "upcoming": upcoming(ctx, planned, paused, 60) if ctx.has_data else [],
        "subscriptions": subs,
        "planned": [{"id": p.id, "date": p.date.isoformat(), "description": p.description, "amount": p.amount, "essential": p.essential} for p in planned],
        "past": past,
    }
