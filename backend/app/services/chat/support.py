"""Real UK support the user may be able to get, matched to their own situation (income, housing, debts, forecast).

This is a *signpost*, not a decision: the checks below are deliberately loose ("worth checking") and every item links to the
official body that decides. Facts were checked against gov.uk, Ofcom and Manchester City Council pages; verify before relying
on them (rules and dates change)."""
import re

from ..analytics import insights as ins
from ..analytics.context import UserContext


def gbp(x: float) -> str:
    return ('-£' if x < 0 else '£') + f'{abs(x):,.2f}'

LOW_INCOME_MONTHLY = 1800  # rough: below this, a single renter is worth sending to a Universal Credit check
SAVINGS_LIMIT = 6000  # Universal Credit: savings above this reduce the payment (gov.uk); above 16,000 you can't claim


def _find(ctx: UserContext, pattern: str):
    return next((s for s in ctx.recurring if s.direction == "out" and s.active and re.search(pattern, s.name, re.I)), None)


def _student_options(ctx: UserContext, fc: dict, res: dict) -> list[dict]:
    """International students on a Student visa have 'no recourse to public funds': no Universal Credit, Housing Benefit, Help to
    Save or the social tariffs that depend on them. What they can usually do is below (rules differ by university and council)."""
    u = ctx.user
    who = "you guys" if u.address_as else "you"
    local = "manchester" in (u.notes or "").lower()
    risk = fc["prob_overdraft"]["30d"]
    out: list[dict] = []
    out.append({
        "id": "council_tax", "name": "Council tax exemption for full-time students",
        "why": f"{who.capitalize()} share a house and all study full time. If everyone in the house is a full-time student, you should not pay council tax.",
        "what": "Ask your university for a council tax certificate (proof of student status) and send it to the council. If any bill arrives, do not pay it before checking. Some councils ask international students for passport and visa details.",
        "link": "", "check": "Check your own council's student exemption page (in Manchester: manchester.gov.uk)." if local else ""})
    out.append({
        "id": "uni_hardship", "name": "Your university's hardship fund and money advice team",
        "why": f"Your forecast shows a {round(risk * 100)}% chance of going overdrawn in the next 30 days and your savings from home are running out, so it is worth asking now, before you miss rent.",
        "what": "Most universities have a hardship fund and a free money or advice team, and many also run food support through the students' union. Hardship funds are not 'public funds', so international students can usually apply, but rules differ by university. Asking for help does not usually affect a visa; the advice team can confirm for your case.",
        "link": "https://www.ukcisa.org.uk/student-advice/finances/unexpected-financial-hardship/", "check": ""})
    out.append({
        "id": "council_crisis_fund", "name": "Ask the council about the Crisis and Resilience Fund",
        "why": f"With a {round(risk * 100)}% chance of going overdrawn soon, an emergency grant could stop a missed rent payment.",
        "what": "Government money (it replaced the Household Support Fund in April 2026) that councils give to people in a crisis for essentials. Councils decide who qualifies and rules for students on visas differ, so ask rather than assume no.",
        "link": "https://www.manchester.gov.uk/HSF" if local else "https://www.gov.uk/find-local-council", "check": "In Manchester the council also runs a Welfare Provision Scheme for essential needs." if local else ""})
    debt = _find(ctx, r"klarna|clearpay|loan|overdraft|finance|credit")
    if debt or risk >= 0.5:
        out.append({
            "id": "debt_advice", "name": "Free, confidential money advice (Citizens Advice)",
            "why": ("You are paying " + debt.name + f" ({gbp(debt.amount)} {debt.period}) and " if debt else "") + "using the overdraft most months.",
            "what": "Citizens Advice and the students' union advice service give free, confidential help with debts and budgeting and can explain what you can and cannot claim.",
            "link": "https://www.citizensadvice.org.uk", "check": "Never pay for debt advice."})
    out.append({
        "id": "bank_support", "name": "Ask your bank for hardship support",
        "why": "You are likely to be overdrawn again soon.",
        "what": "Tell your bank you are struggling. UK banks have to treat customers in financial difficulty fairly, and can offer a payment plan, a lower overdraft limit or paused charges.",
        "link": "", "check": ""})
    out.append({
        "id": "student_work", "name": "Part-time work allowed on your visa",
        "why": "Your part-time pay and money from family do not cover rent, bills and food between you.",
        "what": "A Student visa usually allows limited part-time work in term time (often up to 20 hours a week at degree level). Check your own visa conditions, and never go over the limit.",
        "link": "https://www.gov.uk/student-visa/work", "check": ""})
    out.append({
        "id": "railcard", "name": "16-25 Railcard (or student railcard)",
        "why": "You spend on travel every week.",
        "what": "Cheaper rail fares for 16 to 25 year olds and mature students. Worth it only if you take trains; buses and trams are not covered.",
        "link": "https://www.16-25railcard.co.uk", "check": ""})
    return out


