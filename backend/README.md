# Finance Buddy - Backend

FastAPI service that turns a user's transaction history into **personalised budgets** and **financial time travel**: a probabilistic forecast of their future balance that flags hardship and unexpected costs *before* they happen, and shows (positively) what their future looks like.

## Quick start

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # optional: add ANTHROPIC_API_KEY for the AI coach
uvicorn app.main:app --reload   # http://localhost:8000/docs
```

On first start the server downloads two public Kaggle datasets (no Kaggle account needed) and creates two demo users. The data is shifted so the history ends yesterday, so forecasts look forward from today:

| id | Demo user | Data | Story |
|---|---|---|---|
| 1 | **Alex Morgan** | [bukolafatunde/personal-finance](https://www.kaggle.com/datasets/bukolafatunde/personal-finance): current account + 2 credit cards, 21 months, salary, mortgage, bills | Homeowner, *Thriving*: big renovation spending waves, seasonal January peak |
| 2 | **Jordan Lee** | [ismetsemedov/personal-budget-transactions-dataset](https://www.kaggle.com/datasets/ismetsemedov/personal-budget-transactions-dataset): 3,600 everyday purchases over 2+ years (income declared in profile) | First job, *Stretched*: ~40% overdraft risk, creeping shopping/coffee spend, saving for a deposit |

Reset the demo at any time with `rm data/finance_buddy.db` and a restart. Tests: `pytest` (offline, synthetic data).

## How it addresses the challenge

| Challenge point | What the backend does | Endpoint |
|---|---|---|
| **Understand** finances | Monthly cash flow, category breakdown vs previous period, top merchants, detected salary/bills/subscriptions | `GET /insights/history`, `/recurring` |
| **Budget**, personalised to circumstances | Budget built from the user's own 6-month history, then a savings target based on income type, dependents and challenges. Cuts are spread by how easy each category is to trim. Includes a daily **safe-to-spend** | `GET /insights/budget` |
| **Plan** | Goals with likely/cautious completion dates, plus what-if scenarios (cut a category, pay rise, holiday, cancel a subscription) | `GET /insights/time-travel`, `POST /insights/scenarios` |
| **Predictive insights / forecasting** | Monte Carlo simulation (1,000 futures) of daily balances: p10/p50/p90 bands, probability of overdraft, lowest point | `GET /insights/forecast` |
| **Anticipate hardship & unexpected expenses** | Early warnings, each paired with an action and a positive upside: overdraft risk (and how much the suggested budget reduces it), buffer erosion, spending waves, heavy months ahead, bill clusters, category creep, income drop, readiness for a surprise cost | `GET /insights/warnings` |
| **Spending waves** | Past surges in variable spend (with the categories driving them), upcoming waves for the next 26 weeks, and a 12-month heavy-month outlook from seasonality and quarterly/annual bills | `GET /insights/waves` |
| **Positive future** | "Future you" snapshots at 1/3/6/12 months, automatic **smart moves** ("trim Eating out 20% and you have £722 more in 6 months"), resilience score with the next best step | `GET /insights/time-travel`, `/overview` |
| AI layer (optional) | Claude turns the computed numbers into a short, encouraging plan; it never invents figures. Without an API key it falls back to a rule-based version | `POST /insights/coach` |

**Frontend tip:** `GET /api/users/{id}/insights/dashboard` returns everything for the home screen in one call (about 0.5s; results are cached until the data or profile changes).

## API overview

All routes are under `/api`. Full interactive docs are at `/docs`.

```
Users & circumstances
  GET/POST       /users                      create a user with income_type, household, dependents, challenges, notes...
  GET/PATCH/DEL  /users/{id}                 PATCH re-personalises every insight
  GET/POST       /users/{id}/goals           DELETE /users/{id}/goals/{goal_id}

Data in
  POST /users/{id}/uploads                   multipart CSV (Monzo, Starling, Revolut, generic, Kaggle...)
  POST /users/{id}/transactions              JSON list [{date, description, amount, category?, account?}]
  GET  /bank-connectors                      banks you can "link" (sandbox, backed by Kaggle)
  POST /users/{id}/bank-connections          {"connector": "sandbox:personal-finance"}
  GET  /users/{id}/transactions              filters: date_from, date_to, category, search, limit, offset
  PATCH /users/{id}/transactions/{txn_id}    re-categorise
  GET  /users/{id}/accounts | /categories | /datasets

Insights  (/users/{id}/insights/...)
  dashboard | overview | history | recurring | forecast?horizon_days=&step= | waves | warnings | budget | time-travel
  POST scenarios  {"adjustments": [{"type": "category", "category": "Eating out", "change_pct": -20},
                                   {"type": "one_off", "amount": -800, "date": "2027-03-01", "label": "Holiday"},
                                   {"type": "income", "change_pct": 5},
                                   {"type": "new_recurring", "amount": -40, "day_of_month": 1, "label": "Gym"},
                                   {"type": "cancel_recurring", "series_id": "out-1a2b3c4d"}]}
  POST coach      {"question": "Can I afford a holiday in March?"}   (question optional)
