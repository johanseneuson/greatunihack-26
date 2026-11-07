"""Canonical categories + mapping from bank/Kaggle categories and merchant keywords."""
import re

# category -> group. Groups drive budgets: essential (needs), discretionary (wants), income, savings, transfer.
CATEGORIES: dict[str, str] = {
    "Income": "income",
    "Housing": "essential",
    "Bills & Utilities": "essential",
    "Groceries": "essential",
    "Transport": "essential",
    "Insurance": "essential",
    "Health": "essential",
    "Education": "essential",
    "Childcare": "essential",
    "Debt repayment": "essential",
    "Eating out": "discretionary",
    "Coffee & snacks": "discretionary",
    "Shopping": "discretionary",
    "Entertainment": "discretionary",
    "Subscriptions": "discretionary",
    "Personal care": "discretionary",
    "Home": "discretionary",
    "Travel": "discretionary",
    "Gifts & donations": "discretionary",
    "Cash": "discretionary",
    "Other": "discretionary",
    "Savings": "savings",
    "Transfer": "transfer",
}

# How easy a category is to trim (0 = fixed, 1 = very flexible). Used when suggesting budget cuts.
FLEXIBILITY: dict[str, float] = {
    "Eating out": 1.0, "Coffee & snacks": 1.0, "Shopping": 0.9, "Entertainment": 0.9, "Subscriptions": 0.8,
    "Travel": 0.7, "Home": 0.6, "Gifts & donations": 0.5, "Cash": 0.5, "Other": 0.5, "Personal care": 0.4,
    "Groceries": 0.25, "Transport": 0.2, "Bills & Utilities": 0.1,
}

# Raw categories seen in Kaggle datasets and UK bank exports (Monzo, Starling, Revolut...) -> canonical.
RAW_MAP: dict[str, str] = {
    # Kaggle: bukolafatunde/personal-finance
    "paycheck": "Income", "mortgage & rent": "Housing", "utilities": "Bills & Utilities", "internet": "Bills & Utilities",
    "mobile phone": "Bills & Utilities", "television": "Subscriptions", "music": "Subscriptions", "groceries": "Groceries",
    "gas & fuel": "Transport", "auto insurance": "Insurance", "restaurants": "Eating out", "fast food": "Eating out",
    "food & dining": "Eating out", "alcohol & bars": "Eating out", "coffee shops": "Coffee & snacks", "shopping": "Shopping",
    "electronics & software": "Shopping", "movies & dvds": "Entertainment", "entertainment": "Entertainment",
    "haircut": "Personal care", "home improvement": "Home", "credit card payment": "Transfer",
    # Kaggle: ismetsemedov/personal-budget-transactions-dataset
    "market": "Groceries", "coffe": "Coffee & snacks", "restuarant": "Eating out", "business lunch": "Eating out",
    "transport": "Transport", "taxi": "Transport", "phone": "Bills & Utilities", "communal": "Bills & Utilities",
    "learning": "Education", "health": "Health", "events": "Entertainment", "clothing": "Shopping", "sport": "Personal care",
    "joy": "Entertainment", "tech": "Shopping", "business_expenses": "Other", "travel": "Travel", "fuel": "Transport",
    "film/enjoyment": "Entertainment", "other": "Other",
    # Monzo / Starling / generic
    "eating_out": "Eating out", "eating out": "Eating out", "bills": "Bills & Utilities", "holidays": "Travel",
    "general": "Other", "expenses": "Other", "personal_care": "Personal care", "personal care": "Personal care",
    "family": "Childcare", "charity": "Gifts & donations", "gifts": "Gifts & donations", "cash": "Cash",
    "income": "Income", "salary": "Income", "savings": "Savings", "transfers": "Transfer", "transfer": "Transfer",
    "rent": "Housing", "mortgage": "Housing", "insurance": "Insurance", "subscriptions": "Subscriptions",
    "education": "Education", "childcare": "Childcare", "debt": "Debt repayment", "loans": "Debt repayment",
}

