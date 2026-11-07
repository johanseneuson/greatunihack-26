import pandas as pd

from app.services.analytics.recurring import detect_recurring


def _flows(dates, amount=-50.0, merchant="landlord"):
    return pd.DataFrame({
        "id": range(len(dates)), "date": pd.to_datetime(dates), "description": merchant.title(),
        "amount": amount, "category": "Housing", "group": "essential", "merchant": merchant,
    })


def test_monthly_bill_is_anchored_to_its_day_of_month():
    # Paid on the 1st every month: a fixed 30.44-day step would drift to the 30th/31st.
    dates = [f"2025-{m:02d}-01" for m in range(1, 11)]
    s = detect_recurring(_flows(dates), pd.Timestamp("2025-10-20"))[0]
    assert s.months_step == 1 and s.day_of_month == 1
    sched = s.schedule(pd.Timestamp("2025-10-21"), pd.Timestamp("2026-06-30"))
    assert all(d.day == 1 or d.weekday() == 0 for d in sched)  # the 1st, or rolled to Monday
    assert s.next_date == sched[0]


def test_weekend_payments_roll_to_monday_when_history_never_hits_weekends():
    # 15th of each month, moved to Monday when it fell on a weekend (like a UK direct debit)
    raw = pd.date_range("2025-01-15", periods=10, freq="MS") + pd.Timedelta(days=14)
    dates = [d + pd.Timedelta(days=(7 - d.weekday()) % 7) if d.weekday() >= 5 else d for d in raw]
    s = detect_recurring(_flows(dates), pd.Timestamp("2025-10-20"))[0]
    assert s.avoid_weekends
    assert all(d.weekday() < 5 for d in s.schedule(pd.Timestamp("2025-10-21"), pd.Timestamp("2026-12-31")))


def test_forecast_accuracy_endpoint(client, user_with_data):
    r = client.get(f"/api/users/{user_with_data['id']}/insights/forecast-accuracy").json()
    assert r["weeks"] == 12 and len(r["weekly"]) == 12
    assert 0 <= r["coverage_80"] <= 1 and r["mae_weekly"] >= 0
    # The synthetic statement is very regular, so the forecast should beat "use your average week"
    assert r["mae_weekly"] < r["naive_mae_weekly"]


def test_forecast_weeks_carry_range_and_paydays(client, user_with_data):
    w = client.get(f"/api/users/{user_with_data['id']}/insights/waves").json()
    fut = [s for s in w["series"] if s["kind"] == "forecast"]
    assert fut and all(s["p10"] <= s["outflow"] <= s["p90"] for s in fut)
    assert any(s["payday"] for s in fut)  # salary on the 28th falls inside some forecast week
