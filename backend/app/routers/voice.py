"""Call mode: text-to-speech through ElevenLabs. The API key stays on the server; the browser only gets audio."""
import logging
import re

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..config import settings

log = logging.getLogger(__name__)
router = APIRouter(tags=["voice"])

LANG = {"English": "en", "Español": "es", "Polski": "pl", "Português": "pt", "Français": "fr", "العربية": "ar",
        "Română": "ro", "Bengali (বাংলা)": "bn", "Urdu (اردو)": "ur"}


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=700)
    language: str = Field("English", max_length=40)


def clean_for_speech(t: str) -> str:
    t = re.sub(r"[*_#`>\[\]]", "", t)
    return re.sub(r"\s+", " ", t).strip()


@router.get("/voice/status")
def status():
    return {"elevenlabs": bool(settings.elevenlabs_api_key), "voice_id": settings.elevenlabs_voice_id}


@router.post("/voice/speak", summary="Speak text in the chosen ElevenLabs voice (returns audio/mpeg)")
def speak(body: SpeakRequest):
    if not settings.elevenlabs_api_key:
        raise HTTPException(503, "ElevenLabs is not configured")
    payload = {
        "text": clean_for_speech(body.text),
        "model_id": settings.elevenlabs_model,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True},
    }
    if body.language in LANG and LANG[body.language] != "en":
        payload["language_code"] = LANG[body.language]
    try:
        r = httpx.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{settings.elevenlabs_voice_id}",
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
