from app.services.analytics.debts import DebtIn, simulate
from tests.conftest import synthetic_statement


# ---------- Financial Support & Opportunity Finder ----------
def test_opportunities_for_a_low_income_renter(client):
    u = client.post("/api/users", json={"name": "Low Income", "income_type": "irregular", "housing": "rent", "household_size": 1,
                                         "dependents": 1}).json()
    try:
        client.post(f"/api/users/{u['id']}/uploads", files={"file": ("s.csv", synthetic_statement(salary=1000, rent=550), "text/csv")})
        r = client.get(f"/api/users/{u['id']}/insights/opportunities").json()
        ids = {o["id"] for o in r["options"]}
        assert {"universal_credit", "council_tax_reduction", "single_person_discount", "child_benefit"} <= ids
        assert r["summary"]["count"] == len(r["options"]) and r["summary"]["headline"].startswith("Lydia has found")
        for o in r["options"]:
            assert o["checks"], o["id"]  # every item explains which requirements look met and which to check
            assert all(c["status"] in ("met", "unknown", "not_met") for c in o["checks"])
            if o["link"]:
                assert o["link"].startswith("https://") and o["link_label"]
        uc = next(o for o in r["options"] if o["id"] == "universal_credit")
        assert any(c["status"] == "met" and "income" in c["label"].lower() for c in uc["checks"])
        assert any(c["status"] == "unknown" for c in uc["checks"])  # age / immigration status can't be seen in bank data
        assert [o["priority"] for o in r["options"]] == sorted((o["priority"] for o in r["options"]), reverse=True)
    finally:
        client.delete(f"/api/users/{u['id']}")


def test_well_off_saver_gets_relevant_not_benefit_suggestions(client, user_with_data):
    uid = user_with_data["id"]
    client.patch(f"/api/users/{uid}", json={"challenges": ["saving_for_deposit"], "housing": "rent"})
    ids = {o["id"] for o in client.get(f"/api/users/{uid}/insights/opportunities").json()["options"]}
    assert "lifetime_isa" in ids and "workplace_pension" in ids
    assert "universal_credit" not in ids and "council_tax_reduction" not in ids


# ---------- Future Self ----------
def test_debt_payoff_math():
    card = DebtIn(1, "Card", "credit_card", 1000.0, 24.0, 50.0)
    base, faster = simulate([card]), simulate([card], extra=50)
    assert base["months"] and faster["months"] < base["months"]
    assert faster["interest"] < base["interest"]
    # A minimum payment below the monthly interest never clears the debt
    assert simulate([DebtIn(2, "Bad", "credit_card", 5000.0, 30.0, 50.0)])["never"]
    # Avalanche: extra goes to the highest APR first, freed minimums roll over
    two = simulate([DebtIn(1, "Cheap", "loan", 500, 5, 20), DebtIn(2, "Dear", "credit_card", 500, 30, 20)], extra=100)
    assert two["cleared"][2] < two["cleared"][1]


def test_milestones_react_to_extra_payments(client, user_with_data):
    uid = user_with_data["id"]
    client.post(f"/api/users/{uid}/debts", json={"name": "Credit card", "balance": 1200, "apr": 22.9, "min_payment": 40})
    m0 = client.get(f"/api/users/{uid}/insights/milestones").json()
    m1 = client.get(f"/api/users/{uid}/insights/milestones", params={"extra": 100}).json()
    assert m1["debt"]["months_with_plan"] < m0["debt"]["months_with_plan"]
    assert m1["debt"]["interest_saved"] > 0
    assert m0["emergency"]["target"] > 0 and 0 <= m0["emergency"]["progress"] <= 1
    assert m0["payday"]["date"] and 0 <= m0["payday"]["prob_short_current"] <= 1
    assert m1["path"][0]["balance_with_plan"] < m0["path"][0]["balance_with_plan"]  # extra money leaves the account


def test_ask_future_self_rules_parser(client, user_with_data):
    uid = user_with_data["id"]
    client.post(f"/api/users/{uid}/debts", json={"name": "Card", "balance": 900, "apr": 20, "min_payment": 30})
    r = client.post(f"/api/users/{uid}/insights/future-self",
                    json={"question": "What happens if I pay an extra £50 towards my credit card each month?"}).json()
    assert r["source"] == "rules" and r["interpretation"]["extra_debt_payment"] == 50
    assert r["debt"]["date_new"] and "sooner" in r["answer"]
    r = client.post(f"/api/users/{uid}/insights/future-self", json={"question": "What if I cut eating out by 50% for 3 months?"}).json()
    assert r["interpretation"]["horizon_months"] == 3
    assert r["interpretation"]["changes"][0]["category"] == "Eating out"
    assert r["at_horizon"]["balance_new"] > r["at_horizon"]["balance_current"]
    r = client.post(f"/api/users/{uid}/insights/future-self", json={"question": "What will my finances look like in six months if I keep spending like this?"}).json()
    assert r["interpretation"]["horizon_months"] == 6 and not r["interpretation"]["changes"]
    assert "carry on" in r["answer"]
