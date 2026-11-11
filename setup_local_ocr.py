"""Install pinned local PaddleOCR weights without loading them for inference."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from urllib.request import ProxyHandler, Request, build_opener, urlopen

ROOT = Path(__file__).resolve().parent
MODEL = "hh-paddleocr:0.9b-q4_k_m"
FILES = (
    (
        "mradermacher/PaddleOCR-VL-0.9B-GGUF",
        "97374cac5a20f375a695ea33eac7f0589be41fda",
        "PaddleOCR-VL-0.9B.Q4_K_M.gguf",
        300218720,
        "7f50f35be0b76b9dd26ff7f6077920375e68b8c87b89e18f9ceb236e9bc5c39f",
    ),
    (
        "mantown/PaddleOCR-VL-GGUF",
        "2631182013d97f3a175e57d133b163b24563e91f",
        "PaddleOCR-VL-GGUF-mmproj.gguf",
        881770368,
        "0b39761b2971fc8896646cf97dd2489303d0d99bc6064c30e0e180c41ed0a383",
    ),
)


def verified(path, size, digest):
    if not path.is_file() or path.stat().st_size != size:
        return False
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest() == digest


def download(directory, spec, report):
    repo, revision, filename, size, digest = spec
    destination = directory / filename
    report(f"Проверяем {filename}…")
    if verified(destination, size, digest):
        return destination
    partial = destination.with_suffix(".gguf.part")
    url = f"https://huggingface.co/{repo}/resolve/{revision}/{filename}"
    received, previous_percent = 0, -1
    with urlopen(Request(url, headers={"User-Agent": "HH-Studio-local-OCR"}), timeout=90) as response, partial.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            received += len(chunk)
            if received > size:
                raise RuntimeError(f"Неожиданный размер {filename}")
            output.write(chunk)
            percent = int(received * 100 / size)
            if percent != previous_percent:
                report(f"{filename}: {percent}%")
                previous_percent = percent
    if not verified(partial, size, digest):
        raise RuntimeError(f"Не совпала контрольная сумма {filename}. Повторите установку.")
    partial.replace(destination)
    return destination


def local_api(port, path, payload=None):
    # A proxy from the user's environment must never receive local requests.
    request = Request(f"http://127.0.0.1:{port}{path}",
                      data=json.dumps(payload).encode() if payload is not None else None,
                      headers={"Content-Type": "application/json"})
    with build_opener(ProxyHandler({})).open(request, timeout=10) as response:
        return json.load(response)


def install(report=print, *, auto_submit=False, port=11434, root=ROOT):
    if not 1024 <= port <= 65535:
        raise ValueError("Порт Ollama должен быть от 1024 до 65535")
    executable = shutil.which("ollama")
    if not executable and os.name == "nt":
        candidate = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Ollama/ollama.exe"
        if candidate.is_file():
            executable = str(candidate)
    if not executable:
        raise RuntimeError("Установите Ollama с ollama.com и откройте её, затем повторите установку OCR.")
    report("Проверяем Ollama…")
    try:
        local_api(port, "/api/version")
    except OSError:
        raise RuntimeError("Откройте установленную Ollama и повторите установку OCR.") from None
    directory = root.resolve() / ".data/ocr-models"
    directory.mkdir(parents=True, exist_ok=True)
    paths = [download(directory, spec, report) for spec in FILES]
    modelfile = directory / "Modelfile.vision"
    # Both the language decoder and the matching v1 vision encoder are required.
    content = "\n".join(f'FROM "{path.as_posix()}"' for path in paths)
    content += "\nPARAMETER temperature 0\nPARAMETER num_ctx 2048\nPARAMETER num_predict 128\n"
    modelfile.write_text(content, encoding="utf-8")
    report("Импортируем модель и модуль изображений в Ollama…")
    result = subprocess.run(
        [executable, "create", MODEL, "-f", str(modelfile)],
        env={**os.environ, "OLLAMA_HOST": f"127.0.0.1:{port}"},
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        timeout=600,
    )
    if result.returncode:
        raise RuntimeError("Ollama не смогла импортировать PaddleOCR. Обновите Ollama и повторите установку.")
    info = local_api(port, "/api/show", {"model": MODEL})
    if "vision" not in info.get("capabilities", []):
        raise RuntimeError("Ollama не распознала модуль изображений. Обновите Ollama и повторите установку.")
    settings = {
        "captcha_ocr_enabled": True,
        "captcha_ocr_auto_submit": auto_submit,
        "captcha_ocr_model": MODEL,
        "captcha_ocr_port": port,
        "captcha_ocr_keep_alive": 60,
        "captcha_ocr_timeout": 90,
    }
    settings_path = directory.parent / "ocr-settings.json"
    temporary = settings_path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    temporary.replace(settings_path)
    report("Готово. Перезапустите HH Studio. Модель загрузится только при распознавании.")
    return settings


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Install local PaddleOCR for HH Studio")
    parser.add_argument("--auto-submit", action="store_true")
    parser.add_argument("--port", type=int, default=11434, metavar="PORT")
    args = parser.parse_args()
    install(auto_submit=args.auto_submit, port=args.port)
