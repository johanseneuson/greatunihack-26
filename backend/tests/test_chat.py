"""Chat assistant tests. Offline: COACH_ENABLED=false (see conftest), so no network and no API key are used."""
from app.services.chat.grounding import unsupported_figures
from app.services.chat.retrieval import search


def test_grounding_accepts_context_figures_and_simple_sums():
    ctx = "Rent -£900.00. Phone -£25.00. Safe to spend today £47.28."
    assert unsupported_figures("Rent is £900 and phone £25, so £925 together.", ctx, "") == []
    assert unsupported_figures("Safe to spend is £47.", ctx, "") == []  # rounding
    assert unsupported_figures("A £30 night out", ctx, "can I afford £30?") == []  # user's own figure


def test_grounding_rejects_invented_figures():
    ctx = "Rent -£900.00. Phone -£25.00."
    assert unsupported_figures("Your overdraft rate is £3,412.", ctx, "") == [3412.0]


def test_retrieval_always_includes_core_docs():
    docs = [{"kind": "profile", "title": "About", "text": "x", "core": True},
            {"kind": "knowledge", "title": "Overdrafts", "text": "overdraft interest is borrowing", "core": False},
            {"kind": "knowledge", "title": "Scams", "text": "never share your pin", "core": False}]
    hits = search(docs, "how do I stop my overdraft", 1)
    assert [h["title"] for h in hits] == ["About", "Overdrafts"]


def test_chat_offline_answers_from_user_data(client, user_with_data):
    r = client.post(f"/api/users/{user_with_data['id']}/chat", json={"messages": [{"role": "user", "content": "how am I doing?"}]}).json()
    assert r["mode"] == "offline" and r["actions"] == [] and "Balance" in r["reply"]


def test_pause_subscription_changes_forecast_and_essentials_are_protected(client, user_with_data):
    uid = user_with_data["id"]
    ex = client.get(f"/api/users/{uid}/expenses").json()
    rent = next(s for s in ex["subscriptions"] if s["name"] == "Rent - Landlord")
    assert rent["essential"]
    bad = client.post(f"/api/users/{uid}/actions", json={"action": {"type": "pause_subscription", "series_id": rent["series_id"]}}).json()
    assert not bad["ok"] and "essential" in bad["message"]
    # a non-essential recurring payment can be paused, which removes it from the forecast schedule
    phone = next(s for s in ex["subscriptions"] if s["name"] == "Vodafone")
    sched = lambda: [e for e in client.get(f"/api/users/{uid}/insights/forecast", params={"horizon_days": 90}).json()["scheduled"] if e["name"] == "Vodafone"]
    n0 = len(sched())
    assert n0 > 0
    if phone["essential"]:  # Vodafone is categorised as an essential bill; use the forged-request path instead
        assert not client.post(f"/api/users/{uid}/actions", json={"action": {"type": "pause_subscription", "series_id": phone["series_id"]}}).json()["ok"]
    else:
        assert client.post(f"/api/users/{uid}/actions", json={"action": {"type": "pause_subscription", "series_id": phone["series_id"]}}).json()["ok"]
        assert len(sched()) == 0
        client.post(f"/api/users/{uid}/actions", json={"action": {"type": "resume_subscription", "series_id": phone["series_id"]}})
        assert len(sched()) == n0


def test_planned_expense_flows_into_forecast_and_can_be_removed(client, user_with_data):
    uid = user_with_data["id"]
    from datetime import date, timedelta
    when = (date.today() + timedelta(days=20)).isoformat()
    lowest = lambda: client.get(f"/api/users/{uid}/insights/forecast", params={"horizon_days": 60}).json()["summary"]["lowest_point"]["p50"]
    before = lowest()
    ok = client.post(f"/api/users/{uid}/actions", json={"action": {"type": "add_planned_expense", "description": "Laptop repair", "amount": 400, "date": when}}).json()
    assert ok["ok"]
    ex = client.get(f"/api/users/{uid}/expenses").json()
    assert [p["description"] for p in ex["planned"]] == ["Laptop repair"] and any(u.get("planned_id") for u in ex["upcoming"])
    assert lowest() < before
    client.post(f"/api/users/{uid}/actions", json={"action": {"type": "remove_planned_expense", "planned_id": ex["planned"][0]["id"]}})
    assert client.get(f"/api/users/{uid}/expenses").json()["planned"] == []


