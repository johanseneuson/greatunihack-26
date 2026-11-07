"""Turns one user's data (profile, balances, forecast, recurring payments, planned expenses, transactions) plus the
guidance knowledge base into small text documents that the assistant retrieves from."""
import re
from functools import lru_cache

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...config import BASE_DIR
from ...models import PausedSeries, PlannedExpense
from ..analytics import insights as ins
from ..analytics.context import UserContext
from ..analytics.history import monthly_cashflow
from .support import support_doc, support_options

KB_DIR = BASE_DIR / "data" / "knowledge"


def gbp(x: float) -> str:
    return ("-£" if x < 0 else "£") + f"{abs(x):,.2f}"


def day(d) -> str:
    d = pd.Timestamp(d)
    return f"{d.strftime('%a')} {d.day} {d.strftime('%b %Y')}"


@lru_cache(maxsize=1)
def knowledge() -> tuple:
    out = []
    for f in sorted(KB_DIR.glob("*.md")):
        for sec in f.read_text(encoding="utf8").split("\n# "):
            sec = sec.strip().removeprefix("# ").strip()
            if sec:
                title, _, body = sec.partition("\n")
                out.append((title.strip(), body.strip()))
    return tuple(out)


FAMILY_SUPPORT = re.compile(r"remit|family|western union|wise|sending money", re.I)


def is_essential(series) -> bool:
    """Bills and commitments the assistant must never cancel for the user (also money sent to family)."""
    return series.direction == "out" and (series.group == "essential" or bool(FAMILY_SUPPORT.search(series.name)))


def load_decisions(ctx: UserContext, db: Session):
    uid = ctx.user.id
    planned = list(db.scalars(select(PlannedExpense).where(PlannedExpense.user_id == uid).order_by(PlannedExpense.date)).all())
    paused = set(db.scalars(select(PausedSeries.series_id).where(PausedSeries.user_id == uid)).all())
    return planned, paused


def upcoming(ctx: UserContext, planned: list, paused: set, days: int = 60) -> list[dict]:
    """Next outgoings and incomes from active recurring payments plus planned one-offs (deterministic)."""
    start, end = ctx.as_of + pd.Timedelta(days=1), ctx.as_of + pd.Timedelta(days=days)
    items = []
    for s in ctx.recurring:
        if not s.active or s.id in paused:
            continue
        for d in s.schedule(start, end):
            items.append({"date": d.date().isoformat(), "name": s.name, "amount": s.amount if s.direction == "in" else -s.amount,
                          "kind": "income" if s.direction == "in" else "bill", "series_id": s.id, "essential": is_essential(s)})
    for p in planned:
        if start.date() <= p.date <= end.date():
            items.append({"date": p.date.isoformat(), "name": p.description, "amount": p.amount, "kind": "planned",
                          "planned_id": p.id, "essential": bool(p.essential)})
    for i in items:
        i["in_days"] = (pd.Timestamp(i["date"]) - ctx.as_of).days
    return sorted(items, key=lambda i: i["date"])


