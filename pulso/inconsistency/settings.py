"""Configuración de las alertas de contradicciones. La clave del LLM y la URL no se imprimen."""

from __future__ import annotations

import os
from dataclasses import dataclass

from pulso.crisis.settings import _redact_url


class InconsistencySettingsError(RuntimeError):
    pass


def _num(env, name: str, default: float, lo: float, hi: float) -> float:
    raw = env.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise InconsistencySettingsError(f"{name} no es un número.") from exc
    if not lo <= value <= hi:
        raise InconsistencySettingsError(f"{name} tiene que estar entre {lo} y {hi}.")
    return value


@dataclass(frozen=True)
class InconsistencySettings:
    database_url: str
    database_password: str | None
    llm_api_key: str
    llm_base_url: str
    model: str
    every_hours: int = 6
    lookback_days: int = 90
    new_window_hours: int = 48
    min_statements: int = 10
    min_days: int = 5
    min_gap_days: int = 2
    max_pairs: int = 12
    max_flags: int = 6
    max_cost_per_call_usd: float = 0.02
    max_cost_per_run_usd: float = 0.06
    request_timeout: float = 90
    reasoning_effort: str = "low"

    def __repr__(self) -> str:
        return (
            "InconsistencySettings("
            f"database_url={_redact_url(self.database_url)!r}, llm_api_key='***', "
            f"model={self.model!r}, every_hours={self.every_hours}, max_pairs={self.max_pairs}, "
            f"max_cost_per_call_usd={self.max_cost_per_call_usd})"
        )

    @classmethod
    def from_env(cls, environ=None, *, require_db: bool = True, require_key: bool = True) -> "InconsistencySettings":
        env = os.environ if environ is None else environ
        url = (env.get("CLASSIFIER_DATABASE_URL") or "").strip()
        if require_db:
            if not url:
                raise InconsistencySettingsError(
                    "Falta CLASSIFIER_DATABASE_URL (las alertas escriben con pulso_classifier)."
                )
            if "pulso_classifier" not in url.split("@", 1)[0]:
                raise InconsistencySettingsError("CLASSIFIER_DATABASE_URL tiene que usar el rol pulso_classifier.")
        key = (env.get("LLM_API_KEY") or env.get("OPENAI_API_KEY") or "").strip()
        if require_key and not key:
            raise InconsistencySettingsError("Falta LLM_API_KEY (o OPENAI_API_KEY).")
        return cls(
            database_url=url,
            database_password=(env.get("CLASSIFIER_PGPASSWORD") or "").strip() or None,
            llm_api_key=key,
            llm_base_url=(env.get("LLM_BASE_URL") or "https://api.openai.com/v1").strip().rstrip("/")
            or "https://api.openai.com/v1",
            model=(env.get("PULSO_INCONSISTENCY_MODEL") or env.get("LLM_MODEL") or "gpt-6-luna").strip()
            or "gpt-6-luna",
            every_hours=int(_num(env, "PULSO_INCONSISTENCY_EVERY_HOURS", 6, 1, 24)),
            lookback_days=int(_num(env, "PULSO_INCONSISTENCY_LOOKBACK_DAYS", 90, 7, 365)),
            new_window_hours=int(_num(env, "PULSO_INCONSISTENCY_NEW_WINDOW_HOURS", 48, 6, 168)),
            min_statements=int(_num(env, "PULSO_INCONSISTENCY_MIN_STATEMENTS", 10, 2, 100)),
            min_days=int(_num(env, "PULSO_INCONSISTENCY_MIN_DAYS", 5, 1, 60)),
            min_gap_days=int(_num(env, "PULSO_INCONSISTENCY_MIN_GAP_DAYS", 2, 0, 60)),
            max_pairs=int(_num(env, "PULSO_INCONSISTENCY_MAX_PAIRS", 12, 1, 40)),
            max_flags=int(_num(env, "PULSO_INCONSISTENCY_MAX_FLAGS", 6, 0, 20)),
            max_cost_per_call_usd=_num(env, "PULSO_INCONSISTENCY_MAX_COST_USD", 0.02, 0, 1),
            max_cost_per_run_usd=_num(env, "PULSO_INCONSISTENCY_MAX_RUN_COST_USD", 0.06, 0, 5),
            request_timeout=_num(env, "LLM_TIMEOUT_SECONDS", 90, 5, 600),
            reasoning_effort=(env.get("LLM_REASONING_EFFORT") or "low").strip() or "low",
        )
