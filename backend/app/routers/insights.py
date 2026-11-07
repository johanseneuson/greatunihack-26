"""Insights: understand the past, see the future, get warned early, plan with a personal budget."""
from fastapi import APIRouter, Depends, Query

from ..config import settings
from ..schemas import CoachRequest, ScenarioRequest
from ..services import coach as coach_service
from ..services.analytics import insights as ins
from ..services.analytics.context import UserContext
from ..services.analytics.forecast import Adjustment
from ..services.analytics.timetravel import run_scenario
from .deps import get_ctx

router = APIRouter(prefix="/users/{user_id}/insights", tags=["insights"])


@router.get("/dashboard", summary="Everything for the home screen in one call")
def dashboard(ctx: UserContext = Depends(get_ctx)):
    return ins.dashboard(ctx)


@router.get("/overview")
def overview(ctx: UserContext = Depends(get_ctx)):
    return {**ins.overview(ctx), "resilience": ins.resilience(ctx)}


@router.get("/history", summary="Monthly cash flow, category breakdown, top merchants, recurring payments")
def history(ctx: UserContext = Depends(get_ctx)):
    return ins.history(ctx)


@router.get("/recurring", summary="Detected salary, bills and subscriptions with next expected dates")
def recurring(ctx: UserContext = Depends(get_ctx)):
    return [s.to_dict() for s in ctx.recurring]


@router.get("/forecast", summary="Monte Carlo balance forecast with percentile bands")
def forecast(
    ctx: UserContext = Depends(get_ctx),
    horizon_days: int = Query(None, ge=14, le=730),
    step: int = Query(1, ge=1, le=30, description="Return every Nth day"),
):
    if not ctx.has_data:
        return {"summary": None, "daily": [], "monthly": [], "scheduled": []}
    fc = ins.forecast(ctx, horizon_days)
    return {"summary": fc.summary(), "daily": fc.daily(step), "monthly": fc.monthly(), "scheduled": fc.scheduled}


@router.get("/forecast-accuracy", summary="Backtest: forecast vs what really happened over the last 12 weeks")
def forecast_accuracy(ctx: UserContext = Depends(get_ctx)):
    return ins.accuracy(ctx)


@router.get("/waves", summary="Past and upcoming spending waves + seasonal peaks")
def waves(ctx: UserContext = Depends(get_ctx)):
    return ins.waves(ctx)


@router.get("/warnings", summary="Early warnings for hardship and unexpected expenses, each with an action")
def warnings(ctx: UserContext = Depends(get_ctx)):
    return ins.warnings(ctx)


@router.get("/budget", summary="Personalised budget, safe-to-spend and subscriptions")
def budget(ctx: UserContext = Depends(get_ctx)):
    return ins.budget(ctx) if ctx.has_data else {"categories": []}


@router.get("/time-travel", summary="Future-you snapshots, goal timelines and smart moves")
def time_travel(ctx: UserContext = Depends(get_ctx)):
    return ins.time_travel(ctx) if ctx.has_data else {"snapshots": [], "goals": [], "smart_moves": []}


@router.post("/scenarios", summary="What-if: rerun the future with changes (cut a category, pay rise, holiday...)")
def scenario(body: ScenarioRequest, ctx: UserContext = Depends(get_ctx)):
    base = ins.forecast(ctx, body.horizon_days)
    adjustments = [Adjustment(**a.model_dump()) for a in body.adjustments]
    return run_scenario(ctx, base, adjustments, settings.simulations)


@router.post("/coach", summary="AI coach: a positive, personalised story + next steps (rule-based without an API key)")
def coach(body: CoachRequest | None = None, ctx: UserContext = Depends(get_ctx)):
    if not ctx.has_data:
        return {"source": "rules", "headline": "Let's get started", "summary": "Upload a statement or link a bank first.",
                "future_you": "", "watch_out": [], "actions": [], "encouragement": ""}
    return coach_service.coach(ins.coach_snapshot(ctx), body.question if body else None)
