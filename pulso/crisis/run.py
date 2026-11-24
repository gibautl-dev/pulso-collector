"""Coordinador: Vigilante detecta, el resto arma el brief, una persona aprueba."""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from pulso.crisis import PROMPT_VERSION
from pulso.crisis.agents import BriefResult, CrisisLLM
from pulso.crisis.settings import CrisisSettings
from pulso.crisis.watcher import DetectedAlert, is_notable, watch
from pulso.region import profile_for

log = logging.getLogger("pulso.crisis")

LOOKBACK_DAYS = 12
MEDIA_SOURCES = frozenset({"rss_media", "google_news"})


@dataclass
class CandidateOutcome:
    slug: str
    candidate_id: str
    alerts_detected: int = 0
    alerts_upserted: int = 0
    briefs_written: int = 0
    skipped_locked: int = 0
    skipped_cost: int = 0
    skipped_cap: int = 0
    cost_usd: float = 0.0
    details: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None


@dataclass
class RunOutcome:
    candidates: list[CandidateOutcome] = field(default_factory=list)
    cost_usd: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "cost_usd": self.cost_usd,
            "candidates": [asdict(c) for c in self.candidates],
        }


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _material_change(alert: DetectedAlert, previous: dict[str, Any] | None) -> bool:
    """Regenerar brief si hay ≥3 medios nuevos o el alcance se duplicó."""
    if not previous:
        return True
    old_metrics = previous.get("metrics") or {}
    old_ids = set((previous.get("input_ref") or {}).get("mention_ids") or [])
    new_ids = set(alert.mention_ids)
    new_media = alert.metrics.get("media_count") or 0
    old_media = old_metrics.get("media_count") or 0
    if new_media >= old_media + 3:
        return True
    old_reach = float(old_metrics.get("x_impressions") or 0)
    new_reach = float(alert.metrics.get("x_impressions") or 0)
    if old_reach > 0 and new_reach >= 2 * old_reach and new_reach - old_reach >= 500:
        return True
    # Primera vez sin brief.
    if not previous.get("has_brief"):
        return True
    # Si no hay ids previos, comparar conteos.
    if old_ids and len(new_ids - old_ids) >= 8:
        return True
    return False


def _payload_for_brief(
    *,
    candidate: dict[str, Any],
    alert: DetectedAlert,
    pack: dict[str, Any],
    tz_label: str,
) -> dict[str, Any]:
    by_id = {str(m.get("id")): m for m in pack.get("mentions") or []}
    mentions = []
    for mid in alert.mention_ids:
        m = by_id.get(str(mid))
        if not m:
            continue
        mentions.append(
            {
                "id": str(m.get("id")),
                "source": m.get("source"),
                "url": m.get("url"),
                "title": m.get("title"),
                "outlet": m.get("outlet"),
                "author": m.get("author") or m.get("author_handle"),
                "published_at": m.get("published_at"),
                "tone": m.get("tone"),
                "target": m.get("target"),
                "notable": is_notable(m),
                "metrics": {
                    k: v
                    for k, v in (m.get("metrics") or {}).items()
                    if k in {"impression_count", "impressions", "like_count", "repost_count", "view_count", "followers_count"}
                },
                "excerpt": (m.get("content") or "")[:280],
            }
        )
    # priorizar medios y notables, tope 40
    mentions.sort(key=lambda m: ((m["source"] in MEDIA_SOURCES), m["notable"], len(m.get("excerpt") or "")), reverse=True)
    mentions = mentions[:40]
    accounts = []
    wanted = set(alert.evidence_account_ids)
    for acc in pack.get("suspicious_accounts") or []:
        if wanted and str(acc.get("id")) not in wanted:
            continue
        if not wanted:
            continue
        accounts.append(
            {
                "id": str(acc.get("id")),
                "handle": acc.get("handle"),
                "display_name": acc.get("display_name"),
                "score": acc.get("score"),
                "signals": acc.get("signals"),
            }
        )
    return {
        "candidato": {"nombre": candidate.get("name"), "slug": candidate.get("slug")},
        "zona_horaria": tz_label,
        "alerta": {
            "trigger_type": alert.trigger_type,
            "trigger_key": alert.trigger_key,
            "cluster_label": alert.cluster_label,
            "severity": alert.severity,
            "window_start": alert.window_start.isoformat(),
            "window_end": alert.window_end.isoformat(),
            "metrics": alert.metrics,
        },
        "menciones": mentions,
        "cuentas_sospechosas_relacionadas": accounts[:30],
        "instrucciones": (
            "Usá solo estas menciones y cuentas. Si el texto oficial de una medida no está, "
            "no lo completes. Evidencia no denuncie en automático."
        ),
    }


