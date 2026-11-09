"""Isolated upstream adapter. Parent/worker protocol is NDJSON over pipes.

No shell, credentials in argv, terminal prompts or detached processes.
"""
import base64
import builtins
import io
import json
import logging
import os
import random
import signal
import sys
import time
import threading
import uuid
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

from .ai import generate_letter

PROTOCOL = sys.stdout
INPUT = sys.stdin


def emit(event_type, /, **data):
    PROTOCOL.write(json.dumps({"type": event_type, **data}, ensure_ascii=False) + "\n")
    PROTOCOL.flush()


def ask(kind, message, image=None):
    prompt_id = uuid.uuid4().hex
    emit("prompt", kind=kind, message=message, image=image, prompt_id=prompt_id)
    line = INPUT.readline()
    if not line:
        raise KeyboardInterrupt
    answer = json.loads(line)
    if answer.get("prompt_id") != prompt_id:
        raise ValueError("Ответ относится к другому запросу")
    return answer["value"].strip()


class LogHandler(logging.Handler):
    def emit(self, record):
        emit("log", level=record.levelname, message=record.getMessage())


class Output(io.TextIOBase):
    def __init__(self):
        self.buffered = ""

    def write(self, value):
        self.buffered += value
        while "\n" in self.buffered:
            line, self.buffered = self.buffered.split("\n", 1)
            if line.strip():
                emit("log", level="INFO", message=line.strip())
        return len(value)

    def flush(self):
        if self.buffered.strip():
            emit("log", level="INFO", message=self.buffered.strip())
            self.buffered = ""



