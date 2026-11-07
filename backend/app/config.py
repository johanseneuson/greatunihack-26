from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    data_dir: Path = BASE_DIR / "data"
    database_url: str = f"sqlite:///{BASE_DIR / 'data' / 'finance_buddy.db'}"
    cors_origins: str = "*"  # comma-separated, e.g. "http://localhost:5173,http://localhost:3000"
    currency_symbol: str = "£"

    # Demo data
    seed_demo_users: bool = True
    shift_demo_to_today: bool = True  # move Kaggle history so it ends yesterday -> forecasts look forward from today

    # Forecast engine
    simulations: int = 1000
    default_horizon_days: int = 180

    # Optional AI coach (falls back to a rule-based narrative when unavailable)
    anthropic_api_key: str | None = None
    coach_model: str = "claude-opus-5-5"
    coach_enabled: bool = True
    chat_model: str = "claude-haiku-5-5"  # chat assistant (RAG + actions): small and cheap


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