def run_for_candidate(
    *,
    store: Any,
    llm: CrisisLLM | None,
    settings: CrisisSettings,
    candidate: dict[str, Any],
    now: datetime | None = None,
    write: bool = True,
) -> CandidateOutcome:
    now = now or _now()
    outcome = CandidateOutcome(slug=candidate["slug"], candidate_id=str(candidate["id"]))
    profile = profile_for(candidate["slug"])
    tz = profile.zone
    since = now - timedelta(days=LOOKBACK_DAYS)
    pack = store.load_pack(str(candidate["id"]), since)
    stop = {candidate["slug"].replace("-", " "), *(candidate.get("name") or "").lower().split()}
    detected = watch(
        mentions=pack.get("mentions") or [],
        suspicious_accounts=pack.get("suspicious_accounts") or [],
        ads=pack.get("ads") or [],
        ad_classifications=pack.get("ad_classifications") or [],
        ai_answers=pack.get("ai_answers") or [],
        tz=tz,
        now=now,
        extra_stop=stop,
    )
    outcome.alerts_detected = len(detected)
    existing = { (r["trigger_type"], r["trigger_key"]): r for r in store.existing_alerts(str(candidate["id"])) }
    max_cost = min(float(candidate.get("max_cost_usd") or settings.max_cost_usd), settings.max_cost_usd)
    max_briefs = int(candidate.get("max_briefs_per_run") or settings.max_briefs_per_run)
    spent = 0.0
    briefs = 0
    last_brief_cost = None
    for alert in detected:
        prev = existing.get((alert.trigger_type, alert.trigger_key))
        if write:
            upserted = store.upsert_alert(str(candidate["id"]), alert)
        else:
            if prev and prev.get("status") in {"approved", "discarded"}:
                upserted = {"id": prev["id"], "status": prev["status"], "changed": False, "locked": True}
            else:
                upserted = {"id": (prev or {}).get("id") or "dry-run", "status": (prev or {}).get("status") or "new", "changed": True, "locked": False, "created": not prev}
        if upserted.get("locked"):
            outcome.skipped_locked += 1
            outcome.details.append({"trigger_key": alert.trigger_key, "status": "locked"})
            continue
        if upserted.get("changed"):
            outcome.alerts_upserted += 1
        need_brief = _material_change(alert, prev)
        detail = {
            "trigger_type": alert.trigger_type,
            "trigger_key": alert.trigger_key,
            "cluster_label": alert.cluster_label,
            "severity": alert.severity,
            "alert_id": upserted["id"],
            "mention_count": len(alert.mention_ids),
            "metrics": alert.metrics,
        }
        if not need_brief:
            detail["brief"] = "unchanged"
            if write:
                store.log_run(
                    candidate_id=candidate["id"],
                    alert_id=upserted["id"],
                    agent_role="watcher",
                    status="ok",
                    notes="alerta actualizada, brief vigente",
                )
            outcome.details.append(detail)
            continue
        if briefs >= max_briefs:
            outcome.skipped_cap += 1
            detail["brief"] = "skipped_cap"
            if write:
                store.log_run(
                    candidate_id=candidate["id"],
                    alert_id=upserted["id"],
                    agent_role="coordinator",
                    status="skipped",
                    notes="tope de briefs por corrida",
                )
            outcome.details.append(detail)
            continue
        if llm is None:
            detail["brief"] = "no_llm"
            outcome.details.append(detail)
            continue
        payload = _payload_for_brief(candidate=candidate, alert=alert, pack=pack, tz_label=profile.tz_label)
        # Guardia de costo: no llamar si el margen restante es ridículo.
        estimate = last_brief_cost if last_brief_cost is not None else 0.005
        if spent >= max_cost or (briefs > 0 and spent + estimate > max_cost):
            outcome.skipped_cost += 1
            detail["brief"] = "skipped_cost"
            if write:
                store.log_run(
                    candidate_id=candidate["id"],
                    alert_id=upserted["id"],
                    agent_role="coordinator",
                    status="skipped",
                    notes="tope de costo de la corrida",
                )
            outcome.details.append(detail)
            continue
        try:
            brief = llm.complete_brief(payload)
        except Exception as exc:  # noqa: BLE001 — se registra y se sigue con la siguiente alerta
            log.exception("No se pudo armar el brief de %s", alert.trigger_key)
            detail["brief"] = "error"
            detail["error"] = type(exc).__name__
            if write:
                store.log_run(
                    candidate_id=candidate["id"],
                    alert_id=upserted["id"],
                    agent_role="coordinator",
                    status="error",
                    notes=type(exc).__name__,
                )
            outcome.details.append(detail)
            continue
        if spent + brief.cost_usd > max_cost:
            # El brief ya se llamó; si se pasa del tope, igual lo guardamos porque el gasto ya ocurrió,
            # pero no arrancamos otro. (La guardia de arriba evita una segunda llamada.)
            pass
        spent += brief.cost_usd
        last_brief_cost = brief.cost_usd
        outcome.cost_usd += brief.cost_usd
        briefs += 1
        outcome.briefs_written += 1
        input_ref = {
            "mention_ids": alert.mention_ids,
            "evidence_account_ids": alert.evidence_account_ids,
            "trigger_key": alert.trigger_key,
        }
        # Atribución de agentes en el JSON guardado.
        output = dict(brief.output)
        output["coordinator"] = {
            "assembled_at": now.isoformat(),
            "prompt_version": PROMPT_VERSION,
            "human_approval_required": True,
            "auto_publish": False,
            "watcher": {
                "trigger_type": alert.trigger_type,
                "trigger_key": alert.trigger_key,
                "cluster_label": alert.cluster_label,
                "metrics": alert.metrics,
            },
        }
        brief = BriefResult(
            output=output,
            model=brief.model,
            prompt_version=brief.prompt_version,
            input_tokens=brief.input_tokens,
            output_tokens=brief.output_tokens,
            cost_usd=brief.cost_usd,
            raw_usage=brief.raw_usage,
        )
        brief_id = None
        if write:
            brief_id = store.insert_brief(upserted["id"], str(candidate["id"]), brief, input_ref)
            common = dict(
                candidate_id=candidate["id"],
                alert_id=upserted["id"],
                brief_id=brief_id,
                model=brief.model,
                prompt_version=brief.prompt_version,
                cost_usd=0,
                input_tokens=brief.input_tokens,
                output_tokens=brief.output_tokens,
            )
            store.log_run(**common, agent_role="watcher", status="ok", notes="umbrales, sin LLM")
            store.log_run(**{**common, "cost_usd": brief.cost_usd / 4}, agent_role="analyst", status="ok")
            store.log_run(**{**common, "cost_usd": brief.cost_usd / 4}, agent_role="evidence", status="ok")
            store.log_run(**{**common, "cost_usd": brief.cost_usd / 4}, agent_role="strategist", status="ok")
            store.log_run(**{**common, "cost_usd": brief.cost_usd / 4}, agent_role="writer", status="ok")
            store.log_run(**common, agent_role="coordinator", status="ok", notes="listo para revisión humana")
        detail["brief"] = "written"
        detail["brief_id"] = brief_id
        detail["cost_usd"] = brief.cost_usd
        detail["title"] = output.get("title")
        outcome.details.append(detail)
    return outcome


def run_crisis(
    *,
    store: Any,
    settings: CrisisSettings,
    llm: CrisisLLM | None = None,
    only_slug: str | None = None,
    now: datetime | None = None,
    write: bool = True,
) -> RunOutcome:
    outcome = RunOutcome()
    candidates = store.list_enabled_candidates(only_slug)
    if only_slug and not candidates:
        log.info("Nadie prendido para %s (o el candidato no existe).", only_slug)
        return outcome
    client = llm if llm is not None else CrisisLLM(settings)
    for candidate in candidates:
        if not candidate.get("enabled"):
            continue
        try:
            part = run_for_candidate(
                store=store,
                llm=client,
                settings=settings,
                candidate=candidate,
                now=now,
                write=write,
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("Falló la corrida de crisis de %s", candidate.get("slug"))
            part = CandidateOutcome(
                slug=candidate.get("slug") or "?",
                candidate_id=str(candidate.get("id") or ""),
                error=type(exc).__name__,
            )
        outcome.candidates.append(part)
        outcome.cost_usd += part.cost_usd
    return outcome
