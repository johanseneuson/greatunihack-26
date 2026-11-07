"""Call mode backend: ElevenLabs proxy (mocked, no network)."""
import httpx

from app.config import settings
from app.routers import voice


def test_status_and_503_without_key(client, monkeypatch):
    monkeypatch.setattr(settings, "elevenlabs_api_key", None)
    assert client.get("/api/voice/status").json()["elevenlabs"] is False
    assert client.post("/api/voice/speak", json={"text": "hi"}).status_code == 503


def test_speak_proxies_audio_and_hides_key(client, monkeypatch):
    seen = {}

    def fake_post(url, params=None, headers=None, json=None, timeout=None):
        seen.update(url=url, headers=headers, json=json)
        return httpx.Response(200, content=b"ID3fake-mp3")

    monkeypatch.setattr(settings, "elevenlabs_api_key", "test-key")
    monkeypatch.setattr(voice.httpx, "post", fake_post)
    r = client.post("/api/voice/speak", json={"text": "**Hello** [1] there", "language": "Español"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"ID3fake-mp3"
    assert seen["url"].endswith("/ZF6FPAbjXT4488VcRRnw") and seen["headers"]["xi-api-key"] == "test-key"
    assert seen["json"]["text"] == "Hello 1 there"
    assert seen["json"]["model_id"] == "eleven_multilingual_v2" and "language_code" not in seen["json"]  # Spanish: natural-sounding model
    assert "test-key" not in r.text


def test_model_voice_and_language_choice(monkeypatch):
    monkeypatch.setattr(settings, "elevenlabs_voices", {"pl": "native-polish-voice"})
    assert voice.voice_plan("English") == (settings.elevenlabs_model, settings.elevenlabs_voice_id, "en")
    assert voice.voice_plan("Español")[0] == "eleven_multilingual_v2"
    assert voice.voice_plan("Urdu (اردو)")[0] == "eleven_v3"
    assert voice.voice_plan("Polski")[1] == "native-polish-voice"  # per-language native voice override
    assert voice.voice_plan("Klingon")[0] == settings.elevenlabs_model  # unknown language falls back to English settings


def test_speak_upstream_error_is_502(client, monkeypatch):
    monkeypatch.setattr(settings, "elevenlabs_api_key", "k")
    monkeypatch.setattr(voice.httpx, "post", lambda *a, **k: httpx.Response(401, text="nope"))
    assert client.post("/api/voice/speak", json={"text": "hi"}).status_code == 502


def test_voice_flag_accepted_by_chat(client, user_with_data):
    r = client.post(f"/api/users/{user_with_data['id']}/chat", json={"messages": [{"role": "user", "content": "hi"}], "voice": True})
    assert r.status_code == 200 and r.json()["mode"] == "offline"
