import json
import ssl
import uuid
from urllib.parse import parse_qs
from unittest.mock import Mock

import certifi
import httpx
import pytest

from backend import ai
from backend.models import Settings

VACANCY = {"name": "Python Developer", "employer": {"name": "Example"}}
AUTH_KEY = "dGVzdC1jbGllbnQ6dGVzdC1zZWNyZXQ="  # Disposable test client:test-secret, not a credential.
REAL_HTTPX_CLIENT = httpx.Client


@pytest.fixture(autouse=True)
def isolated_providers(monkeypatch):
    ai._gigachat_tokens.clear()
    monkeypatch.setattr(ai.requests, "post", Mock(side_effect=AssertionError("Unexpected real provider call")))
    monkeypatch.setattr(ai.httpx, "Client", Mock(side_effect=AssertionError("Unexpected real provider call")))
    monkeypatch.setattr(ai.time, "time", lambda: 2_000_000_000)
    yield
    ai._gigachat_tokens.clear()


def gigachat_settings(**extra):
    return Settings(letter_mode="ai", provider="gigachat", model="GigaChat-3-Ultra", **extra).model_dump()


def mock_gigachat(monkeypatch, handler):
    requests, options = [], []
    def transport(request):
        requests.append(request)
        return handler(request)
    def client(**kwargs):
        options.append(kwargs)
        return REAL_HTTPX_CLIENT(transport=httpx.MockTransport(transport), **kwargs)
    monkeypatch.setattr(ai.httpx, "Client", client)
    return requests, options


@pytest.mark.parametrize("provider", ["openai", "gemini", "deepseek", "anthropic"])
def test_correct_provider_endpoint_and_text(monkeypatch, provider):
    data = {"content": [{"type": "text", "text": "  Letter  "}]} if provider == "anthropic" else {"choices": [{"message": {"content": "  Letter  "}}]}
    post = Mock(return_value=Mock(status_code=200, json=lambda: data))
    monkeypatch.setattr(ai.requests, "post", post)
    settings = Settings(letter_mode="ai", provider=provider, model="chosen-model").model_dump()
    assert ai.generate_letter(settings, "test-api-key", VACANCY) == "Letter"
    url = "https://api.anthropic.com/v1/messages" if provider == "anthropic" else ai.CHAT_URLS[provider]
    assert post.call_args.args[0] == url
    payload = post.call_args.kwargs["json"]
    assert payload["model"] == "chosen-model"
    assert post.call_args.kwargs["allow_redirects"] is False
    if provider == "deepseek":
        assert payload["thinking"] == {"type": "disabled"}
        assert post.call_args.kwargs["headers"]["Authorization"] == "Bearer test-api-key"
        assert "deepseek.com" in url and "googleapis.com" not in url


@pytest.mark.parametrize("scope", ["GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"])
@pytest.mark.parametrize("milliseconds", [False, True])
def test_gigachat_oauth_scope_tls_and_token_reuse(monkeypatch, scope, milliseconds):
    def handler(request):
        if str(request.url) == ai.GIGACHAT_OAUTH_URL:
            assert request.headers["Authorization"] == "Basic " + AUTH_KEY
            assert uuid.UUID(request.headers["RqUID"]).version == 4
            assert parse_qs(request.content.decode()) == {"scope": [scope]}
            return httpx.Response(200, json={"access_token": "access-test", "expires_at": 2_000_001_800 * (1000 if milliseconds else 1)})
        assert str(request.url) == ai.GIGACHAT_CHAT_URL
        assert request.headers["Authorization"] == "Bearer access-test"
        assert json.loads(request.content)["model"] == "GigaChat-3-Ultra"
        return httpx.Response(200, json={"choices": [{"message": {"content": "Letter"}}]})
    calls, options = mock_gigachat(monkeypatch, handler)
    settings = gigachat_settings(gigachat_scope=scope)
    assert ai.generate_letter(settings, "Basic " + AUTH_KEY, VACANCY) == "Letter"
    assert ai.generate_letter(settings, AUTH_KEY, VACANCY) == "Letter"
    assert len([r for r in calls if str(r.url) == ai.GIGACHAT_OAUTH_URL]) == 1
    assert len(calls) == 3
    for config in options:
        assert isinstance(config["verify"], ssl.SSLContext)
        assert config["verify"].verify_mode == ssl.CERT_REQUIRED
        assert config["verify"].check_hostname
        assert config["follow_redirects"] is False


