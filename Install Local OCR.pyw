"""Optional one-time local OCR installation, without a terminal."""
import queue
import threading
import tkinter as tk
from tkinter import ttk

from setup_local_ocr import install

window = tk.Tk()
window.title("HH Studio — локальный OCR")
window.geometry("540x330")
window.resizable(False, False)
ttk.Label(window, text="PaddleOCR-VL + Ollama", font=("Segoe UI", 17, "bold")).pack(pady=(24, 12))
ttk.Label(window, text="Установка модели и модуля изображений: около 1,2 ГБ.\nOllama должна быть открыта. После установки модель\nзагружается по запросу и выгружается через минуту простоя.", justify="center").pack()
automatic = tk.BooleanVar(value=False)
checkbox = ttk.Checkbutton(window, text="Автоматически подтверждать распознанный текст", variable=automatic)
checkbox.pack(pady=16)
status = tk.StringVar(value="Модель будет скачана с Hugging Face с проверкой SHA-256.")
ttk.Label(window, textvariable=status, wraplength=490, justify="center").pack(pady=8)
progress = ttk.Progressbar(window, mode="indeterminate", length=390)
progress.pack(pady=8)
messages = queue.Queue()
busy = False


def start():
    global busy
    busy = True
    button.configure(state="disabled")
    checkbox.configure(state="disabled")
    progress.start()
    auto_submit = automatic.get()

    def work():
        try:
            install(lambda text: messages.put(("progress", text)), auto_submit=auto_submit)
            messages.put(("done", "Готово. Перезапустите HH Studio. Настройки OCR доступны в панели."))
        except Exception as error:
            messages.put(("error", str(error)))

    threading.Thread(target=work, daemon=True).start()


def poll():
    global busy
    try:
        while True:
            kind, text = messages.get_nowait()
            status.set(text)
            if kind != "progress":
                busy = False
                progress.stop()
                button.configure(state="normal", text="Повторить установку" if kind == "error" else "Установлено")
                checkbox.configure(state="normal")
    except queue.Empty:
        pass
    window.after(100, poll)


button = ttk.Button(window, text="Скачать и подключить OCR", command=start)
button.pack(pady=8)
# Imports are completed before enabling OCR; interrupted downloads are never used.
window.protocol("WM_DELETE_WINDOW", lambda: status.set("Дождитесь завершения установки.") if busy else window.destroy())
poll()
window.mainloop()
