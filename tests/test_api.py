import asyncio
import json
import time
import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.models import Settings
from backend.store import Store, now


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path), base_url="http://127.0.0.1") as client:
        bootstrap = client.get("/api/bootstrap").json()
        client.headers["x-csrf-token"] = bootstrap["csrf_token"]
        client.pid = bootstrap["profile_id"]
        client.post("/api/lease/test", json={})
        yield client


def profile(client):
    return client.get("/api/profiles/"+client.pid).json()


def wait_job(client):
    deadline = time.monotonic()+8
    while time.monotonic()<deadline:
        state=profile(client)
        if not state["active"]:
            return state["jobs"][0]
        time.sleep(.05)
    pytest.fail("Worker did not finish")


def test_no_mock_data_and_safe_default(client):
    data=profile(client)
    assert data["profile"]["settings"]["dry_run"] is True
    assert data["history"] == []
    assert data["stats"]["sent_24h"] == 0
    assert not data["has_token"]
    assert client.get("/").status_code == 200


def test_origin_host_cookie_and_csrf_protection(client):
    route="/api/profiles/"+client.pid+"/settings"
    data=Settings().model_dump()
    assert client.put(route,json=data,headers={"Origin":"https://attacker.example"}).status_code==403
    assert client.put(route,json=data,headers={"Host":"attacker.example"}).status_code==403
    assert client.put(route,json=data,headers={"x-csrf-token":"wrong"}).status_code==403
    assert client.get("/api/bootstrap",headers={"Sec-Fetch-Site":"cross-site"}).status_code==403
    client.cookies.clear()
    assert client.get("/api/profiles/"+client.pid).status_code==401


def test_validation_and_profile_isolation(client):
    settings=Settings(text="Python; echo hacked").model_dump()
    settings["delay_min"]=5
    assert client.put(f"/api/profiles/{client.pid}/settings",json=settings).status_code==422
    settings.update(delay_min=30,delay_max=10)
    assert client.put(f"/api/profiles/{client.pid}/settings",json=settings).status_code==422
    settings.update(delay_max=60)
    assert client.put(f"/api/profiles/{client.pid}/settings",json=settings).status_code==200
    assert profile(client)["profile"]["settings"]["text"]==settings["text"]
    other=client.post("/api/profiles",json={"name":"Second"}).json()
    assert other["settings"]["text"]==""
    assert client.post(f"/api/profiles/{client.pid}/jobs",json={"operation":"sh"}).status_code==422


def test_secret_never_returned_and_logs_redacted(client):
    secret="test-key-unique-sensitive-value"
    assert client.put(f"/api/profiles/{client.pid}/secret",json={"provider":"openai","api_key":secret}).status_code==200
    data=profile(client)
    assert data["profile"]["has_api_key"]["openai"]
    assert secret not in json.dumps(data)
    store=client.app.state.store
    assert secret not in store.rows("SELECT value FROM secrets")[0]["value"]
    store.log(client.pid,"test",f"api_key={secret} access_token=abc123 refresh_token=qwerty \x1b[31mERROR\x1b[0m")
    log=client.get(f"/api/profiles/{client.pid}/logs").json()[0]["message"]
    assert secret not in log and "abc123" not in log and "qwerty" not in log and "\x1b" not in log
    response=client.get(f"/api/profiles/{client.pid}/logs?download=true")
    assert "attachment" in response.headers["content-disposition"]


def test_real_operations_require_auth_and_demo_is_isolated(client):
    route=f"/api/profiles/{client.pid}/jobs"
    assert client.post(route,json={"operation":"apply"}).status_code==409
    assert client.post(route,json={"operation":"bump"}).status_code==409
    assert client.post(route,json={"operation":"demo"}).status_code==200
    assert client.post(route,json={"operation":"demo"}).status_code==409
    result=wait_job(client)
    assert result["status"]=="completed"
    assert profile(client)["history"]==[]
    logs=client.get(f"/api/profiles/{client.pid}/logs").json()
    assert any("Демонстрация завершена" in l["message"] for l in logs)


