"""Configuración del job de crisis. La clave del LLM y la URL no se imprimen."""

from __future__ import annotations

import os
from dataclasses import dataclass


class CrisisSettingsError(RuntimeError):
    pass


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on", "si", "sí"}


def _money(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise CrisisSettingsError(f"{name} no es un número.") from exc
    if value < 0:
        raise CrisisSettingsError(f"{name} no puede ser negativo.")
    return value


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise CrisisSettingsError(f"{name} no es un entero.") from exc
    if value < 0:
        raise CrisisSettingsError(f"{name} no puede ser negativo.")
    return value


def _redact_url(url: str) -> str:
    if "://" not in url:
        return "<redacted>"
    scheme, rest = url.split("://", 1)
    if "@" in rest:
        rest = rest.split("@", 1)[1]
        return f"{scheme}://<redacted>@{rest}"
    return f"{scheme}://<redacted>"


@dataclass(frozen=True)
class CrisisSettings:
    """Credenciales del clasificador + LLM. El collector no ve esta URL ni la clave."""

    database_url: str
    database_password: str | None
    llm_api_key: str
    llm_base_url: str
    model: str
    enabled: bool
    max_cost_usd: float
    max_briefs_per_run: int
    request_timeout: float
    reasoning_effort: str
    max_retries: int

    def __repr__(self) -> str:
        return (
            "CrisisSettings("
            f"database_url={_redact_url(self.database_url)!r}, "
            "llm_api_key='***', "
            f"llm_base_url={self.llm_base_url!r}, "
            f"model={self.model!r}, "
            f"enabled={self.enabled}, "
            f"max_cost_usd={self.max_cost_usd}, "
            f"max_briefs_per_run={self.max_briefs_per_run})"
        )

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> "CrisisSettings":
        env = os.environ if environ is None else environ
        url = (env.get("CLASSIFIER_DATABASE_URL") or "").strip()
        if not url:
            raise CrisisSettingsError(
                "Falta CLASSIFIER_DATABASE_URL (el job escribe con pulso_classifier, no con el collector)."
            )
        if "pulso_classifier" not in url.split("@", 1)[0]:
            raise CrisisSettingsError(
                "CLASSIFIER_DATABASE_URL tiene que usar el rol pulso_classifier."
            )
        key = (env.get("LLM_API_KEY") or env.get("OPENAI_API_KEY") or "").strip()
        if not key:
            raise CrisisSettingsError("Falta LLM_API_KEY (o OPENAI_API_KEY) para armar el brief.")
        base = (env.get("LLM_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
        model = (env.get("LLM_MODEL") or env.get("PULSO_CRISIS_AGENT_MODEL") or "gpt-6-luna").strip()
        return cls(
            database_url=url,
            database_password=(env.get("CLASSIFIER_PGPASSWORD") or "").strip() or None,
            llm_api_key=key,
            llm_base_url=base,
            model=model,
            enabled=_flag("PULSO_CRISIS_AGENT_ENABLED", False),
            max_cost_usd=_money("PULSO_CRISIS_AGENT_MAX_COST_USD", 0.50),
            max_briefs_per_run=_int("PULSO_CRISIS_AGENT_MAX_BRIEFS", 3),
            request_timeout=float(env.get("LLM_TIMEOUT_SECONDS") or 90),
            reasoning_effort=(env.get("LLM_REASONING_EFFORT") or "low").strip() or "low",
            max_retries=int(env.get("LLM_MAX_RETRIES") or 2),
        )
