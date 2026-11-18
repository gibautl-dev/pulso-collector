"""Orquesta una corrida diaria de preguntas, análisis de balance y costos.

El dry-run nunca escribe en la base. La escritura usa el rol pulso_classifier.
La corrida programada espera a las 09:00 (hora de Argentina) y se saltea si
ya hay filas de ese día, salvo --force.
"""
from __future__ import annotations

from datetime import datetime
from typing import Callable
from zoneinfo import ZoneInfo

from pulso.ai.classifier import ClassifierError
from pulso.ai_visibility.citations import annotate_citations
from pulso.ai_visibility.classify_answers import (
    DEFAULT_TOPIC_LABELS,
    analyze_answers,
    attach_analysis,
    classifier_client,
)
from pulso.ai_visibility.client import ResponsesClient, VisibilityError
from pulso.ai_visibility.cost import cost_for_usage, monthly_projection, sum_costs
from pulso.ai_visibility.prompts import render_prompts
from pulso.ai_visibility.settings import VisibilitySettings

TZ = ZoneInfo("America/Argentina/Buenos_Aires")
CANDIDATE_ID_KICILLOF = "2c4f83ed-f2bd-4afe-89a3-fa6263cc5b7e"
DEFAULT_SLUG = "axel-kicillof"
DEFAULT_NAME = "Axel Kicillof"
DEFAULT_RUN_HOUR = 9

LIMITATIONS = [
    "La Responses API no es idéntica a la app ChatGPT: no replica memoria, enrutado, experimentos ni la interfaz de la app.",
    "chat-latest es el Instant model documentado para ChatGPT; OpenAI suele ilustrar búsquedas de producción con gpt-6.2-astra.",
    "El corte de conocimiento de chat-latest es el 20 de abril de 2026; la búsqueda web puede aportar fuentes más recientes.",
    "Se pide una respuesta de 250 a 400 palabras, parecida a la que leería un usuario en el chat, no un informe extenso.",
    "El análisis de balance cubre la respuesta completa. El filtro de citas descarta orígenes ajenos a Argentina o fuera de tema solo cuando es obvio.",
    "Una corrida diaria a las 09:00 (hora de Argentina) es una foto fija, no un panel de usuarios distintos.",
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


def should_run_now(now: datetime | None = None, hour: int = DEFAULT_RUN_HOUR,
                   already: bool = False, force: bool = False) -> tuple[bool, str | None]:
    current = now or _now()
    if force:
        return True, None
    if already:
        return False, "already_ran_today"
    if current.hour < hour:
        return False, "before_hour"
    return True, None


def daily_balance(rows: list[dict]) -> float | None:
    scores = [row.get("balance") for row in rows if isinstance(row.get("balance"), int)]
    if not scores:
        return None
    return round(sum(scores) / len(scores), 1)


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
    topic_labels: list[str] | None = None,
    ask_client: ResponsesClient | None = None,
    classify_client=None,
    database=None,
    force: bool = False,
    already: bool = False,
    now: datetime | None = None,
    log: Callable[..., None] | None = None,
) -> dict:
    log = log or (lambda **kwargs: None)
    asked_at = now or _now()
    ok, reason = should_run_now(asked_at, settings.run_after_hour, already=already, force=force)
    if not ok:
        log(event="ai_visibility_skipped", reason=reason, hour=settings.run_after_hour)
        return {
            "skipped": True,
            "reason": reason,
            "dry_run": settings.dry_run,
            "wrote_db": False,
            "answers": [],
            "asked_at": asked_at.isoformat(),
            "timezone": "America/Argentina/Buenos_Aires",
        }
    rendered = render_prompts(candidate_name, prompts)
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
    saved = 0
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
                "citations": annotate_citations(result["citations"]),
                "asked_at": asked_at.isoformat(),
                "used_web_search": result["used_web_search"],
                "web_search_requested": result["web_search_requested"],
                "web_search_calls": result["web_search_calls"],
                "usage": result["usage"],
                "cost": cost,
            })
        classify_usage: dict = {}
        classify_model = settings.classify_model
        classify_problems: list[str] = []
        if rows:
            try:
                labels, classify_problems, classify_usage, classify_model = analyze_answers(
                    classify_client, candidate_name, rows,
                    topic_labels=topic_labels or DEFAULT_TOPIC_LABELS,
                )
                attach_analysis(rows, labels, classify_model)
            except ClassifierError as exc:
                classify_problems.append(exc.kind)
                log(event="ai_visibility_classify_error", error_type=exc.kind, status=exc.status)
                attach_analysis(rows, {}, classify_model)
        classify_cost = cost_for_usage(classify_model, classify_usage, 0)
        ask_summary = sum_costs([row["cost"] for row in rows])
        run_cost = sum_costs([row["cost"] for row in rows] + [classify_cost])
        wrote = False
        if not settings.dry_run:
            if database is None:
                raise RuntimeError("Para guardar hace falta la conexión del rol pulso_classifier")
            if not candidate_id:
                raise RuntimeError("Para guardar hace falta el id del candidato")
            saved = database.save_answers(rows, asked_at, asked_at.date())
            wrote = saved > 0
        score = daily_balance(rows)
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
            "asked_on": asked_at.date().isoformat(),
            "timezone": "America/Argentina/Buenos_Aires",
            "dry_run": settings.dry_run,
            "wrote_db": wrote,
            "saved": saved,
            "daily_balance": score,
            "prompts": rendered,
            "answers": rows,
            "classify_problems": classify_problems,
            "errors": errors,
            "skipped": False,
            "cost": {
                **run_cost,
                "ask": ask_summary,
                "classifier": classify_cost,
                "monthly_30d_usd": monthly_projection(run_cost.get("cost_usd")),
            },
            "limitations": LIMITATIONS,
        }
        log(event="ai_visibility_summary", asked=len(rows), errors=len(errors),
            web_search_used=payload["web_search_used"],
            daily_balance=score,
            cost_usd=run_cost.get("cost_usd"),
            monthly_30d_usd=payload["cost"]["monthly_30d_usd"],
            wrote_db=wrote, saved=saved)
        return payload
    finally:
        if own_ask:
            ask_client.close()
        if own_cls:
            classify_client.close()
