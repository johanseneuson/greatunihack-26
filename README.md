# Finance Buddy (NatWest challenge MVP)

Mobile-first web app: an AI money coach that uses retrieval-augmented generation (RAG) over the user's own finances plus a small knowledge base of UK guidance.

## Run
    cd backend
    cp .env.example .env     # add ANTHROPIC_API_KEY (optional; without it the app runs in offline mode)
    node server.js           # http://localhost:3000  (no npm install needed, Node 20+)

## How it works
- `backend/db.js` SQLite database (built-in `node:sqlite`, auto-created and seeded): `transactions` (past), `recurring` (bills/subscriptions/debt, past and future), `planned_expenses` (future one-offs). The Expenses tab edits it and the coach reads it.
- `backend/data/` demo profile, seed transactions (`npm run seed` regenerates) and `knowledge/*.md` guidance.
- `backend/rag.js` builds a corpus from profile + account summaries + transactions + guidance and retrieves with BM25.
- `backend/llm.js` sends the retrieved passages to Claude with a coaching system prompt; answers cite sources.
- `backend/finance.js` computes balances, upcoming bills, payday low point (the LLM is given these numbers, it does not do the maths).
- `frontend/` responsive chat UI with proactive cards, language choice, extra-simple mode, large text, high contrast, voice input.

Demo data is fictional. Guidance only, not regulated financial advice.