def test_gigachat_refreshes_revoked_token_once(monkeypatch):
    token_number = 0
    def handler(request):
        nonlocal token_number
        if str(request.url) == ai.GIGACHAT_OAUTH_URL:
            token_number += 1
            return httpx.Response(200, json={"access_token": f"access-{token_number}", "expires_at": 2_000_001_800})
        if request.headers["Authorization"] == "Bearer access-1":
            return httpx.Response(401, json={"error": "expired"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "Letter"}}]})
    calls, _ = mock_gigachat(monkeypatch, handler)
    assert ai.generate_letter(gigachat_settings(), AUTH_KEY, VACANCY) == "Letter"
    assert token_number == 2 and len(calls) == 4


def test_gigachat_renews_expired_token_before_the_next_letter(monkeypatch):
    clock = [2_000_000_000]
    monkeypatch.setattr(ai.time, "time", lambda: clock[0])
    def handler(request):
        if str(request.url) == ai.GIGACHAT_OAUTH_URL:
            return httpx.Response(200, json={"access_token": "test-access", "expires_at": clock[0] + 1800})
        return httpx.Response(200, json={"choices": [{"message": {"content": "Letter"}}]})
    calls, _ = mock_gigachat(monkeypatch, handler)
    ai.generate_letter(gigachat_settings(), AUTH_KEY, VACANCY)
    clock[0] += 1800
    ai.generate_letter(gigachat_settings(), AUTH_KEY, VACANCY)
    assert len([r for r in calls if str(r.url) == ai.GIGACHAT_OAUTH_URL]) == 2


def test_gigachat_token_is_not_reused_for_different_scope(monkeypatch):
    def handler(request):
        if str(request.url) == ai.GIGACHAT_OAUTH_URL:
            return httpx.Response(200, json={"access_token": "test-access", "expires_at": 2_000_001_800})
        return httpx.Response(200, json={"choices": [{"message": {"content": "Letter"}}]})
    calls, _ = mock_gigachat(monkeypatch, handler)
    ai.generate_letter(gigachat_settings(), AUTH_KEY, VACANCY)
    ai.generate_letter(gigachat_settings(gigachat_scope="GIGACHAT_API_B2B"), AUTH_KEY, VACANCY)
    assert len([r for r in calls if str(r.url) == ai.GIGACHAT_OAUTH_URL]) == 2


def test_provider_errors_never_include_oauth_secrets(monkeypatch):
    calls, _ = mock_gigachat(monkeypatch, lambda _: httpx.Response(401, json={"debug": AUTH_KEY, "access_token": "secret-test-access"}))
    with pytest.raises(ValueError) as error:
        ai.generate_letter(gigachat_settings(), AUTH_KEY, VACANCY)
    assert "401" in str(error.value)
    assert AUTH_KEY not in str(error.value) and "secret-test-access" not in str(error.value)
    assert len(calls) == 1


def test_gigachat_tls_failure_gives_certificate_guidance(monkeypatch):
    def handler(request):
        raise httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED]", request=request)
    mock_gigachat(monkeypatch, handler)
    with pytest.raises(ValueError, match="CA-сертификат"):
        ai.generate_letter(gigachat_settings(), AUTH_KEY, VACANCY)


def test_custom_ca_preserves_certificate_and_hostname_validation(tmp_path):
    context = ai.gigachat_ssl_context(certifi.where())
    assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
    bad = tmp_path / "bad.pem"
    bad.write_text("not a certificate")
    with pytest.raises(ValueError, match="PEM"):
        ai.gigachat_ssl_context(str(bad))
    with pytest.raises(ValueError, match="не найден"):
        ai.gigachat_ssl_context(str(tmp_path / "missing.pem"))


@pytest.mark.parametrize("data", [{}, {"choices": []}, {"choices": [{"message": {"content": " "}}]}])
def test_deepseek_rejects_missing_or_empty_text(monkeypatch, data):
    monkeypatch.setattr(ai.requests, "post", Mock(return_value=Mock(status_code=200, json=lambda: data)))
    with pytest.raises(ValueError):
        ai.generate_letter(Settings(letter_mode="ai", provider="deepseek").model_dump(), "test-api-key", VACANCY)
