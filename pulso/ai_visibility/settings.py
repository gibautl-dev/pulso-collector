"""Configuración del módulo. La clave nunca va a logs ni a repr()."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from pulso.ai.classifier import DEFAULT_BASE_URL, DEFAULT_MODEL as CLASSIFIER_MODEL

DEFAULT_ASK_MODEL = "chat-latest"
DEFAULT_PROVIDER = "openai"


def api_key_from_env() -> str:
    # En producción el recolector usa LLM_API_KEY; en este box puede estar OPENAI_API_KEY.
    key = (os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or "").strip()
    if not key:
        raise ValueError("Falta LLM_API_KEY o OPENAI_API_KEY en el entorno")
    return key


def _bool(name: str, default: str) -> bool:
    value = os.getenv(name, default).strip().lower()
    if value not in {"true", "false"}:
        raise ValueError(f"{name} debe ser true o false")
    return value == "true"


def _float(name: str, default: float, low: float, high: float) -> float:
    value = float(os.getenv(name, str(default)))
    if not low <= value <= high:
        raise ValueError(f"{name} fuera de rango {low}..{high}")
    return value


def _int(name: str, default: int, low: int, high: int) -> int:
    value = int(os.getenv(name, str(default)))
    if not low <= value <= high:
        raise ValueError(f"{name} fuera de rango {low}..{high}")
    return value


@dataclass(frozen=True)
class VisibilitySettings:
    api_key: str = field(repr=False)
    base_url: str = DEFAULT_BASE_URL
    provider: str = DEFAULT_PROVIDER
    ask_model: str = DEFAULT_ASK_MODEL
    classify_model: str = CLASSIFIER_MODEL
    use_web_search: bool = True
    request_timeout: float = 120.0
    max_retries: int = 2
    dry_run: bool = True
    run_after_hour: int = 9

    @classmethod
    def from_env(cls, dry_run: bool | None = None) -> "VisibilitySettings":
        base = (os.getenv("LLM_BASE_URL", "").strip() or DEFAULT_BASE_URL).rstrip("/")
        if urlsplit(base).scheme != "https":
            raise ValueError("LLM_BASE_URL debe ser https")
        flag = dry_run if dry_run is not None else _bool("PULSO_AI_VISIBILITY_DRY_RUN", "false")
        return cls(
            api_key=api_key_from_env(),
            base_url=base,
            ask_model=(os.getenv("PULSO_AI_VISIBILITY_MODEL", "").strip() or DEFAULT_ASK_MODEL),
            classify_model=(os.getenv("LLM_MODEL", "").strip() or CLASSIFIER_MODEL),
            use_web_search=_bool("PULSO_AI_VISIBILITY_WEB_SEARCH", "true"),
            request_timeout=_float("PULSO_AI_VISIBILITY_TIMEOUT", 120.0, 15.0, 300.0),
            max_retries=_int("PULSO_AI_VISIBILITY_MAX_RETRIES", 2, 0, 5),
            dry_run=flag,
            run_after_hour=_int("PULSO_AI_VISIBILITY_HOUR", 9, 0, 23),
        )
