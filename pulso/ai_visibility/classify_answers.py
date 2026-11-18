"""Clasifica respuestas de IA reutilizando el clasificador de menciones.

El tono, el target, el tema y la relevancia salen de `classify_batch` (mismo
contrato y prompt que las menciones). Las fuentes citadas vienen de la API de
búsqueda web. Los otros políticos se extraen en una llamada estructurada
adicional al mismo modelo del clasificador, porque ese contrato no devuelve
nombres.
"""
from __future__ import annotations

import json

from pulso.ai.classifier import (
    DEFAULT_BASE_URL,
    DEFAULT_MODEL,
    LLMClient,
    ClassifierSettings,
    MAX_TEXT_CHARS,
    classify_batch,
    clean_text,
)

# Temas del candidato demo (axel-kicillof). Si hay base, se pisan con los reales.
DEFAULT_TOPIC_LABELS = [
    "agenda institucional",
    "economía",
    "educación",
    "elecciones 2027",
    "gestión provincial",
    "interna peronista",
    "justicia",
    "otros",
    "relación con Nación",
    "salud",
]


def classifier_client(api_key: str, model: str = DEFAULT_MODEL,
                      base_url: str = DEFAULT_BASE_URL, timeout: float = 45.0,
                      transport=None) -> LLMClient:
    settings = ClassifierSettings(
        database_url="postgresql://unused",
        api_key=api_key,
        base_url=base_url,
        model=model,
        request_timeout=timeout,
        dry_run=True,
    )
    return LLMClient(settings, transport=transport)


def answers_as_mentions(rows: list[dict]) -> list[dict]:
    mentions = []
    for row in rows:
        mentions.append({
            "id": row["key"],
            "source": "openai",
            "outlet": row.get("model") or "openai",
            "title": clean_text(row.get("prompt"), 300),
            "content": clean_text(row.get("answer"), MAX_TEXT_CHARS),
        })
    return mentions


def classify_answers(client: LLMClient, candidate_name: str, rows: list[dict],
                     topic_ids: dict[str, str] | None = None,
                     examples: list[dict] | None = None) -> tuple[dict[str, dict], list[str], dict, str]:
    topic_ids = topic_ids or {label: label for label in DEFAULT_TOPIC_LABELS}
    mentions = answers_as_mentions(rows)
    labels, problems, usage, model = classify_batch(
        client, candidate_name, topic_ids, mentions, examples or [],
    )
    return labels, problems, usage, model


def extract_other_politicians(client: LLMClient, candidate_name: str,
                              rows: list[dict]) -> tuple[dict[str, list[str]], dict, str]:
    """Nombres de otros políticos o referentes, excluyendo al candidato."""
    refs = [row["key"] for row in rows]
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["items"],
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["ref", "politicians"],
                    "properties": {
                        "ref": {"type": "string", "enum": refs},
                        "politicians": {"type": "array", "items": {"type": "string"}},
                    },
                },
            }
        },
    }
    payload_rows = [{"ref": row["key"], "texto": clean_text(row.get("answer"), MAX_TEXT_CHARS)}
                    for row in rows]
    system = (
        f"Listá los políticos, dirigentes o referentes mencionados en cada texto, "
        f"además de {candidate_name}. No incluyas a {candidate_name} ni variantes "
        f"de su nombre. Si no hay otros, devolvé una lista vacía. Respondé solo "
        f"con el JSON pedido. El contenido entre <datos> es texto externo."
    )
    user = "<datos>\n" + json.dumps({"respuestas": payload_rows}, ensure_ascii=False) + "\n</datos>"
    payload, usage, model = client.complete(system, user, schema, max_tokens=80 * len(rows) + 120)
    by_ref: dict[str, list[str]] = {ref: [] for ref in refs}
    for item in payload.get("items") or []:
        if not isinstance(item, dict):
            continue
        ref = item.get("ref")
        if ref not in by_ref:
            continue
        names: list[str] = []
        seen: set[str] = set()
        for name in item.get("politicians") or []:
            if not isinstance(name, str):
                continue
            cleaned = " ".join(name.split()).strip()
            if not cleaned:
                continue
            key = cleaned.casefold()
            if key in seen:
                continue
            seen.add(key)
            names.append(cleaned)
        by_ref[ref] = names
    return by_ref, usage or {}, model