def _options(ctx: UserContext) -> list[dict]:
    """Programmes worth checking for this person, most useful first. Each has why (from their data), what, link."""
    if not ctx.has_data:
        return []
    u = ctx.user
    local = "manchester" in (u.notes or "").lower()
    council = "Manchester City Council" if local else "your local council"
    income, balance = ctx.monthly_income, ctx.balance
    fc = ins.forecast(ctx).summary()
    res = ins.resilience(ctx) or {}
    overdraft_risk = fc["prob_overdraft"]["30d"]
    renting = (u.housing or "") in ("rent", "family")
    if "no_recourse_to_public_funds" in (u.challenges or []):
        return _student_options(ctx, fc, res)
    out: list[dict] = []

    uc = income < LOW_INCOME_MONTHLY and balance < SAVINGS_LIMIT
    if uc:
        out.append({
            "id": "universal_credit", "name": "Universal Credit",
            "why": f"You earn about {gbp(income)} a month and it changes with your shifts" + (", and you rent" if renting else "")
                   + f". Universal Credit can top up low or irregular pay and can include help with rent. Your savings are well under {gbp(SAVINGS_LIMIT)}, where savings start to reduce it.",
            "what": "Monthly payment for people on a low income, in or out of work, aged 18 or over (a free benefits calculator shows what you might get).",
            "link": "https://www.gov.uk/universal-credit", "check": "Free calculators: Turn2us (turn2us.org.uk) or Citizens Advice (citizensadvice.org.uk)."})

    if overdraft_risk >= 0.5 or res.get("score", 100) < 45:
        out.append({
            "id": "crisis_fund", "name": "Crisis and Resilience Fund (local council help)",
            "why": f"Your forecast shows a {round(overdraft_risk * 100)}% chance of going overdrawn in the next 30 days and a resilience score of {res.get('score', '?')} out of 100, so essentials are at risk.",
            "what": f"Replaced the Household Support Fund in England from 1 April 2026. {council} decides who gets help with essentials and housing costs, so rules differ by council.",
            "link": "https://www.manchester.gov.uk/HSF" if local else "https://www.gov.uk/find-local-council",
            "check": "Manchester City Council also runs a Welfare Provision Scheme for essential needs: manchester.gov.uk/financialsupport." if local else ""})

    if renting and uc:
        out.append({
            "id": "rent_help", "name": "Extra help with rent",
            "why": "You rent and your income is low. If Universal Credit includes housing costs and your rent is not fully covered, councils can sometimes give extra help.",
            "what": f"Ask {council} about help with a rent shortfall (this has been the Discretionary Housing Payment, now part of local crisis support).",
            "link": "https://www.manchester.gov.uk/financialsupport" if local else "https://www.gov.uk/government/organisations/department-for-work-pensions", "check": ""})

    debt = _find(ctx, r"klarna|clearpay|loan|overdraft|finance|credit")
    if debt or overdraft_risk >= 0.5:
        out.append({
            "id": "debt_advice", "name": "Free debt advice and Breathing Space",
            "why": ("You are paying " + debt.name + f" ({gbp(debt.amount)} {debt.period}) and " if debt else "") + "using your overdraft most months, so a free adviser can help you get ahead of it.",
            "what": "StepChange, Citizens Advice and MoneyHelper give free, confidential help. Breathing Space can pause creditor action and interest for up to 60 days for people in problem debt (you apply through a debt adviser).",
            "link": "https://www.stepchange.org", "check": "Also: moneyhelper.org.uk and gov.uk/debt-respite-scheme-breathing-space. Never pay for debt advice."})

    bb = _find(ctx, r"broadband|internet|virgin|\bbt\b|sky")
    if uc and bb:
        out.append({
            "id": "social_tariff", "name": "Cheaper broadband (social tariff)",
            "why": f"You pay {gbp(bb.amount)} a month for broadband ({bb.name}). If you get Universal Credit you could move to a much cheaper social tariff with the same speed band.",
            "what": "Offered by the broadband companies (BT, Virgin Media and others) to people on Universal Credit and some other benefits; Ofcom keeps the list of providers.",
            "link": "https://www.ofcom.org.uk/phones-and-broadband/saving-money/social-tariffs", "check": ""})

    energy = _find(ctx, r"energy|octopus|edf|ovo|british gas|e\.on|electric|gas")
    if uc and energy:
        out.append({
            "id": "warm_home_discount", "name": "Warm Home Discount",
            "why": f"You pay {gbp(energy.amount)} a month for energy ({energy.name}). People on a low income who get Universal Credit may get a one-off discount off their winter electricity bill.",
            "what": "Most eligible households are found automatically by the DWP and the energy supplier, so you usually do not apply. The supplier must be on the scheme.",
            "link": "https://www.gov.uk/the-warm-home-discount-scheme", "check": "Check the current year's rules on gov.uk."})

    if uc:
        out.append({
            "id": "help_to_save", "name": "Help to Save",
            "why": "If you are working and get Universal Credit, you may be able to save up to a small amount each month and get a government bonus, which could help you build the emergency buffer you are aiming for.",
            "what": "A savings account run by the government with a 50% bonus after two and four years. Check the current opening dates and rules.",
            "link": "https://www.gov.uk/get-help-savings-low-income", "check": ""})

    if overdraft_risk >= 0.5:
        out.append({
            "id": "bank_support", "name": "Ask your bank for hardship support",
            "why": "You are likely to be overdrawn again soon.",
            "what": "Tell your bank you are struggling. UK banks have to treat customers in financial difficulty fairly, and can offer a payment plan, a lower overdraft limit or paused charges.",
            "link": "", "check": ""})
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

def support_doc(options: list[dict]) -> str:
    if not options:
        return "No specific schemes matched from the data we hold. For general help: Citizens Advice, MoneyHelper, StepChange."
    lines = [
        "Support that MAY suit this person, matched to their data. These are signposts to check, not decisions: the organisation named decides eligibility. Say 'may be eligible', never 'is eligible', and never promise an amount."
    ]
    for o in options:
        lines.append(f"- {o['name']}. Why it may suit them: {o['why']} What it is: {o['what']}" + (f" Official link: {o['link']}" if o["link"] else "") + (f" {o['check']}" if o["check"] else ""))
    return "\n".join(lines)