def run(payload):
    operation = payload["operation"]
    if operation == "demo":
        for message in ["Демонстрация: соединение с hh.ru не выполняется", "Загружены настройки тестового запуска", "Фильтры проверены • сухой прогон включён", "Демонстрация завершена. Отклики не отправлялись."]:
            emit("log", level="INFO", message=message)
            time.sleep(1)
        return
    if operation == "letter":
        emit("letter", text=generate_letter(payload["settings"], payload.get("api_key", ""), {"name": payload["settings"]["text"] or "Разработчик", "employer": {"name": "Команда"}}))
        return

    import requests
    from hh_applicant_tool.tool import HHApplicantTool
    from hh_applicant_tool.operations.apply_vacancies import Operation as ApplyOperation
    from hh_applicant_tool.operations.authorize import Operation as AuthOperation

    # Upstream does not set HTTP timeouts. Bound all requests in this child.
    original_request = requests.Session.request
    def bounded_request(self, *args, **kwargs):
        kwargs.setdefault("timeout", (15, 60))
        return original_request(self, *args, **kwargs)
    requests.Session.request = bounded_request

    class WebTool(HHApplicantTool):
        def _solve_captcha(self, image_data):
            return ask("captcha", "Введите текст с картинки hh.ru", "data:image/png;base64," + base64.b64encode(image_data).decode())

    tool = WebTool(config_dir=Path(payload["config_dir"]), use_ai=False, captcha_manual=True, api_delay=1.2)
    tool.create_config_dir()
    logger = logging.getLogger("hh_applicant_tool")
    logger.handlers = [LogHandler()]
    logger.setLevel(logging.INFO)
    logger.propagate = False
    builtins.input = lambda prompt="": ask("otp", str(prompt))

    def sync_account():
        user = tool.get_me()
        resumes = tool.get_resumes()
        emit("account", account={"id": user.get("id"), "name": " ".join(filter(None, [user.get("first_name"), user.get("last_name")])), "email": user.get("email"), "counters": user.get("counters", {})}, resumes=[{"id": r["id"], "title": r.get("title"), "status": r.get("status", {}), "updated_at": r.get("updated_at"), "can_update": r.get("can_publish_or_update", False), "url": r.get("alternate_url", "")} for r in resumes])

    try:
        if operation == "auth":
            from argparse import Namespace
            AuthOperation().run(tool, Namespace(username=payload["username"], password=None))
            sync_account()
        elif operation == "sync":
            sync_account()
        elif operation == "bump":
            resumes = tool.get_resumes()
            selected = payload.get("resume_id")
            updated = 0
            for resume in resumes:
                if selected and resume["id"] != selected:
                    continue
                if not resume.get("can_publish_or_update"):
                    emit("log", level="WARNING", message="hh.ru пока не разрешает поднять: " + resume.get("title", "Резюме"))
                    continue
                tool.api_client.post(f"/resumes/{resume['id']}/publish")
                updated += 1
                emit("log", level="INFO", message="Резюме поднято: " + resume.get("title", ""))
            if not updated:
                emit("log", level="WARNING", message="Ни одно резюме не было поднято: проверьте доступность обновления на hh.ru")
            sync_account()
        elif operation == "apply":
            s = payload["settings"]
            class WebApply(ApplyOperation):
                count = 0
                examined = 0
                dry_count = 0

                def _blacklist_vacancy(self, vacancy):
                    # Exclusions are local, never modify the user's HH blacklist.
                    pass

                def _max_responses_reached(self, state):
                    return self.count + self.dry_count >= s["max_responses"]

                def _should_skip_vacancy(self, vacancy):
                    company = (vacancy.get("employer") or {}).get("name", "").casefold()
                    if any(w.casefold() in company for w in s["excluded_companies"]):
                        emit("log", level="INFO", message="Исключён работодатель: " + company)
                        return True
                    return super()._should_skip_vacancy(vacancy)

                def _build_cover_letter(self, vacancy, placeholders):
                    description = ""
                    if s["letter_mode"] == "ai":
                        description = self.api_client.get(f"/vacancies/{vacancy['id']}").get("description", "")
                    letter = generate_letter(s, payload.get("api_key", ""), vacancy, description)
                    if self.dry_run:
                        self.dry_count += 1
                        emit("application", status="dry_run", vacancy_id=str(vacancy["id"]), title=vacancy.get("name", ""), company=(vacancy.get("employer") or {}).get("name", ""), url=vacancy.get("alternate_url", ""))
                    return letter

                def _process_vacancy(self, vacancy, resume, placeholders, seen, state):
                    self.examined += 1
                    emit("progress", processed=self.examined, sent=self.count, title=vacancy.get("name", ""))
                    before = state.applied_count
                    super()._process_vacancy(vacancy, resume, placeholders, seen, state)
                    if state.applied_count > before:
                        self.count += 1
                        emit("application", status="sent", vacancy_id=str(vacancy["id"]), title=vacancy.get("name", ""), company=(vacancy.get("employer") or {}).get("name", ""), url=vacancy.get("alternate_url", ""))
                        emit("progress", processed=self.examined, sent=self.count, title=vacancy.get("name", ""))
                        if self.count < s["max_responses"]:
                            seconds = random.randint(s["delay_min"], s["delay_max"])
                            emit("delay", seconds=seconds)
                            time.sleep(seconds)

            args_list = ["--no-use-ai", "apply-vacancies", "--dry-run" if s["dry_run"] else "--no-dry-run", "--no-send-email", "--skip-tests", "--no-ai-filter", "--total-pages", str(s["total_pages"]), "--max-responses", str(s["max_responses"]), "--per-page", "100"]
            for name, flag in [("text", "--search"), ("area", "--area"), ("salary", "--salary"), ("experience", "--experience"), ("schedule", "--schedule"), ("resume_id", "--resume-id")]:
                if s[name]:
                    args_list += [flag, str(s[name])]
            if s["excluded_words"]:
                import re
                args_list += ["--excluded-filter", "|".join(re.escape(x) for x in s["excluded_words"])]
            args = tool._parser.parse_args(args_list)
            WebApply().run(tool, args)
        else:
            raise ValueError("Неизвестная операция")
    finally:
        tool.save_cookies()


def main():
    # Even an ungraceful parent exit must not leave an auto-apply worker alive.
    parent_pid = os.getppid()
    def watch_parent():
        import psutil
        while True:
            time.sleep(1)
            if not psutil.pid_exists(parent_pid):
                os._exit(130)
    threading.Thread(target=watch_parent, daemon=True).start()
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    payload = json.loads(INPUT.readline())
    output = Output()
    try:
        with redirect_stdout(output), redirect_stderr(output):
            run(payload)
            output.flush()
        emit("done", status="completed")
        return 0
    except (KeyboardInterrupt, EOFError):
        emit("done", status="stopped")
        return 130
    except Exception as error:
        emit("log", level="ERROR", message=f"{type(error).__name__}: {error}")
        emit("done", status="failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