def test_actions_are_validated_and_scoped_to_the_user(client, user_with_data):
    uid = user_with_data["id"]
    for a in ({"type": "add_planned_expense", "description": "x", "amount": -5, "date": "2020-01-01"},
              {"type": "add_planned_expense", "description": "", "amount": 5, "date": "2099-01-01"},
              {"type": "remove_planned_expense", "planned_id": 999999},
              {"type": "pause_subscription", "series_id": "out-nope"},
              {"type": "drop_database"}):
        assert not client.post(f"/api/users/{uid}/actions", json={"action": a}).json()["ok"], a


def test_demo_subscriptions_are_detected_and_pausable(client, user_with_data):
    from app.db import SessionLocal
    from app.models import User
    from app.seed import add_subscriptions
    uid = user_with_data["id"]
    db = SessionLocal()
    try:
        n = add_subscriptions(db, db.get(User, uid), [("Netflix", 10.99, 3), ("Spotify Premium", 11.99, 9)])
        assert n > 0 and add_subscriptions(db, db.get(User, uid), [("Netflix", 10.99, 3), ("Spotify Premium", 11.99, 9)]) == 0  # idempotent
    finally:
        db.close()
    subs = {s["name"]: s for s in client.get(f"/api/users/{uid}/expenses").json()["subscriptions"]}
    assert {"Netflix", "Spotify Premium"} <= set(subs) and not subs["Netflix"]["essential"]
    r = client.post(f"/api/users/{uid}/actions", json={"action": {"type": "pause_subscription", "series_id": subs["Netflix"]["series_id"]}}).json()
    assert r["ok"]


def _ctx_for(client, uid):
    from app.db import SessionLocal
    from app.models import User
    from app.services.analytics.context import build_context
    db = SessionLocal()
    try:
        return build_context(db, db.get(User, uid))
    finally:
        db.close()


def test_support_matches_the_persons_situation(client, user_with_data):
    from app.services.chat.support import support_doc, support_options
    # Sam earns about 2,000 a month: not a Universal Credit signpost, and nothing is promised
    ids = {o["id"] for o in support_options(_ctx_for(client, user_with_data["id"]))}
    assert "universal_credit" not in ids and "help_to_save" not in ids
    # A low-income renter on irregular pay is pointed at Universal Credit and what hangs off it
    from tests.conftest import synthetic_statement
    u = client.post("/api/users", json={"name": "Low Income", "income_type": "irregular", "housing": "rent", "notes": "Lives in Manchester."}).json()
    try:
        client.post(f"/api/users/{u['id']}/uploads", files={"file": ("s.csv", synthetic_statement(salary=1000, rent=550), "text/csv")})
        opts = support_options(_ctx_for(client, u["id"]))
        ids = {o["id"] for o in opts}
        assert {"universal_credit", "help_to_save"} <= ids
        uc = next(o for o in opts if o["id"] == "universal_credit")
        assert uc["link"].startswith("https://www.gov.uk/") and "£" in uc["why"]
        doc = support_doc(opts)
        assert "MAY suit" in doc and "never 'is eligible'" in doc
    finally:
        client.delete(f"/api/users/{u['id']}")


def test_students_with_no_recourse_to_public_funds_are_not_sent_to_benefits(client):
    from tests.conftest import synthetic_statement
    from app.services.chat.support import support_options
    u = client.post("/api/users", json={"name": "Flat 4", "address_as": "guys", "income_type": "student", "housing": "rent", "household_size": 4,
                                        "challenges": ["no_recourse_to_public_funds"], "notes": "International students in Manchester."}).json()
    try:
        client.post(f"/api/users/{u['id']}/uploads", files={"file": ("s.csv", synthetic_statement(salary=900, rent=1400), "text/csv")})
        ids = {o["id"] for o in support_options(_ctx_for(client, u["id"]))}
        assert "uni_hardship" in ids and "council_tax" in ids and "council_crisis_fund" in ids
        assert not ids & {"universal_credit", "help_to_save", "social_tariff", "warm_home_discount"}
        assert client.get(f"/api/users/{u['id']}").json()["address_as"] == "guys"
        r = client.post(f"/api/users/{u['id']}/chat", json={"messages": [{"role": "user", "content": "hi"}]}).json()
        assert r["mode"] == "offline"
    finally:
        client.delete(f"/api/users/{u['id']}")
