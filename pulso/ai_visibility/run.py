"""Orquesta una corrida diaria de preguntas, clasificación y costos.

El dry-run nunca escribe en la base. La persistencia queda para cuando se
apruebe y aplique deploy/ai_visibility.sql.
"""
from __future__ import annotations

from datetime import datetime
from typing import Callable
from zoneinfo import ZoneInfo

from pulso.ai.classifier import ClassifierError
from pulso.ai_visibility.classify_answers import (
    DEFAULT_TOPIC_LABELS,
    classify_answers,
    classifier_client,
    extract_other_politicians,
)
from pulso.ai_visibility.client import ResponsesClient, VisibilityError
from pulso.ai_visibility.cost import cost_for_usage, monthly_projection, sum_costs
from pulso.ai_visibility.prompts import render_prompts
from pulso.ai_visibility.settings import VisibilitySettings

TZ = ZoneInfo("America/Argentina/Buenos_Aires")
CANDIDATE_ID_KICILLOF = "2c4f83ed-f2bd-4afe-89a3-fa6263cc5b7e"

LIMITATIONS = [
    "La Responses API no es idéntica a la app ChatGPT: no replica memoria, enrutado, experimentos ni la interfaz de la app.",
    "chat-latest es el Instant model documentado para ChatGPT; OpenAI suele ilustrar búsquedas de producción con gpt-6.2-astra.",
    "El corte de conocimiento de chat-latest es el 20 de abril de 2026; la búsqueda web puede aportar fuentes más recientes.",
    "El clasificador recorta cada respuesta a 1200 caracteres, el mismo tope que usa con las menciones.",
    "Una corrida diaria es una foto fija, no un panel de usuarios distintos.",
]


def _now() -> datetime:
    return datetime.now(TZ)


def already_ran_today(asked_dates: list, now: datetime | None = None) -> bool:
    today = (now or _now()).date()
    for value in asked_dates:
        if hasattr(value, "date") and callable(value.date):
            value = value.date()
        if str(value) == str(today):
            return True
    return False


def ask_one(client: ResponsesClient, prompt: str, use_web_search: bool) -> tuple[dict, bool]:
    """Devuelve (resultado, web_habilitada_despues). Si la herramienta no está
    permitida, reintenta esa pregunta sin web y desactiva la herramienta."""
    try:
        return client.ask(prompt, use_web_search=use_web_search), use_web_search
    except VisibilityError as exc:
        if use_web_search and exc.tool_unsupported:
            return client.ask(prompt, use_web_search=False), False
        raise


def run_visibility(
    settings: VisibilitySettings,
    candidate_name: str,
    *,
    candidate_id: str | None = None,
    candidate_slug: str | None = None,
    prompts: list[dict[str, str]] | None = None,
    topic_ids: dict[str, str] | None = None,
    ask_client: ResponsesClient | None = None,
    classify_client=None,
    log: Callable[..., None] | None = None,
) -> dict:
    if not settings.dry_run:
        raise RuntimeError("La persistencia está deshabilitada hasta aplicar la migración")
    log = log or (lambda **kwargs: None)
    rendered = render_prompts(candidate_name, prompts)
    asked_at = _now()
    own_ask = ask_client is None
    own_cls = classify_client is None
    ask_client = ask_client or ResponsesClient(settings)
    classify_client = classify_client or classifier_client(
        settings.api_key, settings.classify_model, settings.base_url,
    )
    rows: list[dict] = []
    errors: list[dict] = []
    use_web = settings.use_web_search
    web_fallback = False
    try:
        for item in rendered:
            log(event="ai_visibility_ask", prompt_key=item["key"], web_search=use_web)
            try:
                result, use_web_after = ask_one(ask_client, item["text"], use_web)
            except VisibilityError as exc:
                errors.append({"key": item["key"], "kind": exc.kind, "status": exc.status})
                log(event="ai_visibility_ask_error", prompt_key=item["key"],
                    error_type=exc.kind, status=exc.status)
                continue
            if use_web and not use_web_after:
                web_fallback = True
                use_web = False
                log(event="ai_visibility_web_disabled", reason="tool_unsupported")
            cost = cost_for_usage(result["model"], result["usage"], result["web_search_calls"])
            rows.append({
                "key": item["key"],
                "candidate_id": candidate_id,
                "provider": result["provider"],
                "model": result["model"],
                "prompt": result["prompt"],
                "answer": result["answer"],
                "citations": result["citations"],
                "asked_at": asked_at.isoformat(),
                "used_web_search": result["used_web_search"],
                "web_search_requested": result["web_search_requested"],
                "web_search_calls": result["web_search_calls"],
                "usage": result["usage"],
                "cost": cost,
            })
        labels: dict[str, dict] = {}
        politicians: dict[str, list[str]] = {row["key"]: [] for row in rows}
        classify_usage = {}
        politicians_usage = {}
        classify_model = settings.classify_model
        politicians_model = settings.classify_model
        classify_problems: list[str] = []
        if rows:
            try:
                labels, classify_problems, classify_usage, classify_model = classify_answers(
                    classify_client, candidate_name, rows, topic_ids=topic_ids,
                )
            except ClassifierError as exc:
                classify_problems.append(exc.kind)
                log(event="ai_visibility_classify_error", error_type=exc.kind, status=exc.status)
            try:
                politicians, politicians_usage, politicians_model = extract_other_politicians(
                    classify_client, candidate_name, rows,
                )
            except ClassifierError as exc:
                log(event="ai_visibility_entities_error", error_type=exc.kind, status=exc.status)
        classify_cost = cost_for_usage(classify_model, classify_usage, 0)
        politicians_cost = cost_for_usage(politicians_model, politicians_usage, 0)
        for row in rows:
            label = labels.get(row["key"]) or {}
            row["tone"] = label.get("tone")
            row["target"] = label.get("target")
            row["tone_confidence"] = label.get("tone_confidence")
            row["tone_reason"] = label.get("tone_reason")
            row["topic"] = label.get("topic")
            row["relevance"] = label.get("relevance")
            row["other_politicians"] = politicians.get(row["key"]) or []
            row["classification_model"] = classify_model if label else None
        ask_summary = sum_costs([row["cost"] for row in rows])
        run_cost = sum_costs([row["cost"] for row in rows] + [classify_cost, politicians_cost])
        payload = {
            "candidate": {
                "id": candidate_id,
                "slug": candidate_slug,
                "name": candidate_name,
            },
            "provider": "openai",
            "ask_model": settings.ask_model,
            "classify_model": classify_model,
            "web_search_requested": settings.use_web_search,
            "web_search_used": any(row["used_web_search"] for row in rows),
            "web_search_fallback": web_fallback,
            "asked_at": asked_at.isoformat(),
            "timezone": "America/Argentina/Buenos_Aires",
            "dry_run": True,
            "wrote_db": False,
            "prompts": rendered,
            "answers": rows,
            "classify_problems": classify_problems,
            "errors": errors,
            "cost": {
                **run_cost,
                "ask": ask_summary,
                "classifier": classify_cost,
                "other_politicians": politicians_cost,
                "monthly_30d_usd": monthly_projection(run_cost.get("cost_usd")),
            },
            "limitations": LIMITATIONS,
        }
        log(event="ai_visibility_summary", asked=len(rows), errors=len(errors),
            web_search_used=payload["web_search_used"],
            cost_usd=run_cost.get("cost_usd"),
            monthly_30d_usd=payload["cost"]["monthly_30d_usd"])
        return payload
    finally:
        if own_ask:
            ask_client.close()
        if own_cls:
            classify_client.close()
