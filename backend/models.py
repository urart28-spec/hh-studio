from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

AIProvider = Literal["openai", "anthropic", "gemini", "deepseek", "gigachat"]
GigaChatScope = Literal["GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Settings(StrictModel):
    text: str = Field(default="", max_length=500)
    area: str = Field(default="1", pattern=r"^\d{0,12}$")
    salary: int = Field(default=0, ge=0, le=10000000)
    experience: Literal["", "noExperience", "between1And3", "between3And6", "moreThan6"] = ""
    schedule: Literal["", "fullDay", "shift", "flexible", "remote", "flyInFlyOut"] = ""
    resume_id: str = Field(default="", pattern=r"^[a-zA-Z0-9_-]{0,100}$")
    excluded_words: list[str] = Field(default_factory=list, max_length=100)
    excluded_companies: list[str] = Field(default_factory=list, max_length=100)
    delay_min: int = Field(default=30, ge=10, le=3600)
    delay_max: int = Field(default=60, ge=10, le=3600)
    max_responses: int = Field(default=20, ge=1, le=200)
    total_pages: int = Field(default=3, ge=1, le=20)
    daily_limit: int = Field(default=200, ge=1, le=200)
    dry_run: bool = True
    letter_mode: Literal["static", "ai"] = "static"
    cover_letter: str = Field(default="Здравствуйте! Меня заинтересовала вакансия «{vacancy_name}» в {company_name}. Буду рад обсудить, как мой опыт поможет вашей команде.", max_length=10000)
    provider: AIProvider = "openai"
    model: str = Field(default="gpt-4.1-mini", min_length=1, max_length=100)
    gigachat_scope: GigaChatScope = "GIGACHAT_API_PERS"
    gigachat_ca_bundle: str = Field(default="", max_length=1000, pattern=r"^[^\r\n\x00]*$")
    system_prompt: str = Field(default="Напиши короткое сопроводительное письмо на русском. Используй только указанные факты об опыте. Не придумывай навыки. Верни только текст письма.", max_length=15000)
    experience_context: str = Field(default="", max_length=20000)
    captcha_ocr_enabled: bool = False
    captcha_ocr_auto_submit: bool = False
    captcha_ocr_model: str = Field(default="hh-paddleocr:0.9b-q4_k_m", pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$")
    captcha_ocr_port: int = Field(default=11434, ge=1024, le=65535)
    captcha_ocr_keep_alive: int = Field(default=60, ge=0, le=300)
    captcha_ocr_timeout: int = Field(default=90, ge=5, le=300)

    @model_validator(mode="after")
    def validate_limits(self):
        if self.delay_max < self.delay_min:
            raise ValueError("Максимальная задержка меньше минимальной")
        if any(len(w) > 150 or not w.strip() for w in self.excluded_words + self.excluded_companies):
            raise ValueError("Исключения должны содержать от 1 до 150 символов")
        return self


class ProfileCreate(StrictModel):
    name: str = Field(min_length=1, max_length=60)


class AuthStart(StrictModel):
    username: str = Field(min_length=3, max_length=150, pattern=r"^[^\r\n]+$")


class PromptReply(StrictModel):
    prompt_id: str = Field(min_length=1, max_length=64)
    value: str = Field(min_length=1, max_length=300, pattern=r"^[^\r\n]+$")


class PromptAction(StrictModel):
    prompt_id: str = Field(min_length=1, max_length=64)


class JobStart(StrictModel):
    operation: Literal["apply", "sync", "bump", "demo"]
    resume_id: str = Field(default="", pattern=r"^[a-zA-Z0-9_-]{0,100}$")


class SecretUpdate(StrictModel):
    api_key: str = Field(max_length=1000)
    provider: AIProvider


class ScheduleUpdate(StrictModel):
    operation: Literal["apply", "bump"]
    enabled: bool
    hours: int = Field(default=4, ge=1, le=168)

    @model_validator(mode="after")
    def bump_interval(self):
        if self.operation == "bump" and self.hours < 4:
            raise ValueError("Интервал поднятия — не меньше 4 часов")
        return self
