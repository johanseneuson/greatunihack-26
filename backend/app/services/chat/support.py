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
    "visa": "Work & visa", "travel": "Travel discounts",
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


def _student_options(ctx: UserContext, fc: dict, res: dict) -> list[dict]:
    """International students on a Student visa have 'no recourse to public funds': no Universal Credit, Housing Benefit, Help to
    Save or the social tariffs that depend on them. What they can usually do is below (rules differ by university and council)."""
    u = ctx.user
    who = "you guys" if u.address_as else "you"
    local = "manchester" in (u.notes or "").lower()
    risk = fc["prob_overdraft"]["30d"]
    struggling = _met("Struggling to cover costs", f"{round(risk * 100)}% chance of going overdrawn in the next 30 days")
    visa = _met("Studying in the UK on a Student visa", "From your profile")
    out: list[dict] = []
    out.append(_item(
        "council_tax", "Council tax exemption for full-time students", "council",
        f"{who.capitalize()} share a house and all study full time. If everyone in the house is a full-time student, you should not pay council tax.",
        "Ask your university for a council tax certificate (proof of student status) and send it to the council. If any bill arrives, do not pay it before checking. Some councils ask international students for passport and visa details.",
        "", "Check your own council's student exemption page (in Manchester: manchester.gov.uk)." if local else "",
        checks=[visa, _unknown("Everyone in the house is a full-time student")], value="No council tax to pay", priority=95))
    out.append(_item(
        "student_work", "Part-time work allowed on your visa", "visa",
        "Your part-time pay and money from family do not cover rent, bills and food between you.",
        "A Student visa usually allows limited part-time work in term time (often up to 20 hours a week at degree level). Check your own visa conditions, and never go over the limit.",
        "https://www.gov.uk/student-visa/work", checks=[visa, _unknown("The work limit printed on your visa")], priority=45,
        link_label="Check your work rules"))
    out.append(_item(
        "uni_hardship", "Your university's hardship fund and money advice team", "student",
        f"Your forecast shows a {round(risk * 100)}% chance of going overdrawn in the next 30 days and your savings from home are running out, so it is worth asking now, before you miss rent.",
        "Most universities have a hardship fund and a free money or advice team, and many also run food support through the students' union. Hardship funds are not 'public funds', so international students can usually apply, but rules differ by university. Asking for help does not usually affect a visa; the advice team can confirm for your case.",
        "https://www.ukcisa.org.uk/student-advice/finances/unexpected-financial-hardship/",
        checks=[struggling, _met("Not a 'public fund'", "Usually open to students on visas"), _unknown("Your university's own criteria")],
        priority=100, link_label="How hardship funds work"))
    out.append(_item(
        "council_crisis_fund", "Ask the council about the Crisis and Resilience Fund", "council",
        f"With a {round(risk * 100)}% chance of going overdrawn soon, an emergency grant could stop a missed rent payment.",
        "Government money (it replaced the Household Support Fund in April 2026) that councils give to people in a crisis for essentials. Councils decide who qualifies and rules for students on visas differ, so ask rather than assume no.",
        "https://www.manchester.gov.uk/HSF" if local else "https://www.gov.uk/find-local-council",
        "In Manchester the council also runs a Welfare Provision Scheme for essential needs." if local else "",
        checks=[struggling, _unknown("Your council's rules for students on visas")], priority=85, link_label="See what your council offers"))
    debt = _find(ctx, r"klarna|clearpay|loan|overdraft|finance|credit")
    if debt or risk >= 0.5:
        out.append(_item(
            "debt_advice", "Free, confidential money advice (Citizens Advice)", "debt",
            ("You are paying " + debt.name + f" ({gbp(debt.amount)} {debt.period}) and " if debt else "") + "using the overdraft most months.",
            "Citizens Advice and the students' union advice service give free, confidential help with debts and budgeting and can explain what you can and cannot claim.",
            "https://www.citizensadvice.org.uk", "Never pay for debt advice.",
            checks=[_met("You have debt repayments", debt.name) if debt else struggling, _met("Free for everyone", "No eligibility rules for advice")],
            priority=75, link_label="Get free advice"))
    out.append(_item(
        "bank_support", "Ask your bank for hardship support", "bank",
        "You are likely to be overdrawn again soon.",
        "Tell your bank you are struggling. UK banks have to treat customers in financial difficulty fairly, and can offer a payment plan, a lower overdraft limit or paused charges.",
        "", checks=[struggling], priority=50))
    out.append(_item(
        "railcard", "16-25 Railcard (or student railcard)", "travel",
        "You spend on travel every week.",
        "Cheaper rail fares for 16 to 25 year olds and mature students. Worth it only if you take trains; buses and trams are not covered.",
        "https://www.16-25railcard.co.uk", checks=[_met("You travel regularly"), _unknown("Aged 16 to 25, or a mature full-time student")],
        value="A third off most rail fares", priority=40, link_label="See the railcard"))
    out.sort(key=lambda o: -o["priority"])
    return out


