"""Local launcher / installer. Also used by the windowed launcher."""
import argparse
import os
import shutil
import subprocess
import sys
import threading
import time
import venv
import webbrowser
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
PYTHON = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def command(args, cwd=ROOT):
    print(" > " + " ".join(str(x) for x in args), flush=True)
    subprocess.run([str(x) for x in args], cwd=cwd, check=True)


def node_package_manager():
    # npm is normally distributed alongside Node. Codex portable runtimes use pnpm.
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if npm:
        # cmd files cannot be executed portably with shell=False; invoke npm-cli.js.
        npm_root = Path(npm).resolve().parent
        npm_cli = npm_root / "node_modules/npm/bin/npm-cli.js"
        if npm_cli.exists():
            return [shutil.which("node") or "node", str(npm_cli)]
    pnpm = shutil.which("pnpm")
    if pnpm and os.name != "nt":
        return [pnpm]
    node = shutil.which("node")
    if node:
        portable = Path(node).resolve().parents[1] / "node_modules/pnpm/bin/pnpm.cjs"
        if portable.exists():
            return [node, str(portable)]
    raise RuntimeError("Для сборки нужен Node.js 20.19+ с npm. Установите Node.js LTS и повторите запуск.")


def main():
    parser = argparse.ArgumentParser(description="HH Studio — local dashboard")
    parser.add_argument("--setup", action="store_true", help="Install Python dependencies and build UI")
    parser.add_argument("--install-only", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if sys.version_info < (3, 12):
        raise RuntimeError("Требуется Python 3.12 или новее")
    if args.setup and not PYTHON.exists():
        print("Создаём локальное окружение Python…", flush=True)
        venv.create(ROOT / ".venv", with_pip=True)
    if PYTHON.exists() and Path(sys.prefix).resolve() != (ROOT / ".venv").resolve():
        return subprocess.call([str(PYTHON), str(ROOT / "run.py"), *sys.argv[1:]], cwd=ROOT)
    if args.setup:
        command([sys.executable, "-m", "pip", "install", "-r", ROOT / "requirements.txt"])
        command([sys.executable, "-m", "pip", "install", "--no-deps", "-r", ROOT / "requirements-upstream.txt"])
        pm = node_package_manager()
        command([*pm, "install"], ROOT / "frontend")
        command([*pm, "run", "build"], ROOT / "frontend")
    if args.install_only:
        return 0
    if not (ROOT / "frontend/dist/index.html").exists():
        raise RuntimeError("Сначала выполните установку: python run.py --setup или откройте «HH Studio.pyw».")
    data = ROOT / ".data"
    data.mkdir(exist_ok=True)
    if os.name == "nt":
        # Restrict local state to this Windows user (SID; independent of locale).
        import ctypes
        import ctypes.wintypes
        from ctypes import byref
        token = ctypes.wintypes.HANDLE()
        TOKEN_QUERY, TOKEN_USER = 8, 1
        advapi = ctypes.windll.advapi32
        if advapi.OpenProcessToken(ctypes.windll.kernel32.GetCurrentProcess(), TOKEN_QUERY, byref(token)):
            size = ctypes.wintypes.DWORD()
            advapi.GetTokenInformation(token, TOKEN_USER, None, 0, byref(size))
            buf = ctypes.create_string_buffer(size.value)
            if advapi.GetTokenInformation(token, TOKEN_USER, buf, size, byref(size)):
                sid = ctypes.cast(buf, ctypes.POINTER(ctypes.c_void_p))[0]
                sid_text = ctypes.wintypes.LPWSTR()
                advapi.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.wintypes.LPWSTR)]
                if advapi.ConvertSidToStringSidW(sid, byref(sid_text)):
                    subprocess.run(["icacls", str(data), "/inheritance:r", "/grant:r", f"*{sid_text.value}:(OI)(CI)F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    ctypes.windll.kernel32.LocalFree(sid_text)
            ctypes.windll.kernel32.CloseHandle(token)
    url = f"http://127.0.0.1:{args.port}"
    if not args.no_browser:
        def open_when_ready():
            for _ in range(60):
                try:
                    with urlopen(url, timeout=1) as response:
                        if response.status == 200:
                            webbrowser.open(url)
                            return
                except OSError:
                    time.sleep(.5)
        threading.Thread(target=open_when_ready, daemon=True).start()
    print(f"\nHH Studio: {url}\n", flush=True)
    import uvicorn
    uvicorn.run("backend.app:app", host="127.0.0.1", port=args.port, log_level="warning", timeout_graceful_shutdown=8, access_log=False)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"\nОшибка: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
