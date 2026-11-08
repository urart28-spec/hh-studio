import json
from pathlib import Path
from unittest.mock import Mock
import pytest
from backend import worker
from backend.models import Settings


@pytest.fixture
def fake_hh(monkeypatch):
    from hh_applicant_tool.tool import HHApplicantTool
    from hh_applicant_tool.operations.apply_vacancies import Operation
    resume={"id":"resume1","title":"Developer","alternate_url":"https://hh.ru/resume/resume1","status":{"id":"published"}}
    vacancy={"id":"123","name":"Python Developer","description":"Python","alternate_url":"https://hh.ru/vacancy/123","employer":{"id":"42","name":"Team"},"relations":[]}
    api=Mock()
    api.post.return_value={}
    api.get.side_effect=lambda endpoint,**kw: {"id":"user1","first_name":"Name"} if endpoint=="/me" else {"items":[resume]} if endpoint=="/resumes/mine" else vacancy
    monkeypatch.setattr(HHApplicantTool,"api_client",property(lambda _:api))
    monkeypatch.setattr(HHApplicantTool,"get_resume_placeholders",lambda *_:{})
    monkeypatch.setattr(HHApplicantTool,"save_cookies",lambda *_:None)
    monkeypatch.setattr(Operation,"_get_vacancies",lambda *_,**kw:iter([dict(vacancy),dict(vacancy,id="124")]))
    monkeypatch.setattr(Operation,"_load_employer",lambda *_:None)
    monkeypatch.setattr(worker.time,"sleep",lambda *_:None)
    events=[]
    monkeypatch.setattr(worker,"emit",lambda kind,**data:events.append({"type":kind,**data}))
    return api,events


def test_upstream_dry_run_sends_nothing_and_respects_limit(tmp_path,fake_hh):
    api,events=fake_hh
    worker.run({"operation":"apply","config_dir":str(tmp_path),"settings":Settings(max_responses=1).model_dump()})
    assert not api.post.called
    assert not api.put.called
    applications=[e for e in events if e["type"]=="application"]
    assert len(applications)==1 and applications[0]["status"]=="dry_run"


def test_confirmed_send_and_global_limit(tmp_path,fake_hh):
    api,events=fake_hh
    worker.run({"operation":"apply","config_dir":str(tmp_path),"settings":Settings(dry_run=False,max_responses=1).model_dump()})
    assert api.post.call_count==1
    assert api.post.call_args.args[0]=="/negotiations"
    assert [e["status"] for e in events if e["type"]=="application"]==["sent"]


def test_failed_send_never_recorded_as_success(tmp_path,fake_hh):
    api,events=fake_hh
    api.post.side_effect=ValueError("Server did not confirm")
    worker.run({"operation":"apply","config_dir":str(tmp_path),"settings":Settings(dry_run=False,max_responses=1).model_dump()})
    assert not any(e["type"]=="application" and e["status"]=="sent" for e in events)


def test_excluded_company_has_no_remote_side_effects(tmp_path,fake_hh):
    api,events=fake_hh
    worker.run({"operation":"apply","config_dir":str(tmp_path),"settings":Settings(dry_run=False,excluded_companies=["TEAM"]).model_dump()})
    assert not api.post.called and not api.put.called


def test_static_letter_variables_do_not_interpret_arbitrary_braces():
    settings=Settings(cover_letter="{vacancy_name}: {company_name}. {other}").model_dump()
    assert worker.generate_letter(settings,"",{"name":"Dev","employer":{"name":"Team"}})=="Dev: Team. {other}"


def test_ai_key_needed_before_network():
    with pytest.raises(ValueError,match="API"):
        worker.generate_letter(Settings(letter_mode="ai").model_dump(),"",{})


@pytest.mark.parametrize("kind", ["otp", "captcha"])
def test_real_prompt_emits_event_without_logging_answer(monkeypatch, kind):
    from io import StringIO
    from types import SimpleNamespace
    output = StringIO()
    monkeypatch.setattr(worker, "PROTOCOL", output)
    monkeypatch.setattr(worker, "INPUT", StringIO(json.dumps({"prompt_id": "prompt-test", "value": "123456"}) + "\n"))
    monkeypatch.setattr(worker.uuid, "uuid4", lambda: SimpleNamespace(hex="prompt-test"))
    image = "data:image/png;base64,test" if kind == "captcha" else None

    assert worker.ask(kind, "Введите код", image) == "123456"
    event = json.loads(output.getvalue())
    assert event == {"type": "prompt", "kind": kind, "message": "Введите код", "image": image, "prompt_id": "prompt-test"}
    assert "123456" not in output.getvalue()