def _options(ctx: UserContext) -> list[dict]:
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
    if "no_recourse_to_public_funds" in (u.challenges or []):
        return _student_options(ctx, fc, res)
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


# How to apply for each scheme: what to do, the official page, and a message that can be sent as it is. Facts come from the
# person's own data; the wording is a template (no AI), so it can't invent anything.
APPLY_INFO = {
    "universal_credit": {"url": "https://www.gov.uk/apply-universal-credit", "steps": [
        "Check what you might get with a free benefits calculator first (Turn2us or Citizens Advice).",
        "Have ready: ID, bank details, your tenancy and rent, and your pay slips.",
        "Apply online on gov.uk, then book your first appointment."]},
    "crisis_fund": {"url": None, "steps": ["Open the council page and find the Crisis and Resilience Fund.", "Say what essentials you cannot pay for and by when.", "Keep your recent bank statements to hand."]},
    "rent_help": {"url": None, "steps": ["Contact the council housing benefit or welfare team.", "Say how much of your rent you cannot cover and for how long."]},
    "debt_advice": {"url": "https://www.stepchange.org", "steps": ["Open StepChange or Citizens Advice and start a free money check.", "List what you owe, to whom, and the monthly payments.", "Ask about Breathing Space if you are being chased."]},
    "social_tariff": {"url": "https://www.ofcom.org.uk/phones-and-broadband/saving-money/social-tariffs", "steps": ["Open Ofcom's list and pick your provider (or a cheaper one).", "Have your Universal Credit award letter ready as proof."]},
    "warm_home_discount": {"url": "https://www.gov.uk/the-warm-home-discount-scheme", "steps": ["Most people are picked automatically. Check on gov.uk whether your supplier is on the scheme.", "If you have not heard by winter, ask your supplier."]},
    "help_to_save": {"url": "https://www.gov.uk/get-help-savings-low-income", "steps": ["Check you get Universal Credit with earnings in your last assessment period.", "Open the account online with your Government Gateway or GOV.UK One Login."]},
    "bank_support": {"url": None, "steps": ["Open your banking app or call the number on your card and ask for the financial support team.", "Ask for a payment plan, a lower overdraft limit or charges paused."]},
    "uni_hardship": {"url": "https://www.ukcisa.org.uk/student-advice/finances/unexpected-financial-hardship/", "steps": [
        "Search your university site for 'hardship fund', or go to the students' union advice service.",
        "Gather: 3 months of bank statements, your tenancy agreement and a few lines explaining what changed.",
        "Send the message below and ask for an appointment."]},
    "council_tax": {"url": "https://www.gov.uk/find-local-council", "steps": [
        "Ask your university for a council tax exemption certificate (proof you are a full-time student).",
        "Send it to your council with the names of everyone in the house. If anyone is not a student, ask the council what applies.",
        "If a bill arrives, do not pay it until the council has your certificate."]},
    "council_crisis_fund": {"url": "https://www.manchester.gov.uk/HSF", "steps": [
        "Open the council page and read who can apply.", "If it is unclear for students on visas, email or call and ask. They decide, so asking costs nothing.",
        "Say what essentials you cannot pay for and by when."]},
    "student_work": {"url": "https://www.gov.uk/student-visa/work", "steps": ["Check the work conditions on your visa (hours and type of job).", "Never go over the limit."]},
    "railcard": {"url": "https://www.16-25railcard.co.uk", "steps": ["Buy online and have your photo and proof of age ready.", "Only worth it if you take trains."]},
    # Opportunity Finder schemes
    "council_tax_reduction": {"url": "https://www.gov.uk/apply-council-tax-reduction", "steps": [
        "Enter your postcode on gov.uk to reach your council's Council Tax Reduction page.",
        "Have ready: your pay slips or income, your rent or mortgage, and your savings.",
        "Apply online; it can be backdated in some councils, so ask."]},
    "single_person_discount": {"url": "https://www.gov.uk/council-tax/discounts-for-people-who-live-alone", "steps": [
        "Enter your postcode on gov.uk to reach your council.", "Tell them you are the only adult living there; most councils do this online in minutes."]},
    "hardship_fund": {"url": "https://www.gov.uk/extra-money-pay-university/university-and-college-hardship-funds", "steps": [
        "Search your university site for 'hardship fund', or go to the students' union advice service.",
        "Gather: 3 months of bank statements and a few lines explaining what changed.", "Apply before the deadline and ask for an appointment if unsure."]},
    "child_benefit": {"url": "https://www.gov.uk/child-benefit/how-to-claim", "steps": [
        "Claim online on gov.uk or in the HMRC app.", "Have ready: your child's birth certificate details and your bank details."]},
    "tax_free_childcare": {"url": "https://www.gov.uk/apply-for-tax-free-childcare", "steps": [
        "Check your childcare provider is signed up to Tax-Free Childcare.", "Apply online, then pay into the account and the government adds 25%.",
        "Reconfirm your details every 3 months."]},
    "nhs_low_income": {"url": "https://www.nhsbsa.nhs.uk/nhs-low-income-scheme", "steps": [
        "Apply online with the NHS Business Services Authority (form HC1).", "Have ready: your income, rent and savings details."]},
    "lifetime_isa": {"url": "https://www.gov.uk/lifetime-isa/how-to-open", "steps": [
        "Compare Lifetime ISA providers (banks, building societies and investment platforms).", "Open one before you turn 40 and save up to £4,000 a year.",
        "Remember: taking money out for a rental deposit costs 25%."]},
    "workplace_pension": {"url": "https://www.gov.uk/workplace-pensions/joining-a-workplace-pension", "steps": [
        "Check your payslip for a pension deduction.", "If there is none, ask your employer whether you have been enrolled or opted out.",
        "Opting back in means your employer pays in too."]},
}