# Description keyword rules (first match wins). Applied when the raw category is missing/unknown.
KEYWORD_RULES: list[tuple[str, str]] = [
    (r"credit card payment|card repayment|transfer (to|from)|to pot|from pot|own account|internal transfer|amex payment", "Transfer"),
    (r"salary|payroll|paycheck|wages|hmrc|student finance|universal credit|child benefit|dividend|refund", "Income"),
    (r"savings|isa|vanguard|moneybox|plum|chip", "Savings"),
    (r"\brent\b|mortgage|letting|estate agent|council tax", "Housing"),
    (r"tesco|sainsbury|asda|aldi|lidl|morrisons|waitrose|co-?op|ocado|iceland|m&s food|grocery|market", "Groceries"),
    (r"netflix|spotify|disney|prime video|amazon prime|apple\.com/bill|youtube premium|now tv|xbox|playstation|audible|patreon", "Subscriptions"),
    (r"\bgym\b|puregym|the gym group|fitness", "Personal care"),
    (r"uber(?! ?eats)|bolt|tfl|trainline|national rail|stagecoach|arriva|bee network|shell|bp |esso|parking|petrol|fuel|taxi", "Transport"),
    (r"deliveroo|uber ?eats|just ?eat|mcdonald|kfc|nando|greggs|pret|restaurant|pizza|burger|pub|bar\b|takeaway", "Eating out"),
    (r"starbucks|costa|caffe nero|coffee|cafe", "Coffee & snacks"),
    (r"octopus|british gas|edf|e\.on|ovo|thames water|united utilities|water|electric|energy|vodafone|\bee\b|o2|three|giffgaff|bt |virgin media|sky |broadband|tv licen", "Bills & Utilities"),
    (r"insurance|aviva|admiral|direct line|axa", "Insurance"),
    (r"pharmacy|boots|nhs|dentist|optician|doctor|clinic", "Health"),
    (r"amazon|argos|ebay|asos|primark|zara|h&m|ikea|john lewis|currys|apple store", "Shopping"),
    (r"cinema|odeon|vue|cineworld|ticketmaster|steam|concert|theatre", "Entertainment"),
    (r"ryanair|easyjet|british airways|airbnb|booking\.com|hotel|expedia", "Travel"),
    (r"klarna|clearpay|loan|finance payment|overdraft", "Debt repayment"),
    (r"nursery|childcare|school", "Childcare"),
    (r"tuition|udemy|coursera|university", "Education"),
    (r"atm|cash withdrawal", "Cash"),
]
_COMPILED = [(re.compile(p, re.I), c) for p, c in KEYWORD_RULES]


def group_of(category: str) -> str:
    return CATEGORIES.get(category, "discretionary")


def categorise(description: str, raw_category: str | None, amount: float) -> tuple[str, bool]:
    """Return (canonical_category, is_transfer)."""
    cat = None
    if isinstance(raw_category, str) and raw_category.strip():
        raw = raw_category.strip().lower()
        cat = RAW_MAP.get(raw) or next((c for c in CATEGORIES if c.lower() == raw), None)
    if cat is None and description:
        cat = next((c for rx, c in _COMPILED if rx.search(description)), None)
    if cat is None:
        cat = "Income" if amount > 0 else "Other"
    # Money coming in tagged with a spending category is a refund: keep the category so it nets off spend.
    return cat, cat == "Transfer"


_NOISE = re.compile(r"(card payment to|direct debit to|payment to|faster payment|standing order|pos|ref[:\s]\S+|\d{2,}|[^\w\s&])", re.I)


def merchant_key(description: str) -> str:
    """Normalise a description into a stable merchant key for grouping recurring payments."""
    s = _NOISE.sub(" ", (description or "").lower())
    tokens = [t for t in s.split() if len(t) > 1][:4]
    return " ".join(tokens) or (description or "").lower().strip()
