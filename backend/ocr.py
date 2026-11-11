"""Local-only vision requests. Model loading/unloading is controlled per request."""
import base64
import binascii
import io
import re

import httpx
from PIL import Image


def normalize_answer(value):
    if not isinstance(value, str):
        raise ValueError("OCR не вернул текст")
    text = " ".join(value.strip().strip('`\"\'«»').split())
    if text.lower().startswith("ocr:"):
        text = text[4:].strip()
    if not 2 <= len(text) <= 80 or not re.fullmatch(r"[0-9A-Za-zА-Яа-яЁё]+(?:[ -][0-9A-Za-zА-Яа-яЁё]+){0,6}", text):
        raise ValueError("OCR вернул неоднозначный результат. Введите текст вручную.")
    if any(phrase in text.casefold() for phrase in ("не могу", "неразборчив", "не удалось", "unreadable", "cannot read")):
        raise ValueError("OCR не смог прочитать картинку. Введите текст вручную.")
    return text


def image_base64(data_url):
    if not isinstance(data_url, str) or len(data_url) > 3_000_000:
        raise ValueError("Картинка слишком большая для локального OCR")
    try:
        header, encoded = data_url.split(",", 1)
        if header not in ("data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"):
            raise ValueError
        data = base64.b64decode(encoded, validate=True)
        with Image.open(io.BytesIO(data)) as picture:
            if picture.width * picture.height > 4_000_000:
                raise ValueError
            picture.verify()
    except (ValueError, OSError, binascii.Error, Image.DecompressionBombError):
        raise ValueError("Не удалось прочитать картинку для OCR") from None
    return base64.b64encode(data).decode()


def local_url(settings):
    # Only loopback is configurable by port. Images cannot be routed to a cloud URL.
    return f"http://127.0.0.1:{int(settings['captcha_ocr_port'])}"


def check_model(info, model):
    if not isinstance(info, dict):
        raise ValueError("Ollama вернула некорректные сведения о модели")
    if info.get("remote_host") or info.get("remote_model") or model.lower().endswith((":cloud", "-cloud")):
        raise ValueError("Для капчи разрешены только локальные модели Ollama")
    if not isinstance(info.get("capabilities"), list) or "vision" not in info["capabilities"]:
        raise ValueError("Модель не поддерживает картинки. Для PaddleOCR нужен также vision-projector (mmproj).")


def data_json(response):
    if response.status_code == 404:
        raise ValueError("OCR-модель не установлена в Ollama. Запустите установку локального OCR.")
    if response.status_code != 200:
        raise ValueError(f"Локальная Ollama вернула HTTP {response.status_code}")
    try:
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError
        return result
    except ValueError:
        raise ValueError("Ollama вернула некорректный ответ") from None


async def recognize(data_url, settings):
    encoded = image_base64(data_url)
    model = settings["captcha_ocr_model"]
    timeout = httpx.Timeout(settings["captcha_ocr_timeout"], connect=3)
    try:
        async with httpx.AsyncClient(base_url=local_url(settings), timeout=timeout, trust_env=False, follow_redirects=False) as client:
            info = data_json(await client.post("/api/show", json={"model": model}))
            check_model(info, model)
            keep_alive = settings["captcha_ocr_keep_alive"]
            response = await client.post("/api/chat", json={
                "model": model,
                "messages": [{"role": "user", "content": "OCR:", "images": [encoded]}],
                "stream": False,
                "keep_alive": f"{keep_alive}s" if keep_alive else 0,
                "options": {"temperature": 0, "num_predict": 128, "num_ctx": 2048},
            })
            result = data_json(response)
            if result.get("done_reason") == "length":
                raise ValueError("OCR вернул неполный текст. Введите текст вручную.")
            if not isinstance(result.get("message"), dict):
                raise ValueError("Ollama не вернула результат распознавания")
            return normalize_answer(result["message"].get("content"))
    except httpx.TimeoutException:
        raise ValueError("Локальный OCR не успел ответить. Введите текст вручную или увеличьте таймаут.") from None
    except httpx.HTTPError:
        raise ValueError("Не удалось связаться с локальной Ollama. Проверьте, что она запущена.") from None


async def status(settings):
    """Metadata-only health check: never preloads the model into RAM/VRAM."""
    try:
        async with httpx.AsyncClient(base_url=local_url(settings), timeout=5, trust_env=False, follow_redirects=False) as client:
            model = settings["captcha_ocr_model"]
            info = data_json(await client.post("/api/show", json={"model": model}))
            check_model(info, model)
            running = data_json(await client.get("/api/ps"))
            tag = model if ":" in model.rsplit("/", 1)[-1] else model + ":latest"
            loaded = any(item.get("name") == tag or item.get("model") == tag for item in running.get("models", []))
            return {"available": True, "model": model, "loaded": loaded, "keep_alive": settings["captcha_ocr_keep_alive"]}
    except (ValueError, httpx.HTTPError) as error:
        message = str(error) if isinstance(error, ValueError) else "Локальная Ollama недоступна"
        return {"available": False, "model": settings["captcha_ocr_model"], "message": message}