```

Amounts are signed: negative = money out. Warnings have `severity`: `critical | warning | info | positive`.

## How the forecast works

```
history ──► categorise + detect transfers ──► recurring detection (salary, rent, bills, subscriptions)
                                                │
               ┌────────────────────────────────┴───────────────────────────┐
               ▼                                                            ▼
  scheduled flows on their next dates                 everyday spending: bootstrap real past days
  (+ declared income from profile)                    (matched by weekday) × seasonality × trend
               │                                                            │
               │                      shocks: large one-offs arrive at the user's historical rate
               │                                                            │
               └──────────────► 1,000 simulated daily balance paths ◄───────┘
                                   │
     percentiles · P(overdraft) · waves · warnings · budget checks · goal dates · scenarios
```

- **Transfers** between the user's own accounts (credit card repayments, pots) are excluded from spending and income.
- **Waves** are measured on variable spending (regular monthly bills are rhythm, not waves). Past waves use a robust rolling-median baseline; forecast waves are only reported when there's a reason (a seasonal peak or a less frequent bill).
- **Scenarios** reuse the baseline's random seed, so a difference comes from the change itself, not from random noise.
- **Personalisation:** income type, dependents and challenges change the safety buffer, savings target and resilience scoring. Declared income or balance in the profile is used when the data doesn't show it.

## Project layout

```
app/
  main.py, config.py, db.py, models.py, schemas.py, seed.py
  routers/          users.py · data.py (uploads, bank links, transactions) · insights.py
  services/
    ingest.py       CSV parsing for many bank formats, dedupe
    categories.py   canonical categories, Kaggle/Monzo mappings, merchant keyword rules
    datasets.py     Kaggle download + registry
    connectors.py   bank connector interface (sandbox now; Open Banking provider later)
    coach.py        Claude coach + rule-based fallback
    analytics/      context · recurring · forecast · waves · history · budget · risks · timetravel · insights
tests/              offline tests with a synthetic statement
```

## Notes and next steps

- **Real bank linking:** implement `BankConnector.fetch()` in `services/connectors.py` for an Open Banking provider (TrueLayer, GoCardless Bank Account Data, Plaid). It should return the same normalised rows, and the rest of the pipeline is shared.
- **Auth:** there is none yet. Users are addressed by id, which is fine for the demo but must be added before real data.
- **Data licences:** the household dataset's licence is listed as "Unknown" on Kaggle, so we use it only as demo data and don't commit it (it's downloaded at runtime). The everyday-spending dataset is Apache 2.0. Amounts are shown as £ for the UK demo, whatever currency the source used.
- This is guidance, not regulated financial advice.

## Chat assistant (RAG) and the web app

`app/services/chat/` is a retrieval-augmented assistant over **one user's own data**: profile, balance, forecast, detected recurring payments and subscriptions, planned expenses, warnings, budget, recent transactions, plus a small UK guidance knowledge base in `data/knowledge/*.md`. It is rebuilt on every question, so changes show up immediately.

| Piece | File |
|---|---|
| Documents built from the analytics context | `corpus.py` |
| BM25 retrieval (core docs always included) | `retrieval.py` |
| Prompt, tool use, brevity, one corrective retry | `assistant.py` |
| Deterministic check: every £ figure in a reply must come from the context (or a sum/difference of it) | `grounding.py` |
| Actions the assistant can **propose**: pause/resume a non-essential subscription, add/remove a planned expense. Run only after the user taps Confirm, and re-validated server-side. Essential bills can't be cancelled | `actions.py` |

```
POST /api/users/{id}/chat      {"messages":[{"role":"user","content":"..."}], "language":"English", "plain":false}
                               -> {reply, sources, mode: llm|offline, grounded, actions:[{action, label}]}
POST /api/users/{id}/actions   {"action": {...}}   (the `action` object from a proposal)
GET  /api/users/{id}/expenses  upcoming payments, subscriptions (with paused state), planned expenses, past transactions
```

Paused subscriptions (`paused_series`) and planned expenses (`planned_expenses`) are applied to every forecast as standing adjustments (`UserContext.standing`), so the dashboard, warnings and what-ifs all reflect them.

The React web app in `../frontend/web` (run `npm run dev`, http://localhost:5173) calls these endpoints from its Coach chat, Payments tab and Call button. The assistant uses a small model (`CHAT_MODEL`, default `claude-haiku-5-5`). Without an API key the chat falls back to a basic answer built from the same data.

### Call mode (voice)
The **Call** button (sidebar on desktop, floating button on phones) opens a hands-free conversation: the browser listens (Chrome/Edge speech recognition), the same grounded assistant answers in a short spoken style (`voice: true`), and the reply is spoken with ElevenLabs through `POST /api/voice/speak` (the API key never reaches the browser). Set `ELEVENLABS_API_KEY` (voice and model are configurable: `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`). Without a key the browser's own voice is used. You can talk over the assistant to interrupt it; proposed actions are confirmed by saying yes/no or tapping the buttons.
