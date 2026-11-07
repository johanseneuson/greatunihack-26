"""Financial Support & Opportunity Finder: real UK help the user may be able to get, matched to their own situation.

Proactive: the app shows these without being asked (Home), and Lydia uses the same list in chat.

This is a *signpost*, not a decision: the checks below are deliberately loose ("worth checking") and every item links to the
official body that decides. Each item carries an eligibility checklist built from the user's own data:
  met      - our data suggests this requirement is satisfied
  unknown  - we can't tell from bank data (age, immigration status, exact savings...) - the user should check
  not_met  - shown only when it explains why something is borderline
Facts were checked against gov.uk, Ofcom, NHSBSA and Manchester City Council pages; verify before relying on them
(rules, amounts and dates change)."""
import re

from ..analytics import insights as ins
from ..analytics.context import UserContext


def gbp(x: float) -> str:
    return ('-£' if x < 0 else '£') + f'{abs(x):,.2f}'


def gbp0(x: float) -> str:
    return ('-£' if x < 0 else '£') + f'{abs(x):,.0f}'


LOW_INCOME_MONTHLY = 1800  # rough: below this, a single renter is worth sending to a Universal Credit check
SAVINGS_LIMIT = 6000  # Universal Credit: savings above this reduce the payment (gov.uk); above 16,000 you can't claim
UC_SAVINGS_CAP = 16000
AUTO_ENROL_TRIGGER_YEAR = 10000  # workplace pension auto-enrolment earnings trigger (gov.uk)
QUALIFYING_EARNINGS_LOWER_YEAR = 6240  # lower limit of qualifying earnings used for minimum contributions (gov.uk)

CATEGORY_LABEL = {
    "benefit": "Benefits", "council": "Council help", "bills": "Cheaper bills", "savings": "Savings boosts",
    "work": "From your employer", "debt": "Debt help", "student": "Student support", "health": "Health costs", "bank": "Your bank",
}


def _met(label: str, detail: str = "") -> dict:
    return {"label": label, "status": "met", "detail": detail}


def _unknown(label: str, detail: str = "") -> dict:
    return {"label": label, "status": "unknown", "detail": detail}


def _not_met(label: str, detail: str = "") -> dict:
    return {"label": label, "status": "not_met", "detail": detail}


def _find(ctx: UserContext, pattern: str):
    return next((s for s in ctx.recurring if s.direction == "out" and s.active and re.search(pattern, s.name, re.I)), None)


def _item(id_, name, category, why, what, link, check="", checks=(), value=None, priority=50, link_label="Check your eligibility"):
    met = sum(c["status"] == "met" for c in checks)
    unknown = sum(c["status"] == "unknown" for c in checks)
    confidence = "strong" if checks and met >= 2 and unknown <= 1 and not any(c["status"] == "not_met" for c in checks) else "worth_checking"
    return {
        "id": id_, "name": name, "category": category, "category_label": CATEGORY_LABEL[category],
        "why": why, "what": what, "link": link, "link_label": link_label if link else "", "check": check,
        "checks": list(checks), "value": value, "confidence": confidence, "priority": priority,
    }


