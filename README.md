# Finance Buddy (NatWest challenge)

Financial Navigator: An AI-Powered Financial Coach for Greater Financial Inclusion and Resilience . Mobile-first web app + FastAPI backend.

- `backend/` FastAPI service: transactions, recurring-payment detection, Monte Carlo "financial time travel" forecast, warnings, budgets, and the **RAG chat assistant** with confirmable actions. See `backend/README.md`.
- `frontend/` plain HTML/CSS/JS web app (Coach chat + proactive cards, Expenses tab), served by the backend at `/app/`.

## Run
    cd backend
    python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
    pip install -r requirements-dev.txt
    cp .env.example .env        # add ANTHROPIC_API_KEY (optional; basic mode without it)
    uvicorn app.main:app --port 8000
    # open http://localhost:8000/app/   (API docs: /docs)

Guidance only, not regulated financial advice. Demo data is public Kaggle data / fictional.