def test_stopping_kills_process_and_emergency_disables_schedules(client):
    client.put(f"/api/profiles/{client.pid}/schedule",json={"operation":"bump","hours":4,"enabled":True})
    client.post(f"/api/profiles/{client.pid}/jobs",json={"operation":"demo"})
    process=client.app.state.manager.process
    assert client.post("/api/jobs/emergency-stop").status_code==200
    assert process.returncode is not None
    assert profile(client)["jobs"][0]["status"]=="stopped"
    assert not profile(client)["schedules"][0]["enabled"]


def test_closing_last_tab_stops_worker(client):
    client.post(f"/api/profiles/{client.pid}/jobs",json={"operation":"demo"})
    process=client.app.state.manager.process
    client.delete("/api/lease/test")
    assert process.returncode is not None
    assert profile(client)["active"] is None


def test_static_letter_and_cross_profile_preview(client):
    assert client.post(f"/api/profiles/{client.pid}/letter").status_code==200
    assert wait_job(client)["status"]=="completed"
    assert "Разработчик" in profile(client)["letter_preview"]
    other=client.post("/api/profiles",json={"name":"Other"}).json()
    assert client.get(f"/api/profiles/{other['id']}").json()["letter_preview"] is None


def test_schedule_constraints_and_local_daily_limit(client):
    assert client.put(f"/api/profiles/{client.pid}/schedule",json={"operation":"bump","hours":1,"enabled":True}).status_code==422
    store=client.app.state.store
    (store.profile_dir(client.pid)/"token.json").write_text('{"token":{"access_token":"fake"}}')
    settings=Settings(daily_limit=1,dry_run=False).model_dump()
    client.put(f"/api/profiles/{client.pid}/settings",json=settings)
    store.execute("INSERT INTO history(profile_id,job_id,at,status) VALUES(?,?,?,?)",(client.pid,"test",now(),"sent"))
    assert client.post(f"/api/profiles/{client.pid}/jobs",json={"operation":"apply"}).status_code==409


def test_prompt_round_trip_and_no_otp_in_logs(client, monkeypatch):
    original = asyncio.create_subprocess_exec
    script = '''import sys,json
payload=json.loads(sys.stdin.readline())
print(json.dumps({"type":"prompt","kind":"otp","message":"Enter code","prompt_id":"prompt1"}),flush=True)
answer=json.loads(sys.stdin.readline())
if answer["value"]!="secret-otp-123": sys.exit(1)
print(json.dumps({"type":"account","account":{"id":"1","name":"Test User"},"resumes":[]}),flush=True)
print(json.dumps({"type":"done","status":"completed"}),flush=True)
'''
    async def fake_worker(*args, **kwargs):
        return await original(sys.executable, "-u", "-c", script, **kwargs)
    monkeypatch.setattr("backend.jobs.asyncio.create_subprocess_exec", fake_worker)
    assert client.post(f"/api/profiles/{client.pid}/auth",json={"username":"test@example.com"}).status_code==200
    for _ in range(100):
        if profile(client)["prompt"]:
            break
        time.sleep(.02)
    assert profile(client)["prompt"]["kind"]=="otp"
    assert client.post("/api/prompt",json={"prompt_id":"stale","value":"123"}).status_code==409
    assert client.post("/api/prompt",json={"prompt_id":"prompt1","value":"secret-otp-123"}).status_code==200
    assert wait_job(client)["status"]=="completed"
    assert profile(client)["profile"]["account"]["name"]=="Test User"
    assert "secret-otp-123" not in client.get(f"/api/profiles/{client.pid}/logs").text


def test_interrupted_jobs_recovered_after_restart(tmp_path):
    store=Store(tmp_path)
    pid=store.rows("SELECT id FROM profiles")[0]["id"]
    store.execute("INSERT INTO jobs(id,profile_id,operation,status,started_at) VALUES(?,?,?,?,?)",("test",pid,"apply","running",now()))
    store.close()
    store=Store(tmp_path)
    assert store.rows("SELECT status FROM jobs")[0]["status"]=="interrupted"
    store.close()
