"""Local SQLite state. No credentials are returned to the browser."""
import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from cryptography.fernet import Fernet
from .models import Settings


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.root.chmod(0o700)
        key = self.root / ".vault-key"
        if not key.exists():
            key.write_bytes(Fernet.generate_key())
            key.chmod(0o600)
        self.vault = Fernet(key.read_bytes())
        self.db = sqlite3.connect(self.root / "studio.sqlite3", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, name TEXT, settings TEXT, account TEXT, resumes TEXT, synced_at TEXT);
        CREATE TABLE IF NOT EXISTS secrets(profile_id TEXT, provider TEXT, value TEXT, PRIMARY KEY(profile_id,provider));
        CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT, job_id TEXT, at TEXT, level TEXT, message TEXT);
        CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT, job_id TEXT, at TEXT, vacancy_id TEXT, title TEXT, company TEXT, url TEXT, status TEXT);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, profile_id TEXT, operation TEXT, status TEXT, started_at TEXT, ended_at TEXT, processed INTEGER DEFAULT 0, sent INTEGER DEFAULT 0, detail TEXT DEFAULT '');
        CREATE TABLE IF NOT EXISTS schedules(profile_id TEXT, operation TEXT, enabled INTEGER, hours INTEGER, next_run TEXT, PRIMARY KEY(profile_id,operation));
        """)
        self.db.execute("UPDATE jobs SET status='interrupted',ended_at=? WHERE status IN ('running','waiting','stopping')", (now(),))
        if not self.db.execute("SELECT id FROM profiles LIMIT 1").fetchone():
            self.create_profile("Основной профиль")
        self.db.commit()

    def execute(self, sql, args=()):
        cursor = self.db.execute(sql, args)
        self.db.commit()
        return cursor

    def rows(self, sql, args=()):
        return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def profile(self, profile_id):
        row = self.db.execute("SELECT * FROM profiles WHERE id=?", (profile_id,)).fetchone()
        if not row:
            raise KeyError("Профиль не найден")
        p = dict(row)
        for field in ("settings", "account", "resumes"):
            p[field] = json.loads(p[field])
        p["has_api_key"] = {r["provider"]: True for r in self.rows("SELECT provider FROM secrets WHERE profile_id=?", (profile_id,))}
        return p

    def create_profile(self, name):
        pid = uuid.uuid4().hex
        self.execute("INSERT INTO profiles VALUES(?,?,?,?,?,?)", (pid, name.strip(), Settings().model_dump_json(), "null", "[]", None))
        return self.profile(pid)

    def profile_dir(self, pid):
        self.profile(pid)
        path = self.root / "profiles" / pid
        path.mkdir(parents=True, exist_ok=True)
        return path

    def secret(self, pid, provider):
        row = self.db.execute("SELECT value FROM secrets WHERE profile_id=? AND provider=?", (pid, provider)).fetchone()
        return self.vault.decrypt(row[0].encode()).decode() if row else ""

    def save_secret(self, pid, provider, value):
        if value:
            encrypted = self.vault.encrypt(value.encode()).decode()
            self.execute("INSERT OR REPLACE INTO secrets VALUES(?,?,?)", (pid, provider, encrypted))
        else:
            self.execute("DELETE FROM secrets WHERE profile_id=? AND provider=?", (pid, provider))

    def redact(self, message):
        text = str(message)
        for row in self.rows("SELECT value FROM secrets"):
            value = self.vault.decrypt(row["value"].encode()).decode()
            if value:
                text = text.replace(value, "[СКРЫТО]")
        text = re.sub(r"(?i)(access_token|refresh_token|api_key|authorization|password|code|username)([\"'\s:=]+)[^\s,}\"']+", r"\1\2[СКРЫТО]", text)
        text = re.sub(r"(?i)\bBearer\s+[^\s\"']+", "Bearer [СКРЫТО]", text)
        text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text)
        return text[:12000]

    def log(self, pid, jid, message, level="INFO"):
        self.execute("INSERT INTO logs(profile_id,job_id,at,level,message) VALUES(?,?,?,?,?)", (pid, jid, now(), level, self.redact(message)))
        self.execute("DELETE FROM logs WHERE id < (SELECT MAX(id)-10000 FROM logs)")

    def daily_sent(self, pid):
        # Rolling 24 hours is deliberately more conservative than a calendar day.
        return self.db.execute("SELECT COUNT(*) FROM history WHERE profile_id=? AND status='sent' AND at>=?", (pid, datetime.fromtimestamp(datetime.now(timezone.utc).timestamp()-86400, timezone.utc).isoformat())).fetchone()[0]

    def close(self):
        self.db.close()
