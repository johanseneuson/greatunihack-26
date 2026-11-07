from datetime import date, timedelta

from tests.conftest import synthetic_statement


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_reupload_is_deduplicated(client, user_with_data):
    r = client.post(f"/api/users/{user_with_data['id']}/uploads",
                    files={"file": ("statement.csv", synthetic_statement(), "text/csv")})
    assert r.json()["imported"] == 0 and r.json()["duplicates_skipped"] > 0


def test_recurring_detection(client, user_with_data):
    rec = {r["name"]: r for r in client.get(f"/api/users/{user_with_data['id']}/insights/recurring").json()}
    assert rec["ACME LTD SALARY"]["period"] == "monthly" and rec["ACME LTD SALARY"]["direction"] == "in"
    assert rec["Rent - Landlord"]["amount"] == 900
    assert rec["Vodafone"]["category"] == "Bills & Utilities"
    assert "Costa Coffee" not in rec  # daily habit, not a bill


def test_forecast_shape_and_probabilities(client, user_with_data):
    f = client.get(f"/api/users/{user_with_data['id']}/insights/forecast", params={"horizon_days": 90}).json()
    assert len(f["daily"]) == 90
    day = f["daily"][-1]
    assert day["p10"] <= day["p50"] <= day["p90"]
    assert 0 <= f["summary"]["prob_overdraft"]["30d"] <= f["summary"]["prob_overdraft"]["90d"] <= 1
    assert any(e["kind"] == "income" for e in f["scheduled"])


def test_dashboard_has_every_section(client, user_with_data):
    d = client.get(f"/api/users/{user_with_data['id']}/insights/dashboard").json()
    for key in ("overview", "resilience", "forecast", "waves", "warnings", "budget", "time_travel", "history"):
        assert key in d, key
    assert 0 <= d["resilience"]["score"] <= 100
    assert d["overview"]["income_source"] == "detected"
    assert all(w["severity"] in ("critical", "warning", "info", "positive") for w in d["warnings"])
    assert d["budget"]["safe_to_spend"]["today"] >= 0


def test_big_one_off_shows_as_past_wave(client, user_with_data):
    waves = client.get(f"/api/users/{user_with_data['id']}/insights/waves").json()
    assert any(any(dr["category"] == "Shopping" for dr in w["drivers"]) for w in waves["past_waves"])
    # Rent week must not count as a wave: it's regular rhythm
    assert all(all(dr["category"] != "Housing" for dr in w["drivers"]) for w in waves["past_waves"])


def test_scenario_cut_improves_future(client, user_with_data):
    r = client.post(f"/api/users/{user_with_data['id']}/insights/scenarios", json={
        "adjustments": [{"type": "category", "category": "Eating out", "change_pct": -50}], "horizon_days": 200})
    d = r.json()
    assert r.status_code == 200
    assert d["difference_at"]["6"] > 0


def test_scenario_one_off_cost_reduces_balance(client, user_with_data):
    when = (date.today() + timedelta(days=20)).isoformat()
    d = client.post(f"/api/users/{user_with_data['id']}/insights/scenarios", json={
        "adjustments": [{"type": "one_off", "amount": -1000, "date": when, "label": "Car repair"}]}).json()
    assert d["difference_at"]["1"] < -900


def test_profile_drives_personalisation(client, user_with_data):
    uid = user_with_data["id"]
    before = client.get(f"/api/users/{uid}/insights/overview").json()["buffer_target"]
    client.patch(f"/api/users/{uid}", json={"income_type": "irregular", "dependents": 2, "savings_buffer_target": None})
    after = client.get(f"/api/users/{uid}/insights/overview").json()["buffer_target"]
    assert after > before  # irregular income + dependents => bigger safety buffer


def test_goals_timeline(client, user_with_data):
    uid = user_with_data["id"]
    client.post(f"/api/users/{uid}/goals", json={"name": "Laptop", "target_amount": 800,
                                                  "target_date": (date.today() + timedelta(days=200)).isoformat()})
    goals = client.get(f"/api/users/{uid}/insights/time-travel").json()["goals"]
    assert goals[0]["name"] == "Laptop" and goals[0]["message"]


def test_recategorise_invalidates_cache(client, user_with_data):
    uid = user_with_data["id"]
    txn = client.get(f"/api/users/{uid}/transactions", params={"search": "Currys"}).json()[0]
    client.patch(f"/api/users/{uid}/transactions/{txn['id']}", json={"category": "Home"})
    cats = {c["category"] for c in client.get(f"/api/users/{uid}/insights/history").json()["categories_90d"]}
    assert "Home" in cats or txn["date"] < (date.today() - timedelta(days=90)).isoformat()


def test_coach_rule_based_fallback(client, user_with_data):
    d = client.post(f"/api/users/{user_with_data['id']}/insights/coach", json={}).json()
    assert d["source"] == "rules" and d["headline"] and isinstance(d["actions"], list)


def test_empty_user_and_errors(client):
    u = client.post("/api/users", json={"name": "Nobody"}).json()
    assert client.get(f"/api/users/{u['id']}/insights/dashboard").json()["empty"] is True
    assert client.post(f"/api/users/{u['id']}/uploads", files={"file": ("x.csv", b"a,b\n1,2\n", "text/csv")}).status_code == 422
    assert client.get("/api/users/99999/insights/dashboard").status_code == 404
    client.delete(f"/api/users/{u['id']}")
