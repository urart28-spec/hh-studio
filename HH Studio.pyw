"""Double-click this file to install and launch without a terminal window."""
import os
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, ttk
from urllib.request import urlopen
import webbrowser

ROOT = Path(__file__).resolve().parent
URL = "http://127.0.0.1:8765"
window = tk.Tk()
window.title("HH Studio")
window.geometry("440x260")
window.resizable(False, False)
window.configure(bg="#f6f7f9")
label = tk.Label(window, text="HH Studio", font=("Segoe UI", 24, "bold"), bg="#f6f7f9", fg="#ed4b52")
label.pack(pady=(25, 8))
status = tk.StringVar(value="Подготовка рабочего пространства…")
tk.Label(window, textvariable=status, font=("Segoe UI", 10), bg="#f6f7f9", wraplength=390).pack(pady=6)
progress = ttk.Progressbar(window, mode="indeterminate", length=330)
progress.pack(pady=13)
progress.start()
process = None
closing = False


def open_panel():
    webbrowser.open(URL)


def close():
    global closing
    closing = True
    if process and process.poll() is None:
        # Kill the owned tree on a native launcher exit; workers do not survive it.
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], creationflags=subprocess.CREATE_NO_WINDOW, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            process.terminate()
    window.destroy()


def launch():
    global process
    try:
        try:
            with urlopen(URL + "/api/bootstrap", timeout=2) as r:
                import json
                existing = json.load(r)
                if "upstream_version" in existing and "csrf_token" in existing:
                    window.after(0, ready)
                    open_panel()
                    return
        except OSError:
            pass
        interpreter = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        base = Path(sys.executable)
        if base.name.lower() == "pythonw.exe":
            base = base.with_name("python.exe")
        installed = interpreter.exists() and (ROOT / "frontend/dist/index.html").exists()
        cmd = [str(interpreter if interpreter.exists() else base), str(ROOT / "run.py"), "--no-browser"]
        if not installed:
            cmd.append("--setup")
            window.after(0, lambda: status.set("Первый запуск: установка зависимостей.\nЭто может занять несколько минут."))
        log_path = ROOT / "launcher.log"
        with log_path.open("w", encoding="utf-8") as output:
            process = subprocess.Popen(cmd, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        import time
        for _ in range(1200):
            if closing:
                return
            if process.poll() is not None:
                raise RuntimeError("Не удалось запустить сервер. Подробности — в launcher.log рядом с приложением.")
            try:
                with urlopen(URL, timeout=1) as r:
                    if r.status == 200:
                        window.after(0, ready)
                        open_panel()
                        return
            except OSError:
                time.sleep(.5)
        raise RuntimeError("Установка заняла слишком много времени. Подробности — в launcher.log.")
    except Exception as error:
        text = str(error)
        window.after(0, lambda: failed(text))


def ready():
    progress.stop()
    progress.pack_forget()
    status.set("Панель работает на этом компьютере.\nЗакройте это окно, чтобы остановить сервер.")
    ttk.Button(window, text="Открыть панель в браузере", command=open_panel).pack(pady=12)


def failed(text):
    progress.stop()
    status.set("Запуск не удался")
    messagebox.showerror("HH Studio", text)


window.protocol("WM_DELETE_WINDOW", close)
threading.Thread(target=launch, daemon=True).start()
window.mainloop()
