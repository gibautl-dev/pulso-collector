"""Validación posterior al modelo. Lo que no pasa, se descarta y queda registrado.

- El veredicto tiene que estar en la lista y no ser "sin_contradiccion".
- En un par, antes/después tienen que ser exactamente las del par.
- En un señalamiento, después es la nota y antes (si viene) una de sus previas.
- Las refs citadas existen y el texto no trae cifras que no estén en las piezas citadas.
- La sugerencia no puede proponer acciones prohibidas.
- Una "tensión" nunca es severidad alta ni media.
"""

from __future__ import annotations

import re
from typing import Any

from pulso.daily_brief.grounding import _walk_numbers, ungrounded_numbers
from pulso.inconsistency.llm import SEVERITIES, VERDICTS

BANNED = re.compile(
    r"cuentas? (falsas|truchas|anonimas)|bots?\b|respuestas? (en masa|masivas)|responder en masa|"
    r"denuncias? (automaticas?|masivas?)|reportar en (masa|lote)|publicar sin revision|astroturf",
    re.I,
)


def _fold(text: str) -> str:
    import unicodedata

    return "".join(c for c in unicodedata.normalize("NFD", (text or "").casefold()) if not unicodedata.combining(c))


def days_between(a: str | None, b: str | None) -> int | None:
    from datetime import date

    try:
        return abs((date.fromisoformat(str(b)[:10]) - date.fromisoformat(str(a)[:10])).days)
    except (TypeError, ValueError):
        return None


def ground_findings(
    raw: dict[str, Any] | None,
    *,
    pieces_by_ref: dict[str, dict[str, Any]],
    pairs: dict[str, tuple[str, str]],
    flags: dict[str, list[str]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    """Devuelve (aceptados, descartados, revisados_sin_contradiccion)."""
    kept: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    clean = 0
    seen: set[str] = set()
    for f in (raw or {}).get("findings") or []:
        item = str(f.get("item") or "")
        verdict = f.get("verdict")
        text = f"{f.get('why') or ''} {f.get('next_step') or ''}"
        if verdict not in VERDICTS:
            dropped.append({"item": item, "reason": "veredicto_invalido"})
            continue
        if item in seen:
            dropped.append({"item": item, "reason": "duplicado"})
            continue
        if verdict == "sin_contradiccion":
            seen.add(item)
            clean += 1
            continue
        antes, despues = (f.get("antes_ref") or "").strip(), (f.get("despues_ref") or "").strip()
        if item in pairs:
            origin = "par"
            if (antes, despues) != pairs[item]:
                dropped.append({"item": item, "reason": "par_alterado"})
                continue
        elif item in flags:
            origin = "senalamiento"
            if despues != item or (antes and antes not in flags[item]):
                dropped.append({"item": item, "reason": "senalamiento_alterado"})
                continue
        else:
            dropped.append({"item": item, "reason": "item_desconocido"})
            continue
        refs = [r for r in (f.get("refs") or []) if r in pieces_by_ref]
        for r in (antes, despues):
            if r and r not in refs:
                refs.append(r)
        if not refs:
            dropped.append({"item": item, "reason": "sin_fuente"})
            continue
        allowed: set[float] = {1.0, 2.0}
        for r in refs:
            _walk_numbers({k: pieces_by_ref[r].get(k) for k in ("texto", "fecha")}, allowed)
        if antes and despues:
            allowed.add(float(days_between(pieces_by_ref[antes].get("fecha"), pieces_by_ref[despues].get("fecha")) or 0))
        bad = ungrounded_numbers(text, allowed)
        if bad:
            dropped.append({"item": item, "reason": "cifra_sin_respaldo", "numbers": bad})
            continue
        if BANNED.search(_fold(text)):
            dropped.append({"item": item, "reason": "accion_prohibida"})
            continue
        severity = f.get("severity") if f.get("severity") in SEVERITIES else "bajo"
        if verdict == "tension":
            severity = "bajo"
        seen.add(item)
        kept.append({
            "item": item,
            "origin": origin,
            "kind": verdict,
            "severity": severity,
            "topic": (f.get("topic") or "").strip()[:60],
            "antes_ref": antes or None,
            "despues_ref": despues,
            "why": (f.get("why") or "").strip()[:420],
            "next_step": (f.get("next_step") or "").strip()[:280],
            "refs": refs,
        })
    return kept, dropped, clean