def support_options(ctx: UserContext) -> list[dict]:
    """Programmes worth checking for this person, most useful first. Each has why (from their data), what, link, checks."""
    if not ctx.has_data:
        return []
    u = ctx.user
    notes = (u.notes or "").lower()
    challenges = set(u.challenges or [])
    local = "manchester" in notes
    council = "Manchester City Council" if local else "your local council"
    income, balance = ctx.monthly_income, ctx.balance
    yearly = income * 12
    fc = ins.forecast(ctx).summary()
    res = ins.resilience(ctx) or {}
    overdraft_risk = fc["prob_overdraft"]["30d"]
    renting = (u.housing or "") in ("rent", "family")
    student = u.income_type == "student" or "student" in challenges or "student" in notes
    irregular = u.income_type in ("irregular", "mixed") or "irregular_income" in challenges
    working = u.income_type in ("salary", "irregular", "mixed") and income > 0
    income_seen = {"detected": "from your account", "declared": "from your profile", "average": "from your account"}.get(ctx.income_source, "")
    out: list[dict] = []

    # ---------- Benefits ----------
    uc = income < LOW_INCOME_MONTHLY and balance < SAVINGS_LIMIT
    if uc:
        pay = "it changes with your shifts" if irregular else "it is on the low side"
        out.append(_item(
            "universal_credit", "Universal Credit", "benefit",
            f"You earn about {gbp(income)} a month and {pay}" + (", and you rent" if renting else "")
            + f". Universal Credit can top up low or irregular pay and can include help with rent. Your savings are well under {gbp0(SAVINGS_LIMIT)}, where savings start to reduce it.",
            "Monthly payment for people on a low income, in or out of work, aged 18 or over (a free benefits calculator shows what you might get).",
            "https://www.gov.uk/universal-credit", "Free calculators: Turn2us (turn2us.org.uk) or Citizens Advice (citizensadvice.org.uk).",
            checks=[
                _met("Low income", f"About {gbp0(income)} a month {income_seen}".strip()),
                _met("Savings under £16,000", f"Your balance is {gbp0(balance)}; savings above {gbp0(SAVINGS_LIMIT)} reduce the payment"),
                _unknown("Aged 18 or over and under State Pension age"),
                _unknown("Living in the UK with the right immigration status"),
            ] + ([_met("You pay rent", "Universal Credit can include help with housing costs")] if renting else []),
            value="Depends on your circumstances - a calculator gives an estimate", priority=100))

    if u.dependents:
        out.append(_item(
            "child_benefit", "Child Benefit", "benefit",
            f"You told us you have {u.dependents} dependent{'s' if u.dependents > 1 else ''}. Child Benefit is paid for each child under 16 (or under 20 in approved education or training), and claiming also protects your National Insurance record.",
            "Paid every 4 weeks by HMRC. If anyone in the household earns over the High Income Child Benefit Charge threshold, some or all of it is repaid through tax - but it is usually still worth claiming.",
            "https://www.gov.uk/child-benefit",
            checks=[_met("You have dependents", f"{u.dependents} in your profile"), _unknown("Each child is under 16, or under 20 in approved education"),
                    _unknown("You are responsible for the child and live with them")],
            priority=85))
        if working:
            out.append(_item(
                "tax_free_childcare", "Tax-Free Childcare", "benefit",
                "You work and have dependents. For every £8 you pay into a childcare account, the government adds £2.",
                "Up to £2,000 a year per child (£4,000 if disabled) towards approved childcare. You can't get it at the same time as Universal Credit childcare costs.",
                "https://www.gov.uk/tax-free-childcare",
                checks=[_met("You are working", f"Income about {gbp0(income)} a month"), _met("You have dependents"),
                        _unknown("Children are 11 or under (16 if disabled)"), _unknown("You use approved childcare")],
                value="Up to £2,000 a year per child", priority=60))

    # ---------- Council help ----------
    if overdraft_risk >= 0.5 or res.get("score", 100) < 45:
        out.append(_item(
            "crisis_fund", "Crisis and Resilience Fund (local council help)", "council",
            f"Your forecast shows a {round(overdraft_risk * 100)}% chance of going overdrawn in the next 30 days and a resilience score of {res.get('score', '?')} out of 100, so essentials are at risk.",
            f"Replaced the Household Support Fund in England from 1 April 2026. {council} decides who gets help with essentials and housing costs, so rules differ by council.",
            "https://www.manchester.gov.uk/HSF" if local else "https://www.gov.uk/find-local-council",
            "Manchester City Council also runs a Welfare Provision Scheme for essential needs: manchester.gov.uk/financialsupport." if local else "",
            checks=[_met("Struggling with essentials", f"{round(overdraft_risk * 100)}% chance of going overdrawn in 30 days"),
                    _unknown("You live in England (council rules differ)"), _unknown("Your council's own criteria")],
            priority=90, link_label="See what your council offers"))

    if renting and uc:
        out.append(_item(
            "rent_help", "Extra help with rent", "council",
            "You rent and your income is low. If Universal Credit includes housing costs and your rent is not fully covered, councils can sometimes give extra help.",
            f"Ask {council} about help with a rent shortfall (this has been the Discretionary Housing Payment, now part of local crisis support).",
            "https://www.manchester.gov.uk/financialsupport" if local else "https://www.gov.uk/government/organisations/department-for-work-pensions",
            checks=[_met("You rent"), _met("Low income", f"About {gbp0(income)} a month"), _unknown("You get Universal Credit or Housing Benefit")],
            priority=70, link_label="Ask about help with rent"))

    if income < LOW_INCOME_MONTHLY and (u.housing or "") in ("rent", "mortgage"):
        out.append(_item(
            "council_tax_reduction", "Council Tax Reduction", "council",
            f"Your income is about {gbp(income)} a month. Councils cut Council Tax bills - sometimes to nothing - for people on a low income, whether you rent or own.",
            "Also called Council Tax Support. Each council sets its own scheme, so the amount varies by area.",
            "https://www.gov.uk/apply-council-tax-reduction",
            checks=[_met("Low income", f"About {gbp0(income)} a month"), _met("You pay housing costs", "Rent or mortgage"),
                    _unknown("You are the person liable for Council Tax"), _unknown("Your savings are under your council's limit (often £16,000)")],
            priority=80))

    if u.household_size == 1:
        out.append(_item(
            "single_person_discount", "Council Tax single person discount", "council",
            "Your profile says you live on your own. If no other adult lives with you, your Council Tax bill can be cut by 25%.",
            "Ask your council - it applies whatever your income, and you can usually claim it online.",
            "https://www.gov.uk/council-tax/discounts-for-people-who-live-alone",
            checks=[_met("You live alone", "Household size 1 in your profile"), _unknown("You are the person who pays the Council Tax")],
            value="25% off your Council Tax bill", priority=75, link_label="Apply to your council"))

    # ---------- Student support ----------
    if student:
        out.append(_item(
            "hardship_fund", "University or college hardship fund", "student",
            "You are a student" + (f" and your forecast shows a {round(overdraft_risk * 100)}% chance of going overdrawn soon" if overdraft_risk >= 0.2 else "")
            + ". Universities and colleges have hardship funds for students struggling with living costs - usually grants you don't pay back.",
            "Apply through your university or college's student support or money advice team. Each one sets its own rules and deadlines.",
            "https://www.gov.uk/extra-money-pay-university/university-and-college-hardship-funds",
            checks=[_met("You are studying", "From your profile"), _unknown("Your university's own criteria and deadlines")],
            priority=88, link_label="See how hardship funds work"))

    # ---------- Cheaper bills ----------
    bb = _find(ctx, r"broadband|internet|virgin|\bbt\b|sky")
    if uc and bb:
        out.append(_item(
            "social_tariff", "Cheaper broadband (social tariff)", "bills",
            f"You pay {gbp(bb.amount)} a month for broadband ({bb.name}). If you get Universal Credit you could move to a much cheaper social tariff with the same speed band.",
            "Offered by the broadband companies (BT, Virgin Media and others) to people on Universal Credit and some other benefits; Ofcom keeps the list of providers.",
            "https://www.ofcom.org.uk/phones-and-broadband/saving-money/social-tariffs",
            checks=[_met("You pay for broadband", f"{gbp0(bb.amount)} a month"), _unknown("You get Universal Credit or another qualifying benefit")],
            value=f"Many social tariffs cost less than your {gbp0(bb.amount)} a month", priority=65, link_label="Compare social tariffs"))

    energy = _find(ctx, r"energy|octopus|edf|ovo|british gas|e\.on|electric|\bgas\b")
    if uc and energy:
        out.append(_item(
            "warm_home_discount", "Warm Home Discount", "bills",
            f"You pay {gbp(energy.amount)} a month for energy ({energy.name}). People on a low income who get Universal Credit may get a one-off discount off their winter electricity bill.",
            "Most eligible households are found automatically by the DWP and the energy supplier, so you usually do not apply. The supplier must be on the scheme.",
            "https://www.gov.uk/the-warm-home-discount-scheme", "Check the current year's rules on gov.uk.",
            checks=[_met("You pay an energy bill", energy.name), _unknown("You get a qualifying benefit such as Universal Credit"),
                    _unknown("Your supplier is part of the scheme")],
            priority=60))

    if income < LOW_INCOME_MONTHLY:
        out.append(_item(
            "nhs_low_income", "Help with health costs (NHS Low Income Scheme)", "health",
            f"Your income is about {gbp(income)} a month. The NHS Low Income Scheme can give free or cheaper prescriptions, dental treatment, eye tests and glasses.",
            "Apply to the NHS Business Services Authority for an HC2 (full help) or HC3 (partial help) certificate. Some people get this automatically through Universal Credit.",
            "https://www.nhsbsa.nhs.uk/nhs-low-income-scheme",
            checks=[_met("Low income", f"About {gbp0(income)} a month"), _unknown("Your savings are under the scheme limit"),
                    _unknown("You live in England (Scotland and Wales have free prescriptions)")],
            priority=45))

    # ---------- Savings boosts ----------
    if uc:
        out.append(_item(
            "help_to_save", "Help to Save", "savings",
            "If you are working and get Universal Credit, you may be able to save up to a small amount each month and get a government bonus, which could help you build the emergency buffer you are aiming for.",
            "A savings account run by the government with a 50% bonus after two and four years. Check the current opening dates and rules.",
            "https://www.gov.uk/get-help-savings-low-income",
            checks=[_met("You are working", f"Income about {gbp0(income)} a month") if working else _unknown("You are working"),
                    _unknown("You get Universal Credit")],
            value="50% government bonus on what you save", priority=72))

    goal_names = " ".join(g.name.lower() for g in u.goals)
    first_home = "saving_for_deposit" in challenges or re.search(r"deposit|first home|house|flat", goal_names)
    if first_home and (u.housing or "") != "mortgage":
        out.append(_item(
            "lifetime_isa", "Lifetime ISA (25% bonus for a first home)", "savings",
            "You are saving for a home" + (" (rental deposit goal)" if "rental" in goal_names else "")
            + ". A Lifetime ISA adds a 25% government bonus to what you save - up to £1,000 a year - when it goes towards your first home or retirement.",
            "Open between 18 and 39 and save up to £4,000 a year. Withdrawing for anything else (including a rental deposit) costs a 25% charge, so it suits buying, not renting.",
            "https://www.gov.uk/lifetime-isa",
            checks=[_met("Saving towards a home", "From your goals"), _met("No mortgage yet", "First-time buyers only"),
                    _unknown("Aged 18 to 39 to open one"), _unknown("The home will cost £450,000 or less")],
            value="Up to £1,000 a year bonus", priority=68, link_label="See how a Lifetime ISA works"))

    # ---------- From your employer ----------
    if working and yearly >= AUTO_ENROL_TRIGGER_YEAR:
        employer_monthly = max(0.0, (yearly - QUALIFYING_EARNINGS_LOWER_YEAR) * 0.03 / 12)
        out.append(_item(
            "workplace_pension", "Employer pension contributions", "work",
            f"You earn about {gbp0(yearly)} a year, above the {gbp0(AUTO_ENROL_TRIGGER_YEAR)} point where your employer must enrol you in a workplace pension and pay in at least 3% of qualifying earnings"
            + f" - roughly {gbp0(employer_monthly)} a month of extra money on top of your pay. If you've opted out, you are giving that up.",
            "Check your payslip for a pension deduction. If there isn't one, ask your employer. Workers aged 22 to State Pension age are enrolled automatically.",
            "https://www.gov.uk/workplace-pensions",
            checks=[_met("Earning over £10,000 a year", f"About {gbp0(yearly)} {income_seen}".strip()),
                    _met("You are employed") if u.income_type == "salary" else _unknown("You are employed (not self-employed)"),
                    _unknown("Aged 22 to State Pension age"), _unknown("You haven't opted out")],
            value=f"About {gbp0(employer_monthly)} a month from your employer (minimum)", priority=55,
            link_label="Check your workplace pension"))

    # ---------- Debt help & your bank ----------
    debt = _find(ctx, r"klarna|clearpay|loan|overdraft|finance|credit")
    if debt or overdraft_risk >= 0.5 or "debt" in challenges:
        out.append(_item(
            "debt_advice", "Free debt advice and Breathing Space", "debt",
            ("You are paying " + debt.name + f" ({gbp(debt.amount)} {debt.period}) and " if debt else "")
            + ("using your overdraft most months, so" if overdraft_risk >= 0.5 else "carrying debt, so") + " a free adviser can help you get ahead of it.",
            "StepChange, Citizens Advice and MoneyHelper give free, confidential help. Breathing Space can pause creditor action and interest for up to 60 days for people in problem debt (you apply through a debt adviser).",
            "https://www.stepchange.org", "Also: moneyhelper.org.uk and gov.uk/debt-respite-scheme-breathing-space. Never pay for debt advice.",
            checks=[_met("You have debt repayments", debt.name) if debt else _unknown("You have debts you're struggling with"),
                    _met("Free for everyone", "No eligibility rules for advice")],
            priority=78, link_label="Get free debt advice"))

    if overdraft_risk >= 0.5:
        out.append(_item(
            "bank_support", "Ask your bank for hardship support", "bank",
            "You are likely to be overdrawn again soon.",
            "Tell your bank you are struggling. UK banks have to treat customers in financial difficulty fairly, and can offer a payment plan, a lower overdraft limit or paused charges.",
            "", checks=[_met("At risk of going overdrawn", f"{round(overdraft_risk * 100)}% in the next 30 days")], priority=40))

    out.sort(key=lambda o: -o["priority"])
    return out


