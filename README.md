# Finance Buddy (NatWest challenge)

An AI money coach for people underserved by financial services. Mobile-first web app + FastAPI backend.

- `backend/` FastAPI service: transactions, recurring-payment detection, Monte Carlo "financial time travel" forecast, warnings, budgets, and the **RAG chat assistant** with confirmable actions. See `backend/README.md`.
- `frontend/web` React + Vite app (Home, Spending incl. Payments, Waves, Future, Coach with chat, Profile). The chat, the Call button (voice) and the Payments tab talk to the backend's assistant endpoints.

## Run
    # 1) backend
    cd backend
    python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
    pip install -r requirements-dev.txt
    cp .env.example .env        # add ANTHROPIC_API_KEY and ELEVENLABS_API_KEY (both optional; basic mode without them)
    uvicorn app.main:app --port 8000                    # API docs: http://localhost:8000/docs
    # 2) web app
    cd frontend/web && npm install && npm run dev       # http://localhost:5173

Guidance only, not regulated financial advice. Demo data is public Kaggle data / fictional.
