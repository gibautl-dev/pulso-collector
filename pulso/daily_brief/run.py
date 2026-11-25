"""Arma el resumen diario de cada candidato. Una vez por día, después de la hora configurada."""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

from pulso.daily_brief import PROMPT_VERSION
from pulso.daily_brief.grounding import allowed_numbers, ground_items
from pulso.daily_brief.llm import DailyBriefLLM, build_messages, build_schema, estimate_cost
from pulso.daily_brief.metrics import (
    compute_metrics,
    day_bounds,
    default_highlight,
    highlight_options,
    select_pieces,
    spanish_date,
    window_since,
)
from pulso.region import profile_for

log = logging.getLogger("pulso.daily_brief")


@dataclass
class CandidateOutcome:
    slug: str
    brief_date: str | None = None
    status: str = "pending"
    cost_usd: float = 0.0
    brief_id: str | None = None
    dropped_items: int = 0
    error: str | None = None
    row: dict[str, Any] | None = None


@dataclass
class RunOutcome:
    candidates: list[CandidateOutcome] = field(default_factory=list)
    cost_usd: float = 0.0

    def as_dict(self, include_rows: bool = False) -> dict[str, Any]:
        items = []
        for c in self.candidates:
            d = asdict(c)
            if not include_rows:
                d.pop("row", None)
            items.append(d)
        return {"cost_usd": round(self.cost_usd, 6), "candidates": items}


def target_date(now: datetime, tz) -> date:
    return now.astimezone(tz).date() - timedelta(days=1)


def _insufficient_output(metrics: dict[str, Any], name: str) -> dict[str, Any]:
    return {
        "headline": f"Pocos datos el {metrics['fecha_texto']} para un resumen de {name}",
        "highlight": {
            "key": "volumen",
            "value": str(metrics["menciones"]["dia"]),
            "label": "menciones de terceros en el día",
            "delta": None,
            "tone": "neutral",
        },
        "what_changed": [],
        "why_it_matters": [],
        "what_to_do": [],
        "insufficient_reason": metrics["motivo_insuficiente"],
        "aclaracion": "",
        "sources": [],
    }


