import asyncio
import importlib.metadata
import json
import os
import secrets
import time
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from .jobs import JobManager
from .models import AuthStart, JobStart, ProfileCreate, PromptReply, ScheduleUpdate, SecretUpdate, Settings
from .store import Store

ROOT = Path(__file__).resolve().parents[1]


def create_app(data_dir=None):
    key = secrets.token_urlsafe(32)

    @asynccontextmanager
    async def lifespan(app):
        app.state.store = Store(Path(data_dir or os.getenv("HH_STUDIO_DATA", ROOT / ".data")))
        app.state.manager = JobManager(app.state.store)
        scheduler = asyncio.create_task(app.state.manager.scheduler())
        try:
            yield
        finally:
            scheduler.cancel()
            with suppress(asyncio.CancelledError):
                await scheduler
            await app.state.manager.stop()
            app.state.store.close()

    app = FastAPI(title="HH Studio", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def local_guard(request: Request, call_next):
        host = request.headers.get("host", "")
        if urlsplit("http://" + host).hostname not in ("127.0.0.1", "localhost", "::1"):
            return JSONResponse({"detail": "Разрешено только локальное подключение"}, status_code=403)
        origin = request.headers.get("origin")
        if origin and origin not in ("http://" + host, "https://" + host):
            return JSONResponse({"detail": "Недопустимый Origin"}, status_code=403)
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"detail": "Межсайтовый запрос запрещён"}, status_code=403)
        if request.url.path.startswith("/api/"):
            if request.url.path != "/api/bootstrap" and request.cookies.get("hh_studio") != key:
                return JSONResponse({"detail": "Откройте панель заново"}, status_code=401)
            if request.method not in ("GET", "HEAD", "OPTIONS") and not secrets.compare_digest(request.headers.get("x-csrf-token", ""), key):
                return JSONResponse({"detail": "Недопустимый CSRF-токен"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ValueError)
    async def value_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(KeyError)
    async def key_error(request, exc):
        return JSONResponse({"detail": "Профиль не найден"}, status_code=404)

    def snapshot(pid):
        store, manager = app.state.store, app.state.manager
        profile = store.profile(pid)
        jobs = store.rows("SELECT * FROM jobs WHERE profile_id=? ORDER BY started_at DESC LIMIT 10", (pid,))
        token_path = store.profile_dir(pid) / "token.json"
        token = {}
        if token_path.exists():
            with suppress(ValueError, OSError):
                token = json.loads(token_path.read_text(encoding="utf-8")).get("token", {})
        series = store.rows("SELECT substr(at,1,10) AS day,COUNT(*) AS count FROM history WHERE profile_id=? AND status='sent' GROUP BY day ORDER BY day DESC LIMIT 30", (pid,))
        return {"profile": profile, "profiles": store.rows("SELECT id,name FROM profiles"), "jobs": jobs, "active": manager.active, "prompt": manager.prompt if manager.active and manager.active["profile_id"] == pid else None, "wait_seconds": max(0, int((manager.wait_until or 0)-time.time())), "letter_preview": manager.letter if manager.letter_profile_id == pid else None, "schedules": store.rows("SELECT * FROM schedules WHERE profile_id=?", (pid,)), "stats": {"sent_24h": store.daily_sent(pid), "series": series, "history_count": store.db.execute("SELECT COUNT(*) FROM history WHERE profile_id=?", (pid,)).fetchone()[0]}, "has_token": bool(token.get("access_token")), "token_expires_at": token.get("access_expires_at"), "history": store.rows("SELECT * FROM history WHERE profile_id=? ORDER BY id DESC LIMIT 500", (pid,))}

    @app.get("/api/bootstrap")
    async def bootstrap():
        profile = app.state.store.rows("SELECT id FROM profiles LIMIT 1")[0]
        try:
            version = importlib.metadata.version("hh-applicant-tool")
        except importlib.metadata.PackageNotFoundError:
            version = None
        response = JSONResponse({"csrf_token": key, "profile_id": profile["id"], "upstream_version": version})
        response.set_cookie("hh_studio", key, httponly=True, samesite="strict")
        return response

    @app.get("/api/profiles/{pid}")
    async def state(pid: str):
        return snapshot(pid)

    @app.post("/api/profiles")
    async def create_profile(body: ProfileCreate):
        if len(app.state.store.rows("SELECT id FROM profiles")) >= 20:
            raise ValueError("Можно создать не больше 20 профилей")
        return app.state.store.create_profile(body.name)

    @app.put("/api/profiles/{pid}/settings")
    async def save_settings(pid: str, body: Settings):
        app.state.store.profile(pid)
        app.state.store.execute("UPDATE profiles SET settings=? WHERE id=?", (body.model_dump_json(), pid))
        return {"ok": True}

    @app.put("/api/profiles/{pid}/secret")
    async def save_secret(pid: str, body: SecretUpdate):
        app.state.store.profile(pid)
        app.state.store.save_secret(pid, body.provider, body.api_key)
        return {"ok": True}

    @app.post("/api/profiles/{pid}/auth")
    async def authenticate(pid: str, body: AuthStart):
        return await app.state.manager.start(pid, "auth", username=body.username)

    @app.post("/api/profiles/{pid}/jobs")
    async def start_job(pid: str, body: JobStart):
        return await app.state.manager.start(pid, body.operation, resume_id=body.resume_id)

    @app.post("/api/profiles/{pid}/letter")
    async def preview_letter(pid: str):
        return await app.state.manager.start(pid, "letter")

    @app.post("/api/jobs/stop")
    async def stop_job():
        await app.state.manager.stop()
        return {"ok": True}

    @app.post("/api/jobs/emergency-stop")
    async def emergency_stop():
        await app.state.manager.stop(emergency=True)
        return {"ok": True}

    @app.post("/api/prompt")
    async def reply_prompt(body: PromptReply):
        await app.state.manager.reply(body.prompt_id, body.value)
        return {"ok": True}

    @app.post("/api/lease/{tab}")
    async def heartbeat(tab: str):
        if len(tab) > 64:
            raise HTTPException(422, "Недопустимый идентификатор вкладки")
        app.state.manager.heartbeat(tab)
        return {"ok": True}

    @app.delete("/api/lease/{tab}")
    async def release(tab: str):
        app.state.manager.leases.pop(tab, None)
        if not app.state.manager.has_viewer():
            await app.state.manager.stop()
        return {"ok": True}

    @app.put("/api/profiles/{pid}/schedule")
    async def schedule(pid: str, body: ScheduleUpdate):
        app.state.store.profile(pid)
        next_run = (datetime.now(timezone.utc) + timedelta(hours=body.hours)).isoformat()
        app.state.store.execute("INSERT OR REPLACE INTO schedules VALUES(?,?,?,?,?)", (pid, body.operation, body.enabled, body.hours, next_run))
        return {"ok": True}

    @app.get("/api/profiles/{pid}/logs")
    async def logs(pid: str, download: bool = False):
        app.state.store.profile(pid)
        rows = app.state.store.rows("SELECT * FROM logs WHERE profile_id=? ORDER BY id DESC LIMIT 2000", (pid,))[::-1]
        if download:
            return Response("\n".join(f"{r['at']} [{r['level']}] {r['message']}" for r in rows), media_type="text/plain; charset=utf-8", headers={"Content-Disposition": "attachment; filename=hh-studio.log"})
        return rows

    @app.delete("/api/profiles/{pid}/logs")
    async def clear_logs(pid: str):
        app.state.store.profile(pid)
        app.state.store.execute("DELETE FROM logs WHERE profile_id=?", (pid,))
        return {"ok": True}

    @app.get("/api/profiles/{pid}/events")
    async def events(pid: str, request: Request, tab: str = ""):
        app.state.store.profile(pid)
        if len(tab) > 64:
            raise HTTPException(422, "Недопустимый идентификатор вкладки")
        async def stream():
            try:
                while not await request.is_disconnected():
                    if tab:
                        # Background tabs throttle JS timers. An open SSE socket is
                        # also a live lease, so a hidden tab remains usable.
                        app.state.manager.heartbeat(tab)
                    payload = snapshot(pid)
                    payload["logs"] = app.state.store.rows("SELECT * FROM logs WHERE profile_id=? ORDER BY id DESC LIMIT 150", (pid,))[::-1]
                    yield "event: state\ndata: " + json.dumps(payload, ensure_ascii=False) + "\n\n"
                    await asyncio.sleep(1)
            finally:
                if tab:
                    app.state.manager.leases.pop(tab, None)
        return StreamingResponse(stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})

    dist = ROOT / "frontend" / "dist"
    if (dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/favicon.svg")
    async def favicon():
        return FileResponse(ROOT / "frontend" / "public" / "favicon.svg")

    @app.get("/")
    async def index():
        if not (dist / "index.html").exists():
            return Response("Frontend ещё не собран. Запустите setup.bat или python run.py --setup.", status_code=503)
        return FileResponse(dist / "index.html")

    return app


app = create_app()