def support_summary(options: list[dict]) -> dict:
    """Headline for the proactive 'Lydia has found possible support' card."""
    cats = sorted({o["category_label"] for o in options})
    return {
        "count": len(options),
        "strong": sum(o["confidence"] == "strong" for o in options),
        "categories": cats,
        "headline": "Lydia has found possible support" if options else "No new support found right now",
        "intro": ("Based on your circumstances, you may be eligible for additional financial support. These are signposts to check, "
                  "not decisions: the organisation named decides." if options else
                  "We'll keep checking as your situation changes. Free help is always available from Citizens Advice and MoneyHelper."),
    }


def support_doc(options: list[dict]) -> str:
    if not options:
        return "No specific schemes matched from the data we hold. For general help: Citizens Advice, MoneyHelper, StepChange."
    lines = [
        "Support that MAY suit this person, matched to their data. These are signposts to check, not decisions: the organisation named decides eligibility. Say 'may be eligible', never 'is eligible', and never promise an amount."
    ]
    for o in options:
        unknown = [c["label"] for c in o.get("checks", []) if c["status"] == "unknown"]
        lines.append(f"- {o['name']}. Why it may suit them: {o['why']} What it is: {o['what']}"
                     + (f" Official link: {o['link']}" if o["link"] else "") + (f" {o['check']}" if o["check"] else "")
                     + (f" Still to check: {'; '.join(unknown)}." if unknown else ""))
    return "\n".join(lines)