def _draft(o_id: str, ctx: UserContext) -> str:
    u = ctx.user
    plural = u.household_size > 1
    we, our = ("we", "our") if plural else ("I", "my")
    who = f"{u.household_size} students" if plural and "student" in (u.income_type or "") else ("us" if plural else "me")
    rent = max((s for s in ctx.recurring if s.direction == "out" and s.active and s.group == "essential"), key=lambda s: s.amount, default=None)
    rent_line = f" Our biggest bill is {rent.name} at {gbp(rent.amount)}, next due {rent.next_date.strftime('%d %B')}." if rent and plural else (f" My biggest bill is {rent.name} at {gbp(rent.amount)}, next due {rent.next_date.strftime('%d %B')}." if rent else "")
    sign = f"\n\nThank you,\n{u.name}"
    situation = f"{we.capitalize()} have {gbp(ctx.balance)} in {our} account and expect to go overdrawn soon.{rent_line}"
    if o_id == "uni_hardship":
        return (f"Subject: Request for hardship support\n\nHello,\n\n{we.capitalize()} are {who} at the university living in Manchester. {situation} "
                f"{we.capitalize()} would like to apply for the hardship fund and book an appointment with the money advice team. "
                f"Please tell {'us' if plural else 'me'} what evidence {we} should bring.{sign}")
    if o_id == "council_tax":
        return (f"Subject: Council tax exemption certificate\n\nHello,\n\nCould you please send {'each of us' if plural else 'me'} a council tax exemption certificate showing "
                f"{'our names' if plural else 'my name'}, date of birth, course and start and end dates? {we.capitalize()} are full-time students sharing one house.{sign}")
    if o_id in ("council_crisis_fund", "crisis_fund", "rent_help"):
        return (f"Subject: Enquiry about the Crisis and Resilience Fund\n\nHello,\n\n{situation} Can you tell {'us' if plural else 'me'} whether {we} can apply for "
                f"emergency help with essentials, and how?{' We are international students on Student visas, so please confirm whether that affects eligibility.' if plural and 'student' in (u.income_type or '') else ''}{sign}")
    if o_id == "bank_support":
        return (f"Subject: I am struggling financially\n\nHello,\n\n{situation} Could you put {'us' if plural else 'me'} in touch with your financial support team? "
                f"{we.capitalize()} would like to discuss a payment plan, a lower overdraft limit and pausing charges.{sign}")
    return ""


def _enrich(options: list[dict], ctx: UserContext) -> list[dict]:
    local = "manchester" in (ctx.user.notes or "").lower()
    for o in options:
        info = APPLY_INFO.get(o["id"], {"url": None, "steps": []})
        url = info["url"] or o.get("link") or ("https://www.manchester.gov.uk/financialsupport" if local else "https://www.gov.uk/find-local-council")
        o["apply_url"], o["steps"], o["draft"] = url, info["steps"], _draft(o["id"], ctx)
    return options


def support_options(ctx: UserContext) -> list[dict]:
    """Programmes worth checking, with how to apply (steps, official page, a ready-to-send message)."""
    return _enrich(_options(ctx), ctx)


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
