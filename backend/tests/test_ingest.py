from app.services.categories import categorise, merchant_key
from app.services.ingest import parse_csv


def test_kaggle_household_format_uses_debit_credit_column():
    csv = (b"Date,Description,Amount,Transaction Type,Category,Account Name\n"
           b"01/02/2018,Mortgage Payment,1247.44,debit,Mortgage & Rent,Checking\n"
           b"01/12/2018,Biweekly Paycheck,2000,credit,Paycheck,Checking\n"
           b"01/30/2018,Starbucks,3.5,debit,Coffee Shops,Platinum Card\n")
    p = parse_csv(csv)
    assert list(p.rows["amount"]) == [-1247.44, 2000.0, -3.5]
    # MM/DD detected because 30 appears in the second slot
    assert p.rows["date"].iloc[2].strftime("%Y-%m-%d") == "2018-01-30"
    assert set(p.rows["account"]) == {"Checking", "Platinum Card"}


def test_spending_only_tracker_is_treated_as_outflows():
    csv = b"date,category,amount\n2022-07-06 05:57:10 +0000,Restuarant,5.5\n2022-07-07 08:00:00 +0000,Coffe,3\n"
    p = parse_csv(csv)
    assert (p.rows["amount"] < 0).all()
    assert p.rows["description"].tolist() == ["Restuarant", "Coffe"]
    assert p.notes


def test_money_in_money_out_columns_and_uk_dates():
    csv = b"Date,Description,Money Out,Money In\n03/04/2025,Tesco,12.50,\n05/04/2025,Salary,,1800.00\n"
    p = parse_csv(csv)
    assert p.rows["amount"].tolist() == [-12.5, 1800.0]
    assert p.rows["date"].iloc[0].strftime("%Y-%m-%d") == "2025-04-03"  # DD/MM by default


def test_monzo_prefers_filled_name_column():
    csv = (b"Transaction ID,Date,Time,Type,Name,Category,Amount,Description\n"
           b"tx1,01/05/2025,10:00:00,Card payment,Pret A Manger,eating_out,-4.20,\n")
    p = parse_csv(csv)
    assert p.columns["description"] == "Name"
    assert p.rows["description"].iloc[0] == "Pret A Manger"


def test_categorise_rules():
    assert categorise("Credit Card Payment", "Credit Card Payment", 100) == ("Transfer", True)
    assert categorise("TESCO STORES 1234", None, -20)[0] == "Groceries"
    assert categorise("Netflix.com", None, -10.99)[0] == "Subscriptions"
    assert categorise("ACME LTD", None, 2000)[0] == "Income"
    assert categorise("Mystery", None, -5)[0] == "Other"
    assert merchant_key("CARD PAYMENT TO TESCO STORES 1234 REF:998877") == "tesco stores"
