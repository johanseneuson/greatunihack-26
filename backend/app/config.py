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
    assistant_name: str = "Lydia"  # named after Lydia Becker, Manchester suffrage pioneer
    chat_model: str = "claude-haiku-5-5"  # chat assistant (RAG + actions): small and cheap

    # Call mode (voice): ElevenLabs text-to-speech. Without a key the browser's built-in voice is used instead.
    elevenlabs_api_key: str | None = None
    elevenlabs_voice_id: str = "ZF6FPAbjXT4488VcRRnw"
    elevenlabs_model: str = "eleven_flash_v2_5"  # English: lowest latency
    elevenlabs_model_multilingual: str = "eleven_multilingual_v2"  # other major languages: better, more native pronunciation
    elevenlabs_model_wide: str = "eleven_v3"  # languages the models above lack (Bengali, Urdu)
    elevenlabs_voices: dict[str, str] = {}  # optional native-speaker voice per language code, e.g. {"es": "<voice id>"}


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
