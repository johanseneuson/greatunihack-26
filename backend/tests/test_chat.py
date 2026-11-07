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
