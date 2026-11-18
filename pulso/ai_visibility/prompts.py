"""Preguntas neutrales, configurables por candidato.

Si el candidato no tiene una lista propia, se usan estas diez. El texto admite
el placeholder {name}. Deben parecer preguntas de un votante, no una consigna.
"""
from __future__ import annotations

import json
from pathlib import Path

DEFAULT_PROMPTS: list[dict[str, str]] = [
    {
        "key": "quien_es",
        "text": "¿Quién es {name} y cuál es su trayectoria política?",
    },
    {
        "key": "seguridad",
        "text": (
            "¿Cómo se evalúa la gestión de {name} en materia de seguridad, "
            "en particular en la provincia de Buenos Aires?"
        ),
    },
    {
        "key": "economia",
        "text": (
            "¿Cómo se evalúa la gestión económica de {name} y el manejo de "
            "las cuentas públicas bonaerenses?"
        ),
    },
    {
        "key": "educacion",
        "text": "¿Cómo se evalúa la gestión de {name} en educación?",
    },
    {
        "key": "salud",
        "text": "¿Cómo se evalúa la gestión de {name} en salud?",
    },
    {
        "key": "polemicas",
        "text": (
            "¿Cuáles son las principales polémicas, críticas o controversias "
            "asociadas a {name}?"
        ),
    },
    {
        "key": "presidente",
        "text": (
            "Según lo que se publica y se debate, ¿sería {name} un buen "
            "presidente de Argentina?"
        ),
    },
    {
        "key": "comparacion_milei",
        "text": (
            "¿Cómo se compara {name} con Javier Milei en el debate político "
            "actual de Argentina?"
        ),
    },
    {
        "key": "peronismo",
        "text": (
            "¿Cómo se relaciona {name} con Cristina Fernández de Kirchner y "
            "con el peronismo?"
        ),
    },
    {
        "key": "elecciones_2027",
        "text": (
            "¿Qué propuestas, posicionamientos o escenarios se mencionan para "
            "{name} de cara a las elecciones de 2027?"
        ),
    },
]


def load_prompt_overrides(path: Path | None) -> list[dict[str, str]] | None:
    """Lee una lista JSON de {key, text}. Devuelve None si no hay archivo."""
    if path is None:
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        rows = payload.get("prompts") or payload.get("questions") or []
    else:
        rows = payload
    if not isinstance(rows, list) or not rows:
        raise ValueError("prompts_invalidos")
    out: list[dict[str, str]] = []
    for row in rows:
        if not isinstance(row, dict) or not row.get("key") or not row.get("text"):
            raise ValueError("prompts_invalidos")
        out.append({"key": str(row["key"]), "text": str(row["text"])})
    if not 8 <= len(out) <= 12:
        raise ValueError("prompts_fuera_de_rango")
    keys = [p["key"] for p in out]
    if len(keys) != len(set(keys)):
        raise ValueError("prompts_duplicados")
    return out


def render_prompts(candidate_name: str, prompts: list[dict[str, str]] | None = None) -> list[dict[str, str]]:
    name = (candidate_name or "").strip()
    if not name:
        raise ValueError("candidato_sin_nombre")
    source = prompts or DEFAULT_PROMPTS
    rendered: list[dict[str, str]] = []
    for item in source:
        text = item["text"].replace("{name}", name)
        rendered.append({"key": item["key"], "text": text})
    return rendered
