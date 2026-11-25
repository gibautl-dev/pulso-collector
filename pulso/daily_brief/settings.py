"""Configuración del resumen diario. La clave del LLM y la URL no se imprimen."""

from __future__ import annotations

import os
from dataclasses import dataclass

from pulso.crisis.settings import _redact_url


class DailyBriefSettingsError(RuntimeError):
    pass


def _num(env, name: str, default: float, lo: float, hi: float) -> float:
    raw = env.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise DailyBriefSettingsError(f"{name} no es un número.") from exc
    if not lo <= value <= hi:
        raise DailyBriefSettingsError(f"{name} tiene que estar entre {lo} y {hi}.")
    return value


@dataclass(frozen=True)
class DailyBriefSettings:
    database_url: str
    database_password: str | None
    llm_api_key: str
    llm_base_url: str
    model: str
    run_after_hour: int = 8
    max_cost_per_brief_usd: float = 0.05
    max_cost_per_run_usd: float = 0.20
    min_mentions: int = 15
    max_pieces: int = 36
    request_timeout: float = 90
    reasoning_effort: str = "low"

    def __repr__(self) -> str:
        return (
            "DailyBriefSettings("
            f"database_url={_redact_url(self.database_url)!r}, llm_api_key='***', "
            f"model={self.model!r}, run_after_hour={self.run_after_hour}, "
            f"max_cost_per_brief_usd={self.max_cost_per_brief_usd}, min_mentions={self.min_mentions})"
        )

    @classmethod
    def from_env(cls, environ=None, *, require_db: bool = True) -> "DailyBriefSettings":
        env = os.environ if environ is None else environ
        url = (env.get("CLASSIFIER_DATABASE_URL") or "").strip()
        if require_db:
            if not url:
                raise DailyBriefSettingsError(
                    "Falta CLASSIFIER_DATABASE_URL (el resumen escribe con pulso_classifier)."
                )
            if "pulso_classifier" not in url.split("@", 1)[0]:
                raise DailyBriefSettingsError("CLASSIFIER_DATABASE_URL tiene que usar el rol pulso_classifier.")
        key = (env.get("LLM_API_KEY") or env.get("OPENAI_API_KEY") or "").strip()
        if not key:
            raise DailyBriefSettingsError("Falta LLM_API_KEY (o OPENAI_API_KEY).")
        return cls(
            database_url=url,
            database_password=(env.get("CLASSIFIER_PGPASSWORD") or "").strip() or None,
            llm_api_key=key,
            llm_base_url=(env.get("LLM_BASE_URL") or "https://api.openai.com/v1").strip().rstrip("/")
            or "https://api.openai.com/v1",
            model=(env.get("PULSO_DAILY_BRIEF_MODEL") or env.get("LLM_MODEL") or "gpt-6-luna").strip()
            or "gpt-6-luna",
            run_after_hour=int(_num(env, "PULSO_DAILY_BRIEF_HOUR", 8, 0, 23)),
            max_cost_per_brief_usd=_num(env, "PULSO_DAILY_BRIEF_MAX_COST_USD", 0.05, 0, 1),
            max_cost_per_run_usd=_num(env, "PULSO_DAILY_BRIEF_MAX_RUN_COST_USD", 0.20, 0, 5),
            min_mentions=int(_num(env, "PULSO_DAILY_BRIEF_MIN_MENTIONS", 15, 1, 1000)),
            max_pieces=int(_num(env, "PULSO_DAILY_BRIEF_MAX_PIECES", 36, 5, 60)),
            request_timeout=_num(env, "LLM_TIMEOUT_SECONDS", 90, 5, 600),
            reasoning_effort=(env.get("LLM_REASONING_EFFORT") or "low").strip() or "low",
        )
