"""Validación posterior al modelo: cada afirmación cita menciones reales y
no trae cifras que no estén en los datos. Lo que no pasa, se descarta."""

from __future__ import annotations

import re
from typing import Any

NUM_RE = re.compile(r"(?<![\w])[+\-−]?\d{1,3}(?:\.\d{3})+(?:,\d+)?|[+\-−]?\d+(?:[.,]\d+)?")
ALWAYS_OK = {1.0, 2.0, 7.0, 24.0, 48.0}


def _to_number(token: str) -> float | None:
    t = token.replace("−", "-").lstrip("+-")
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?", t):
        t = t.replace(".", "").replace(",", ".")
    else:
        t = t.replace(",", ".")
    try:
        return round(abs(float(t)), 1)
    except ValueError:
        return None


def numbers_in(text: str) -> set[float]:
    out = set()
    for tok in NUM_RE.findall(text or ""):
        n = _to_number(tok)
        if n is not None:
            out.add(n)
    return out


def _walk_numbers(value: Any, out: set[float]) -> None:
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, (int, float)):
        out.add(round(abs(float(value)), 1))
        return
    if isinstance(value, str):
        out.update(numbers_in(value))
        return
    if isinstance(value, dict):
        for v in value.values():
            _walk_numbers(v, out)
        return
    if isinstance(value, (list, tuple)):
        for v in value:
            _walk_numbers(v, out)


def allowed_numbers(metrics: dict[str, Any], pieces: list[dict[str, Any]], highlights: list[dict[str, Any]]) -> set[float]:
    out: set[float] = set(ALWAYS_OK)
    _walk_numbers(metrics, out)
    _walk_numbers(highlights, out)
    for p in pieces:
        _walk_numbers({k: p.get(k) for k in ("titulo", "extracto", "metricas", "hora", "tema")}, out)
    # Diferencias simples entre cifras del día y su base (p. ej. "+12 críticas").
    comp = metrics.get("comparacion") or {}
    for a, b in (("dia", "dia_anterior"), ("criticas_dia", "criticas_promedio_7d")):
        if isinstance(comp.get(a), (int, float)) and isinstance(comp.get(b), (int, float)):
            out.add(round(abs(comp[a] - comp[b]), 1))
    # Redondeos naturales de cifras con decimales (75,6 -> 76).
    out.update({float(round(n)) for n in list(out)})
    return out


def ungrounded_numbers(text: str, allowed: set[float]) -> list[float]:
    bad = []
    for n in numbers_in(text):
        if n in allowed or round(n) in allowed:
            continue
        bad.append(n)
    return sorted(bad)


def ground_items(
    items: list[dict[str, Any]],
    *,
    ref_to_id: dict[str, str],
    allowed: set[float],
    text_keys: tuple[str, ...],
    section: str,
    dropped: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    kept = []
    for item in items or []:
        refs = [r for r in (item.get("refs") or []) if r in ref_to_id]
        text = " ".join(str(item.get(k) or "") for k in text_keys)
        if not refs:
            dropped.append({"section": section, "reason": "sin_fuente", "text": text[:160]})
            continue
        bad = ungrounded_numbers(text, allowed)
        if bad:
            dropped.append({"section": section, "reason": "cifra_sin_respaldo", "numbers": bad, "text": text[:160]})
            continue
        clean = {k: v for k, v in item.items() if k != "refs"}
        clean["mention_ids"] = list(dict.fromkeys(ref_to_id[r] for r in refs))
        kept.append(clean)
    return kept