def build_docs(ctx: UserContext, db: Session) -> list[dict]:
    planned, paused = load_decisions(ctx, db)
    docs: list[dict] = []

    def add(kind, title, text, core=False):
        docs.append({"kind": kind, "title": title, "text": text, "core": core})

    u = ctx.user
    goals = "; ".join(f"{g.name}: saved {gbp(g.saved_amount)} of {gbp(g.target_amount)}" + (f", target {day(g.target_date)}" if g.target_date else "") for g in u.goals)
    add("profile", "About the user",
        f"Name {u.name}. Income type: {u.income_type}. Housing: {u.housing}. Household size {u.household_size}, dependents {u.dependents}. "
        f"Challenges: {', '.join(u.challenges) or 'none stated'}. Notes: {u.notes or 'none'}. Goals: {goals or 'none yet'}.", core=True)

    if not ctx.has_data:
        add("account", "Account position", "There is no transaction data yet. Ask the user to upload a statement or link a bank.", core=True)
        return docs + [{"kind": "knowledge", "title": t, "text": b, "core": False} for t, b in knowledge()]

    ov, res = ins.overview(ctx), ins.resilience(ctx)
    fc = ins.forecast(ctx).summary()
    lp, po = fc["lowest_point"], fc["prob_overdraft"]
    add("account", "Account position",
        f"Today is {day(ctx.as_of + pd.Timedelta(days=1))} (data up to {day(ctx.as_of)}). Balance {gbp(ov['balance'])}. Monthly income {gbp(ov['monthly_income'])} ({ov['income_source']}). "
        f"Essential bills about {gbp(ov['essential_monthly'])} a month. Safety buffer target {gbp(ov['buffer_target'])}. "
        f"Resilience score {res['score']} out of 100 ({res['label']}). Forecast (estimate): lowest likely balance {gbp(lp['p50'])} on {day(lp['date'])} "
        f"(worst case {gbp(lp['p10'])}). Chance of going overdrawn: {round(po['30d'] * 100)}% in 30 days, {round(po['90d'] * 100)}% in 90 days. "
        f"Chance of an unplanned cost in 90 days: {round(fc['prob_unexpected_expense_90d'] * 100)}%, typically {gbp(fc['typical_unexpected_expense'])}.", core=True)

    b = ins.budget(ctx)
    s = b["safe_to_spend"]
    add("account", "Safe to spend",
        f"Safe to spend today {gbp(s['today'])}. Next payday {day(s['next_payday'])}, in {s['days_to_payday']} days. Bills before payday {gbp(s['bills_before_payday'])}. "
        f"Safety buffer kept {gbp(s['buffer_kept'])}. Flexible budget left this month {gbp(s['flexible_budget_left_this_month'])}. All these are estimates.", core=True)

    rec = []
    for r in ctx.recurring:
        status = "PAUSED" if r.id in paused else ("active" if r.active else "ended")
        kind = "income" if r.direction == "in" else "essential bill" if is_essential(r) else "subscription/discretionary"
        rec.append(f"id={r.id} {r.name} ({kind}) {gbp(r.amount if r.direction == 'in' else -r.amount)} {r.period}, next {day(r.next_date)}, {status}")
    add("account", "Recurring payments and subscriptions", "\n".join(rec) or "None detected.", core=True)

    up = upcoming(ctx, planned, paused)
    lines = []
    for i in up:
        extra = (f" series_id={i['series_id']}" if i.get("series_id") else "") + (f" planned_id={i['planned_id']}" if i.get("planned_id") else "")
        lines.append(f"{day(i['date'])} (in {i['in_days']} days) {i['name']} {gbp(i['amount'])} [{i['kind']}{', essential' if i['essential'] else ''}]{extra}")
    add("account", "Upcoming payments (next 60 days)", "\n".join(lines) or "Nothing scheduled.", core=True)
    add("account", "Planned one-off expenses",
        "\n".join(f"planned_id={p.id} {day(p.date)} {p.description} {gbp(p.amount)}{' (essential)' if p.essential else ''}" for p in planned) or "None planned.", core=True)

    add("account", "Warnings", "\n".join(f"[{w['severity']}] {w['title']}: {w['message']} Action: {w.get('action') or '-'}" for w in ins.warnings(ctx)[:8]) or "None.", core=True)

    add("account", "Support she may be eligible for (real UK schemes)", support_doc(support_options(ctx)), core=True)

    add("account", "Budget by category",
        "\n".join(f"{c['category']} ({c['group']}): average {gbp(c['avg_monthly'])} a month, suggested limit {gbp(c['suggested_limit'])}, spent this month {gbp(c['spent_this_month'])}"
                  for c in b["categories"][:12]) + f"\nSavings suggested {gbp(b['totals']['savings_suggested'])} a month.")
    tt = ins.time_travel(ctx)
    add("account", "Goals and smart moves", "\n".join(g["message"] for g in tt["goals"]) + "\n" + "\n".join(m["message"] for m in tt["smart_moves"][:4]))
    add("account", "Monthly cash flow",
        "\n".join(f"{m['month']}: income {gbp(m['income'])}, spending {gbp(m['spending'])}, net {gbp(m['net'])}{' (month not finished)' if m.get('partial') else ''}"
                  for m in monthly_cashflow(ctx, 6)))

    recent = ctx.flows[ctx.flows["date"] > ctx.as_of - pd.Timedelta(days=90)]
    for (month, cat), g in recent.groupby([recent["date"].dt.strftime("%Y-%m"), "category"]):
        lines = "; ".join(f"{r.date.date().isoformat()} {r.description[:30]} {gbp(r.amount)}" for r in g.sort_values("date").tail(25).itertuples())
        add("transactions", f"Past transactions: {month} {cat}", lines)

    for title, body in knowledge():
        add("knowledge", title, body)
    return docs
