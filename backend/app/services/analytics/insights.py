"""Composes the individual analytics into the payloads served by the API."""
from ...config import settings
from .budget import build_budget
from .context import UserContext
from .forecast import ForecastResult, baseline_forecast
from .history import category_breakdown, monthly_cashflow, resilience_score, top_merchants
from .risks import build_warnings
from .timetravel import goal_timelines, smart_moves, snapshots
from .waves import detect_waves


def forecast(ctx: UserContext, horizon: int | None = None) -> ForecastResult:
    return baseline_forecast(ctx, horizon or settings.default_horizon_days, settings.simulations)


def _memo(ctx: UserContext, key: str, fn):
    if key not in ctx.cache:
        ctx.cache[key] = fn()
    return ctx.cache[key]


def waves(ctx: UserContext) -> dict:
    # A year ahead so seasonal waves (e.g. next December) are visible
    return _memo(ctx, "waves", lambda: detect_waves(ctx, forecast(ctx, max(settings.default_horizon_days, 366))))


def budget(ctx: UserContext) -> dict:
    return _memo(ctx, "budget", lambda: build_budget(ctx, forecast(ctx)))


def warnings(ctx: UserContext) -> list[dict]:
    return _memo(ctx, "warnings", lambda: build_warnings(ctx, forecast(ctx), waves(ctx), budget(ctx)))


def resilience(ctx: UserContext) -> dict:
    return _memo(ctx, "resilience", lambda: resilience_score(ctx, forecast(ctx).summary()) if ctx.has_data else None)


def moves(ctx: UserContext) -> list[dict]:
    return _memo(ctx, "moves", lambda: smart_moves(ctx, forecast(ctx)))


def time_travel(ctx: UserContext) -> dict:
    fc = forecast(ctx, max(settings.default_horizon_days, 366))
    return {
        "today": {"date": ctx.as_of.date().isoformat(), "balance": ctx.balance},
        "snapshots": snapshots(ctx, fc),
        "goals": goal_timelines(ctx, fc),
        "monthly": fc.monthly(),
        "smart_moves": moves(ctx),
    }


def overview(ctx: UserContext) -> dict:
    u = ctx.user
    return {
        "user": {"id": u.id, "name": u.name, "income_type": u.income_type, "housing": u.housing,
                 "household_size": u.household_size, "dependents": u.dependents, "challenges": u.challenges or []},
        "as_of": ctx.as_of.date().isoformat(),
        "history_days": ctx.history_days,
        "transactions": int(len(ctx.df)),
        "balance": ctx.balance,
        "balance_source": ctx.balance_source,
        "monthly_income": ctx.monthly_income,
        "income_source": ctx.income_source,
        "essential_monthly": ctx.essential_monthly,
        "buffer_target": ctx.buffer_target,
        "currency_symbol": settings.currency_symbol,
    }


def history(ctx: UserContext) -> dict:
    return {
        "monthly": monthly_cashflow(ctx, 24),
        "categories_90d": category_breakdown(ctx, 90),
        "top_merchants_90d": top_merchants(ctx, 90),
        "recurring": [s.to_dict() for s in ctx.recurring],
    }


def dashboard(ctx: UserContext) -> dict:
    """Everything the home screen needs in one call."""
    if not ctx.has_data:
        return {"overview": overview(ctx), "empty": True, "warnings": warnings(ctx)}
    fc = forecast(ctx)
    return {
        "overview": overview(ctx),
        "resilience": resilience(ctx),
        "forecast": {"summary": fc.summary(), "daily": fc.daily(step=1), "upcoming": fc.scheduled[:15]},
        "waves": waves(ctx),
        "warnings": warnings(ctx),
        "budget": budget(ctx),
        "time_travel": time_travel(ctx),
        "history": {"monthly": monthly_cashflow(ctx, 12), "categories_90d": category_breakdown(ctx, 90)},
    }


def coach_snapshot(ctx: UserContext) -> dict:
    """Compact, number-rich context for the AI coach (keeps tokens low)."""
    fc = forecast(ctx)
    u = ctx.user
    b = budget(ctx)
    tt = time_travel(ctx)
    return {
        "circumstances": {"name": u.name.split()[0], "income_type": u.income_type, "housing": u.housing,
                          "household_size": u.household_size, "dependents": u.dependents,
                          "challenges": u.challenges or [], "notes": u.notes},
        "today": overview(ctx),
        "resilience": resilience(ctx),
        "forecast": fc.summary(),
        "time_travel": tt["snapshots"],
        "goals": tt["goals"],
        "smart_moves": tt["smart_moves"],
        "upcoming_waves": waves(ctx)["upcoming_waves"][:3],
        "seasonal_peaks": waves(ctx)["seasonal_peaks"][:3],
        "warnings": [{k: w.get(k) for k in ("severity", "title", "message", "action", "upside")} for w in warnings(ctx)],
        "budget": {"safe_to_spend": b["safe_to_spend"], "totals": b["totals"], "why": b["why"],
                   "top_categories": b["categories"][:8]},
        "recent_categories": category_breakdown(ctx, 90)[:8],
    }
