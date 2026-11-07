# Finance Buddy - Web app

React + TypeScript + Vite front end for the Finance Buddy API (`../../backend`). The look follows the NatWest
hackathon design kit (colours, cards, Newsfeed / Categories / Budgets tabs, bottom tab bar on mobile); the product,
data and models are our own.

## Run

```bash
# 1. backend (from repo root)
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload     # :8000

# 2. web app
cd frontend/web && npm install && npm run dev                                 # http://localhost:5173
```

Vite proxies `/api` to `http://localhost:8000` (override with `VITE_API_PROXY`, or point at a deployed API with
`VITE_API_URL=https://.../api`). If port 5173 is taken, Vite picks the next free port; check the terminal.

## Screens

| Screen | What it shows |
|---|---|
| **Home** | Greeting header, top alert, total balance + safe-to-spend, accounts, coming-up payments, resilience score dial, goals, "Future you" toggle with smart moves |
| **Spending** | Newsfeed tiles (waves, budget nearly used, last month, creeping categories, subscriptions) · Categories (12-month bars, tap a month for its breakdown) · Budgets (personalised limits, safe to spend, needs/wants/savings split) |
| **Future** | Financial time travel: "Future you" balance tracker that follows your cursor over the 1,000-future forecast (1M/3M/6M/1Y), then spending waves: past surges + 26-week forecast, heavy months in the next year, what drove each past wave, seasonal pattern |
| **Coach** | AI (or rule-based) personalised story with next steps, ask-a-question box, and all early warnings filterable |
| **Profile & data** | Switch user / add a person, link a sandbox bank, upload a CSV, circumstances form (drives personalisation), goals, light/dark theme |

Responsive: sidebar on desktop, NatWest-style bottom tab bar on phones. Light and dark mode.

## Structure (ready for the Expo app)

```
src/
  lib/            platform-neutral - reuse in React Native as-is
    api.ts        fetch client for every backend endpoint (setApiBase() for the phone)
    types.ts      response types mirroring the backend
    format.ts     £ / date formatting
    theme.ts      colour tokens (same as styles/tokens.css)
  context/        user + dashboard state (React only, also portable)
  components/     web UI pieces (Gauge, AlertCard, CategoryIcon, Layout, ui)
  pages/          one file per screen
  styles/         tokens.css (light/dark) + app.css
```

For the mobile app: create `frontend/mobile` with Expo, copy or symlink `src/lib` and `src/context`, swap
`lucide-react` for `lucide-react-native`, `recharts` for a native chart library (e.g. `victory-native`), and
call `setApiBase('http://<laptop-LAN-IP>:8000/api')`.
