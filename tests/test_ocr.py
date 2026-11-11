import asyncio
import base64
import io
import json
import sys
import threading
import time

import httpx
from PIL import Image
import pytest
from fastapi.testclient import TestClient

from backend import ocr
from backend.app import create_app
from backend.models import Settings
from backend.store import Store

REAL_ASYNC_CLIENT = httpx.AsyncClient


@pytest.fixture
def image_data():
    buffer = io.BytesIO()
    Image.new("RGB", (60, 30), "white").save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def mock_ollama(monkeypatch, handler):
    calls, options = [], []

    def transport(request):
        calls.append(request)
        return handler(request)

    def client(**kwargs):
        options.append(kwargs)
        return REAL_ASYNC_CLIENT(transport=httpx.MockTransport(transport), **kwargs)

    monkeypatch.setattr(ocr.httpx, "AsyncClient", client)
    return calls, options


@pytest.mark.parametrize("idle,expected", [(60, "60s"), (0, 0)])
def test_recognition_is_local_and_sets_idle_unload(monkeypatch, image_data, idle, expected):
    def handler(request):
        assert request.url.host == "127.0.0.1" and request.url.port == 11434
        payload = json.loads(request.content)
        if request.url.path == "/api/show":
            assert set(payload) == {"model"}  # No image in the metadata request.
            return httpx.Response(200, json={"capabilities": ["vision"]})
        assert request.url.path == "/api/chat"
        assert payload["keep_alive"] == expected
        assert payload["stream"] is False
        assert payload["messages"] == [{"role": "user", "content": "OCR:", "images": [image_data.split(",")[1]]}]
        return httpx.Response(200, json={"message": {"content": "  проверка текста\n"}})

    calls, options = mock_ollama(monkeypatch, handler)
    result = asyncio.run(ocr.recognize(image_data, Settings(captcha_ocr_keep_alive=idle).model_dump()))
    assert result == "проверка текста"
    assert len(calls) == 2
    assert options[0]["trust_env"] is False and options[0]["follow_redirects"] is False


@pytest.mark.parametrize("info", [
    {"capabilities": ["completion"]},
    {"capabilities": ["vision"], "remote_host": "https://cloud.example"},
    {"capabilities": ["vision"], "remote_model": "remote"},
])
def test_unusable_models_never_receive_images(monkeypatch, image_data, info):
    calls, _ = mock_ollama(monkeypatch, lambda request: httpx.Response(200, json=info))
    with pytest.raises(ValueError):
        asyncio.run(ocr.recognize(image_data, Settings().model_dump()))
    assert [request.url.path for request in calls] == ["/api/show"]


def test_health_check_never_warms_model(monkeypatch):
    def handler(request):
        if request.url.path == "/api/show":
            return httpx.Response(200, json={"capabilities": ["vision"]})
        assert request.url.path == "/api/ps" and request.method == "GET"
        return httpx.Response(200, json={"models": []})

    calls, _ = mock_ollama(monkeypatch, handler)
    result = asyncio.run(ocr.status(Settings().model_dump()))
    assert result["available"] and not result["loaded"]
    assert [request.url.path for request in calls] == ["/api/show", "/api/ps"]


@pytest.mark.parametrize("response", [
    httpx.Response(404, json={"error": "model missing"}),
    httpx.Response(503, text="internal details not for browser"),
    httpx.Response(200, text="not json"),
])
def test_service_errors_provide_manual_fallback(monkeypatch, image_data, response):
    mock_ollama(monkeypatch, lambda request: response)
    with pytest.raises(ValueError) as error:
        asyncio.run(ocr.recognize(image_data, Settings().model_dump()))
    assert "internal details" not in str(error.value)


@pytest.mark.parametrize("value", ["", "не могу прочитать", "<script>bad()</script>", "x" * 81, None])
def test_ambiguous_output_is_not_submitted(value):
    with pytest.raises(ValueError):
        ocr.normalize_answer(value)


def test_invalid_images_fail_before_contacting_ollama(monkeypatch):
    calls, _ = mock_ollama(monkeypatch, lambda _: pytest.fail("Should not contact Ollama"))
    with pytest.raises(ValueError):
        asyncio.run(ocr.recognize("data:image/png;base64,not-an-image", Settings().model_dump()))
    assert calls == []


def test_truncated_recognition_is_never_auto_submitted(monkeypatch, image_data):
    def handler(request):
        if request.url.path == "/api/show":
            return httpx.Response(200, json={"capabilities": ["vision"]})
        return httpx.Response(200, json={"message": {"content": "начало текста"}, "done_reason": "length"})

    mock_ollama(monkeypatch, handler)
    with pytest.raises(ValueError, match="неполный"):
        asyncio.run(ocr.recognize(image_data, Settings().model_dump()))


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path), base_url="http://127.0.0.1") as client:
        bootstrap = client.get("/api/bootstrap").json()
        client.headers["x-csrf-token"] = bootstrap["csrf_token"]
        client.pid = bootstrap["profile_id"]
        client.post("/api/lease/test", json={})
        settings = Settings(captcha_ocr_enabled=True, captcha_ocr_auto_submit=True).model_dump()
        assert client.put(f"/api/profiles/{client.pid}/settings", json=settings).status_code == 200
        yield client


def state(client):
    return client.get(f"/api/profiles/{client.pid}").json()


def wait_for(client, predicate):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        data = state(client)
        if predicate(data):
            return data
        time.sleep(.02)
    pytest.fail("Expected worker state was not reached")


