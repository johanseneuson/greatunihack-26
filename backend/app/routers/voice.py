"""Call mode: text-to-speech through ElevenLabs. The API key stays on the server; the browser only gets audio."""
import logging
import re
import threading

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..config import settings

log = logging.getLogger(__name__)
router = APIRouter(tags=["voice"])

LANG = {"English": "en", "Español": "es", "Polski": "pl", "Português": "pt", "Français": "fr", "العربية": "ar",
        "Română": "ro", "Italiano": "it", "हिन्दी": "hi", "Bengali (বাংলা)": "bn", "Urdu (اردو)": "ur"}
WIDE = {"bn", "ur"}  # not covered by Multilingual v2 / Flash v2.5


def voice_plan(language: str) -> tuple[str, str, str | None]:
    """(model, voice id, language code to enforce). English uses the fast model; other languages use the model with the
    most natural pronunciation. A per-language native voice can be set with ELEVENLABS_VOICES."""
    code = LANG.get(language, "en")
    voice = settings.elevenlabs_voices.get(code, settings.elevenlabs_voice_id)
    if code == "en":
        return settings.elevenlabs_model, voice, "en"
    if code in WIDE:
        return settings.elevenlabs_model_wide, voice, None
    return settings.elevenlabs_model_multilingual, voice, None


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=700)
    language: str = Field("English", max_length=40)


def clean_for_speech(t: str) -> str:
    t = re.sub(r"[*_#`>\[\]]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def warm_up() -> None:
    """Background no-op request so the first real call doesn't pay the cold-start delay."""
    if not settings.elevenlabs_api_key:
        return

    def run():
        try:
            speak(SpeakRequest(text="Hello."))
        except Exception as e:  # noqa: BLE001 - best effort only
            log.info("voice warm-up skipped: %s", e)

    threading.Thread(target=run, daemon=True).start()


@router.get("/voice/status")
def status():
    return {"elevenlabs": bool(settings.elevenlabs_api_key), "voice_id": settings.elevenlabs_voice_id}


@router.post("/voice/speak", summary="Speak text in the chosen ElevenLabs voice (returns audio/mpeg)")
def speak(body: SpeakRequest):
    if not settings.elevenlabs_api_key:
        raise HTTPException(503, "ElevenLabs is not configured")
    model, voice, code = voice_plan(body.language)
    payload = {
        "text": clean_for_speech(body.text),
        "model_id": model,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True},
    }
    if code:  # only Flash/Turbo v2.5 accept an enforced language
        payload["language_code"] = code
    try:
        r = httpx.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
            params={"output_format": "mp3_44100_64"},
            headers={"xi-api-key": settings.elevenlabs_api_key, "content-type": "application/json"},
            json=payload, timeout=30,
        )
    except httpx.HTTPError as e:
        log.warning("ElevenLabs connection error: %s", e)
        raise HTTPException(502, "Could not reach ElevenLabs") from e
    if r.status_code != 200:
        log.warning("ElevenLabs error %s: %s", r.status_code, r.text[:300])
        raise HTTPException(502, f"ElevenLabs error {r.status_code}")
    return Response(r.content, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
