"""Pausa y modo de recolección por candidato. Sin secretos."""

from __future__ import annotations

from dataclasses import dataclass


FULL_MODE = "full"
MEDIA_ONLY = "media_only"
VALID_MODES = {FULL_MODE, MEDIA_ONLY}


@dataclass(frozen=True)
class CandidateRunPlan:
    slug: str
    country: str | None = None
    collection_mode: str | None = None
    collection_paused: bool = False


def is_collection_paused(row) -> bool:
    """Acepta un dict, un modelo con atributo, o None."""
    if row is None:
        return False
    if isinstance(row, dict):
        return bool(row.get("collection_paused"))
    return bool(getattr(row, "collection_paused", False))


def effective_collection_mode(plan: CandidateRunPlan, env_slugs: list[str] | None = None) -> str:
    """Si la DB trae un modo, manda. Si no, se conserva el comportamiento anterior:

    los slugs que solo aparecen por medios en la DB (no en PULSO_CANDIDATES)
    corren en media_only.
    """
    mode = (plan.collection_mode or "").strip().lower()
    if mode in VALID_MODES:
        return mode
    if env_slugs and plan.slug not in set(env_slugs):
        return MEDIA_ONLY
    return FULL_MODE
