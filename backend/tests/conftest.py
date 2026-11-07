import os
import tempfile
from datetime import date, timedelta

import pytest

# Isolated DB and no demo seeding/network for tests - must be set before the app is imported.
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["SEED_DEMO_USERS"] = "false"
os.environ["COACH_ENABLED"] = "false"
os.environ["SIMULATIONS"] = "300"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def synthetic_statement(days: int = 240, salary: float = 2000.0, rent: float = 900.0, end: date | None = None) -> bytes:
    """A UK-style statement: monthly salary + rent + phone, daily groceries/coffee, a quarterly bill and a big one-off."""
    end = end or date.today() - timedelta(days=1)
    start = end - timedelta(days=days - 1)
    lines = ["Date,Description,Amount,Category"]
    for i in range(days):
        d = start + timedelta(days=i)
        if d.day == 28:
            lines.append(f"{d:%d/%m/%Y},ACME LTD SALARY,{salary:.2f},Income")
        if d.day == 1:
            lines.append(f"{d:%d/%m/%Y},Rent - Landlord,-{rent:.2f},Rent")
        if d.day == 5:
            lines.append(f"{d:%d/%m/%Y},Vodafone,-25.00,")
        if d.day == 10 and d.month in (1, 4, 7, 10):
            lines.append(f"{d:%d/%m/%Y},Water Rates Quarterly,-120.00,")
        lines.append(f"{d:%d/%m/%Y},Tesco Stores,-{12 + (i * 7) % 9:.2f},")
        if d.weekday() < 5:
            lines.append(f"{d:%d/%m/%Y},Costa Coffee,-3.40,")
        if d.weekday() == 5:
            lines.append(f"{d:%d/%m/%Y},Nandos,-{25 + i % 5:.2f},")
        if i == days // 2:
            lines.append(f"{d:%d/%m/%Y},Currys PC World,-650.00,")
    return "\n".join(lines).encode()


@pytest.fixture()
def user_with_data(client):
    u = client.post("/api/users", json={"name": "Sam Tester", "current_balance": 1500, "income_type": "salary"}).json()
    r = client.post(f"/api/users/{u['id']}/uploads", files={"file": ("statement.csv", synthetic_statement(), "text/csv")})
    assert r.status_code == 200, r.text
    yield u
    client.delete(f"/api/users/{u['id']}")
