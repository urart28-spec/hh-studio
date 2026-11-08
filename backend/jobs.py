import asyncio
import json
import os
import signal
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
import psutil
from .store import now

ROOT = Path(__file__).resolve().parents[1]


class JobManager:
    def __init__(self, store):
        self.store = store
        self.active = None
        self.process = None
        self.reader = None
        self.lock = asyncio.Lock()
        self.leases = {}
        self.prompt = None
        self.wait_until = None
        self.letter = None
        self.letter_profile_id = None

    def heartbeat(self, tab):
        self.leases[tab] = time.monotonic()

    def has_viewer(self):
        cutoff = time.monotonic() - 25
        self.leases = {k: v for k, v in self.leases.items() if v >= cutoff}
        return bool(self.leases)

    async def start(self, pid, operation, **extra):
        async with self.lock:
            if self.active:
                raise ValueError("Уже выполняется задача. Остановите её или дождитесь завершения.")
            profile = self.store.profile(pid)
            settings = dict(profile["settings"])
            if operation in ("apply", "bump", "sync"):
                if not (self.store.profile_dir(pid) / "token.json").exists():
                    raise ValueError("Сначала подключите аккаунт hh.ru в разделе «Аккаунты»")
            if operation == "apply":
                remaining = settings["daily_limit"] - self.store.daily_sent(pid)
                if not settings["dry_run"] and remaining <= 0:
                    raise ValueError("Локальный лимит за 24 часа исчерпан")
                if not settings["dry_run"]:
                    settings["max_responses"] = min(settings["max_responses"], remaining)
            if operation in ("apply", "letter") and settings["letter_mode"] == "ai" and not self.store.secret(pid, settings["provider"]):
                raise ValueError("Добавьте API-ключ выбранного AI-провайдера в разделе «Сопроводительное»")
            jid = uuid.uuid4().hex
            payload = {"profile_id": pid, "operation": operation, "config_dir": str(self.store.profile_dir(pid)), "settings": settings, "api_key": self.store.secret(pid, settings["provider"]), **extra}
            flags = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
            self.process = await asyncio.create_subprocess_exec(sys.executable, "-u", "-m", "backend.worker", stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, cwd=str(ROOT), env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}, limit=2**21, **flags)
            self.store.execute("INSERT INTO jobs(id,profile_id,operation,status,started_at) VALUES(?,?,?,?,?)", (jid, pid, operation, "running", now()))
            self.active = {"id": jid, "profile_id": pid, "operation": operation}
            self.prompt = self.wait_until = self.letter = None
            self.store.log(pid, jid, f"Запуск: {operation}" + (" • DRY RUN" if operation == "apply" and settings["dry_run"] else ""))
            self.process.stdin.write((json.dumps(payload, ensure_ascii=False) + "\n").encode())
            await self.process.stdin.drain()
            self.reader = asyncio.create_task(self._read(self.process, dict(self.active)))
            return self.active

    async def _read(self, process, job):
        pid, jid = job["profile_id"], job["id"]
        status = "failed"
        try:
            while line := await process.stdout.readline():
                try:
                    event = json.loads(line.decode("utf-8", errors="replace"))
                except (ValueError, UnicodeError):
                    self.store.log(pid, jid, line.decode("utf-8", errors="replace"), "WARNING")
                    continue
                kind = event.get("type")
                if kind == "log":
                    self.store.log(pid, jid, event.get("message", ""), event.get("level", "INFO"))
                elif kind == "prompt":
                    self.prompt = event
                    self.store.execute("UPDATE jobs SET status='waiting' WHERE id=?", (jid,))
                    self.store.log(pid, jid, "Требуется ввод: " + event["message"], "WARNING")
                elif kind == "progress":
                    self.store.execute("UPDATE jobs SET processed=?,sent=?,detail=? WHERE id=?", (event["processed"], event["sent"], event.get("title", ""), jid))
                elif kind == "application":
                    self.store.execute("INSERT INTO history(profile_id,job_id,at,vacancy_id,title,company,url,status) VALUES(?,?,?,?,?,?,?,?)", (pid, jid, now(), event["vacancy_id"], event["title"], event["company"], event["url"], event["status"]))
                elif kind == "account":
                    self.store.execute("UPDATE profiles SET account=?,resumes=?,synced_at=? WHERE id=?", (json.dumps(event["account"], ensure_ascii=False), json.dumps(event["resumes"], ensure_ascii=False), now(), pid))
                elif kind == "delay":
                    self.wait_until = time.time() + event["seconds"]
                    self.store.log(pid, jid, f"Пауза перед следующим откликом: {event['seconds']} с")
                elif kind == "letter":
                    self.letter = event["text"]
                    self.letter_profile_id = pid
                elif kind == "done":
                    status = event["status"]
            code = await process.wait()
            if code and status == "completed":
                status = "failed"
        except Exception as error:
            self.store.log(pid, jid, f"Ошибка чтения процесса: {error}", "ERROR")
            await self._terminate(process)
        finally:
            row = self.store.rows("SELECT status FROM jobs WHERE id=?", (jid,))[0]
            if row["status"] == "stopping":
                status = "stopped"
            self.store.execute("UPDATE jobs SET status=?,ended_at=? WHERE id=?", (status, now(), jid))
            self.store.log(pid, jid, {"completed": "Задача завершена", "stopped": "Задача остановлена", "failed": "Задача завершилась с ошибкой"}.get(status, status), "ERROR" if status == "failed" else "INFO")
            if process.stdin:
                process.stdin.close()
            self.active = self.process = self.prompt = self.wait_until = None

    async def reply(self, prompt_id, value):
        async with self.lock:
            if not self.prompt or self.prompt["prompt_id"] != prompt_id or not self.process or self.process.returncode is not None:
                raise ValueError("Запрос ввода уже завершён")
            self.process.stdin.write((json.dumps({"prompt_id": prompt_id, "value": value}) + "\n").encode())
            await self.process.stdin.drain()
            self.prompt = None
            self.store.execute("UPDATE jobs SET status='running' WHERE id=?", (self.active["id"],))

    async def _terminate(self, process):
        if process.returncode is not None:
            return
        children = []
        try:
            children = psutil.Process(process.pid).children(recursive=True)
        except psutil.NoSuchProcess:
            pass
        if os.name == "nt":
            # Closing stdin unblocks OTP/captcha; terminate handles network/sleep.
            if process.stdin:
                process.stdin.close()
            try:
                await asyncio.wait_for(process.wait(), timeout=0.75)
            except asyncio.TimeoutError:
                process.terminate()
        else:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        try:
            await asyncio.wait_for(process.wait(), timeout=3)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
        for child in children:
            try:
                child.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

    async def stop(self, emergency=False):
        async with self.lock:
            if emergency:
                self.store.execute("UPDATE schedules SET enabled=0")
            if self.process:
                self.store.execute("UPDATE jobs SET status='stopping' WHERE id=?", (self.active["id"],))
                await self._terminate(self.process)
                if self.reader:
                    await self.reader

    async def scheduler(self):
        while True:
            await asyncio.sleep(2)
            if not self.has_viewer():
                if self.active:
                    await self.stop()
                continue
            if self.active:
                continue
            for row in self.store.rows("SELECT * FROM schedules WHERE enabled=1 AND next_run<=? ORDER BY next_run LIMIT 1", (now(),)):
                next_run = (datetime.now(timezone.utc) + timedelta(hours=row["hours"])).isoformat()
                self.store.execute("UPDATE schedules SET next_run=? WHERE profile_id=? AND operation=?", (next_run, row["profile_id"], row["operation"]))
                try:
                    await self.start(row["profile_id"], row["operation"])
                except Exception as error:
                    self.store.log(row["profile_id"], "scheduler", str(error), "WARNING")