def start_prompt_worker(client, monkeypatch, image, *, kind="captcha", expected="распознанный текст"):
    original = asyncio.create_subprocess_exec
    script = f'''import sys,json
from backend.worker import ask,emit
json.loads(sys.stdin.readline())
answer=ask({kind!r}, "Введите текст", {image!r})
if answer!={expected!r}: sys.exit(1)
emit("done", status="completed")
'''

    async def worker(*args, **kwargs):
        return await original(sys.executable, "-u", "-c", script, **kwargs)

    monkeypatch.setattr("backend.jobs.asyncio.create_subprocess_exec", worker)
    assert client.post(f"/api/profiles/{client.pid}/auth", json={"username": "test@example.com"}).status_code == 200


def test_captcha_ocr_round_trip_through_real_worker(client, monkeypatch, image_data):
    async def recognize(image, settings):
        assert image == image_data and settings["captcha_ocr_keep_alive"] == 60
        return "распознанный текст"

    monkeypatch.setattr(ocr, "recognize", recognize)
    start_prompt_worker(client, monkeypatch, image_data)
    prompt = wait_for(client, lambda data: data["prompt"] and data["prompt"].get("ocr_status") == "ready")["prompt"]
    assert prompt["suggested_value"] == "распознанный текст"
    result = wait_for(client, lambda data: not data["active"])
    assert result["jobs"][0]["status"] == "completed"
    logs = client.get(f"/api/profiles/{client.pid}/logs").text
    assert "распознанный текст" not in logs and image_data not in logs
    assert client.app.state.manager.ocr_task is None


def test_manual_takeover_cancels_recognition(client, monkeypatch, image_data):
    cancelled = threading.Event()

    async def recognize(*args):
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            cancelled.set()
            # Even a provider that returns a late answer after cancellation must
            # not overwrite the user's manual takeover or send that answer.
            return "поздний ответ"

    monkeypatch.setattr(ocr, "recognize", recognize)
    start_prompt_worker(client, monkeypatch, image_data, expected="ручной ответ")
    prompt = wait_for(client, lambda data: data["prompt"] and data["prompt"].get("ocr_status") == "recognizing")["prompt"]
    assert client.post("/api/prompt/ocr/cancel", json={"prompt_id": "stale"}).status_code == 409
    assert client.post("/api/prompt/ocr/cancel", json={"prompt_id": prompt["prompt_id"]}).status_code == 200
    assert cancelled.wait(1)
    assert state(client)["prompt"]["ocr_status"] == "manual"
    assert client.post("/api/prompt", json={"prompt_id": prompt["prompt_id"], "value": "ручной ответ"}).status_code == 200
    assert wait_for(client, lambda data: not data["active"])["jobs"][0]["status"] == "completed"


def test_error_keeps_manual_form_and_retry_available(client, monkeypatch, image_data):
    attempts = 0

    async def recognize(*args):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ValueError("Ollama недоступна — введите вручную")
        return "распознанный текст"

    monkeypatch.setattr(ocr, "recognize", recognize)
    start_prompt_worker(client, monkeypatch, image_data)
    prompt = wait_for(client, lambda data: data["prompt"] and data["prompt"].get("ocr_status") == "failed")["prompt"]
    assert "вручную" in prompt["ocr_error"]
    assert client.post("/api/prompt/ocr/retry", json={"prompt_id": prompt["prompt_id"]}).status_code == 200
    assert wait_for(client, lambda data: not data["active"])["jobs"][0]["status"] == "completed"
    assert attempts == 2


def test_sms_code_never_uses_ocr_even_when_enabled(client, monkeypatch):
    async def forbidden(*args):
        pytest.fail("SMS must never be sent to OCR")

    monkeypatch.setattr(ocr, "recognize", forbidden)
    start_prompt_worker(client, monkeypatch, None, kind="otp", expected="123456")
    prompt = wait_for(client, lambda data: data["prompt"])["prompt"]
    assert "ocr_status" not in prompt
    assert client.post("/api/prompt/ocr/retry", json={"prompt_id": prompt["prompt_id"]}).status_code == 409
    assert client.post("/api/prompt", json={"prompt_id": prompt["prompt_id"], "value": "123456"}).status_code == 200
    assert wait_for(client, lambda data: not data["active"])["jobs"][0]["status"] == "completed"


def test_stop_cancels_pending_ocr(client, monkeypatch, image_data):
    cancelled = threading.Event()

    async def recognize(*args):
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(ocr, "recognize", recognize)
    start_prompt_worker(client, monkeypatch, image_data)
    wait_for(client, lambda data: data["prompt"] and data["prompt"].get("ocr_status") == "recognizing")
    assert client.post("/api/jobs/stop").status_code == 200
    assert cancelled.wait(1)
    assert state(client)["prompt"] is None


def test_local_setup_defaults_keep_explicit_profile_choices(tmp_path):
    store = Store(tmp_path)
    pid = store.rows("SELECT id FROM profiles")[0]["id"]
    legacy = Settings(text="saved search").model_dump()
    legacy = {key: value for key, value in legacy.items() if not key.startswith("captcha_ocr_")}
    store.execute("UPDATE profiles SET settings=? WHERE id=?", (json.dumps(legacy), pid))
    store.close()
    (tmp_path / "ocr-settings.json").write_text(json.dumps({"captcha_ocr_enabled": True, "captcha_ocr_auto_submit": True}), encoding="utf-8")
    store = Store(tmp_path)
    settings = store.profile(pid)["settings"]
    assert settings["text"] == "saved search" and settings["captcha_ocr_enabled"]
    settings["captcha_ocr_enabled"] = False
    store.execute("UPDATE profiles SET settings=? WHERE id=?", (json.dumps(settings), pid))
    assert not store.profile(pid)["settings"]["captcha_ocr_enabled"]
    assert store.create_profile("New")["settings"]["captcha_ocr_keep_alive"] == 60
    store.close()