def build_brief(
    *,
    candidate: dict[str, Any],
    data: dict[str, Any],
    brief_date: date,
    settings: Any,
    llm: DailyBriefLLM | None,
    budget_left: float,
    now: datetime,
) -> dict[str, Any]:
    """Devuelve la fila a guardar en daily_briefs (sin escribir)."""
    profile = profile_for(candidate["slug"])
    tz = profile.zone
    name = candidate.get("name") or candidate["slug"]
    metrics = compute_metrics(
        candidate=candidate,
        mentions=data.get("mentions") or [],
        topics=data.get("topics") or [],
        brief_date=brief_date,
        tz=tz,
        ads=data.get("ads"),
        ad_classifications=data.get("ad_classifications"),
        alerts=data.get("alerts"),
        show_ads=profile.show_meta_ads,
        min_mentions=settings.min_mentions,
    )
    row: dict[str, Any] = {
        "candidate_id": str(candidate["id"]),
        "brief_date": brief_date.isoformat(),
        "timezone": profile.timezone,
        "metrics": metrics,
        "prompt_version": PROMPT_VERSION,
        "model": None,
        "cost_usd": 0,
        "usage": {},
        "input_ref": {"mention_ids": []},
    }
    if not metrics["suficiente"]:
        out = _insufficient_output(metrics, name)
        out["coordinator"] = {"generated_at": now.isoformat(), "human_review_required": True, "auto_publish": False}
        return {**row, "status": "insufficient", "headline": out["headline"], "output": out}

    rising_ids = [r["topic_id"] for r in metrics["temas_en_suba"]]
    pieces = select_pieces(
        data.get("mentions") or [], brief_date=brief_date, tz=tz, topics=data.get("topics") or [],
        rising_topic_ids=rising_ids, limit=settings.max_pieces,
    )
    highlights = highlight_options(metrics, name)
    system, user = build_messages(
        candidate_name=name, language_style=profile.language_style, tz_label=profile.tz_label,
        metrics=metrics, pieces=pieces, highlights=highlights,
    )
    estimate = estimate_cost(settings.model, system, user)
    cap = min(settings.max_cost_per_brief_usd, budget_left)
    if estimate is not None and estimate > cap and len(pieces) > 12:
        pieces = pieces[:12]
        system, user = build_messages(
            candidate_name=name, language_style=profile.language_style, tz_label=profile.tz_label,
            metrics=metrics, pieces=pieces, highlights=highlights,
        )
        estimate = estimate_cost(settings.model, system, user)
    if estimate is None or estimate > cap or llm is None:
        reason = "no_llm" if llm is None else ("unknown_price" if estimate is None else "cost_cap")
        return {**row, "status": "skipped", "headline": None, "output": {"skip_reason": reason}}

    result = llm.complete(system, user, build_schema([h["key"] for h in highlights]))
    raw = result.output or {}
    ref_to_id = {p["ref"]: p["id"] for p in pieces}
    allowed = allowed_numbers(metrics, pieces, highlights)
    dropped: list[dict[str, Any]] = []
    changed = ground_items(raw.get("what_changed"), ref_to_id=ref_to_id, allowed=allowed,
                           text_keys=("text",), section="what_changed", dropped=dropped)
    matters = ground_items(raw.get("why_it_matters"), ref_to_id=ref_to_id, allowed=allowed,
                           text_keys=("text",), section="why_it_matters", dropped=dropped)
    todo = ground_items(raw.get("what_to_do"), ref_to_id=ref_to_id, allowed=allowed,
                        text_keys=("action", "why"), section="what_to_do", dropped=dropped)
    headline = (raw.get("headline") or "").strip()
    from pulso.daily_brief.grounding import ungrounded_numbers

    if not headline or ungrounded_numbers(headline, allowed):
        dropped.append({"section": "headline", "reason": "cifra_sin_respaldo", "text": headline[:160]})
        headline = f"Resumen del {spanish_date(brief_date)}"
    aclaracion = (raw.get("aclaracion") or "").strip()
    if aclaracion and ungrounded_numbers(aclaracion, allowed):
        aclaracion = ""
    by_key = {h["key"]: h for h in highlights}
    highlight = by_key.get(raw.get("highlight_key")) or default_highlight(highlights, metrics)

    used_ids = list(dict.fromkeys(i for sec in (changed, matters, todo) for it in sec for i in it["mention_ids"]))
    piece_by_id = {p["id"]: p for p in pieces}
    sources = [
        {
            "id": i,
            "url": piece_by_id[i]["url"],
            "title": piece_by_id[i]["titulo"] or piece_by_id[i]["extracto"][:120],
            "outlet": piece_by_id[i]["medio_o_autor"],
            "source": piece_by_id[i]["fuente"],
            "tone": piece_by_id[i]["tono"],
            "time": piece_by_id[i]["hora"],
        }
        for i in used_ids
    ]
    output = {
        "headline": headline[:140],
        "highlight": highlight,
        "what_changed": changed,
        "why_it_matters": matters,
        "what_to_do": todo,
        "aclaracion": aclaracion,
        "sources": sources,
        "coordinator": {
            "generated_at": now.isoformat(),
            "human_review_required": True,
            "auto_publish": False,
            "pieces_sent": len(pieces),
            "dropped_items": dropped,
        },
    }
    return {
        **row,
        "status": "ok",
        "headline": output["headline"],
        "output": output,
        "model": result.model,
        "cost_usd": result.cost_usd,
        "usage": {**result.usage, "estimate_usd": round(estimate, 6)},
        "input_ref": {"mention_ids": [p["id"] for p in pieces]},
    }


def run_daily_brief(
    *,
    store: Any,
    settings: Any,
    llm: DailyBriefLLM | None = None,
    only_slug: str | None = None,
    now: datetime | None = None,
    brief_date: date | None = None,
    write: bool = True,
    force: bool = False,
) -> RunOutcome:
    now = now or datetime.now(timezone.utc)
    outcome = RunOutcome()
    client = llm if llm is not None else DailyBriefLLM(settings)
    for candidate in store.list_candidates(only_slug):
        slug = candidate["slug"]
        part = CandidateOutcome(slug=slug)
        try:
            profile = profile_for(slug)
            tz = profile.zone
            local_now = now.astimezone(tz)
            day = brief_date or target_date(now, tz)
            part.brief_date = day.isoformat()
            if not force and brief_date is None and local_now.hour < settings.run_after_hour:
                part.status = "skipped_before_hour"
            elif not force and store.brief_exists(str(candidate["id"]), day):
                part.status = "skipped_already_done"
            else:
                since = window_since(day, tz)
                until = day_bounds(day, tz)[1]
                data = store.load_window(str(candidate["id"]), since, until)
                budget = settings.max_cost_per_run_usd - outcome.cost_usd
                row = build_brief(candidate=candidate, data=data, brief_date=day, settings=settings,
                                  llm=client, budget_left=budget, now=now)
                part.status = row["status"]
                part.cost_usd = float(row.get("cost_usd") or 0)
                part.dropped_items = len((row["output"].get("coordinator") or {}).get("dropped_items") or [])
                part.row = row
                if write and row["status"] in {"ok", "insufficient"}:
                    part.brief_id = store.save_brief(row, replace=force)
        except Exception as exc:  # noqa: BLE001
            log.exception("Falló el resumen diario de %s", slug)
            part.status = "error"
            part.error = type(exc).__name__
        outcome.cost_usd += part.cost_usd
        outcome.candidates.append(part)
    return outcome
