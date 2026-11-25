"""Corrida de alertas de contradicciones por candidato. Cada `every_hours`, solo con material nuevo."""

from __future__ import annotations

import hashlib
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from pulso.inconsistency import PROMPT_VERSION
from pulso.inconsistency.grounding import days_between, ground_findings
from pulso.inconsistency.llm import InconsistencyLLM, build_messages, build_schema, estimate_cost
from pulso.inconsistency.pairs import candidate_pairs, flag_contexts
from pulso.inconsistency.statements import Piece, extract_pieces
from pulso.region import profile_for

log = logging.getLogger("pulso.inconsistency")

STATS_DAYS = 30
MIN_DAYS_WITH_STATEMENTS = 5
BACKFILL_DAYS = 30
MAX_JUDGED_KEYS = 600


@dataclass
class CandidateOutcome:
    slug: str
    status: str = "pending"
    cost_usd: float = 0.0
    alerts_new: int = 0
    pairs_checked: int = 0
    flags_checked: int = 0
    dropped: int = 0
    error: str | None = None
    scan: dict[str, Any] | None = None
    alerts: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class RunOutcome:
    candidates: list[CandidateOutcome] = field(default_factory=list)
    cost_usd: float = 0.0

    def as_dict(self, include_rows: bool = False) -> dict[str, Any]:
        items = []
        for c in self.candidates:
            d = asdict(c)
            if not include_rows:
                d.pop("scan", None)
                d.pop("alerts", None)
            items.append(d)
        return {"cost_usd": round(self.cost_usd, 6), "candidates": items}


def alert_key(origin: str, earlier_id: str | None, later_id: str) -> str:
    return hashlib.sha1(f"{origin}:{earlier_id or '-'}:{later_id}".encode()).hexdigest()[:24]


def statement_stats(statements: list[Piece], flags: list[Piece], now: datetime, tz) -> dict[str, Any]:
    since = now - timedelta(days=STATS_DAYS)
    recent = [s for s in statements if s.published_at >= since]
    days = {s.published_at.astimezone(tz).date() for s in recent}
    return {
        "statements_30d": len(recent),
        "own_30d": sum(1 for s in recent if s.kind == "own"),
        "attributed_30d": sum(1 for s in recent if s.kind == "attributed"),
        "flags_30d": sum(1 for f in flags if f.published_at >= since),
        "days_with_statements": len(days),
        "first_statement_at": min((s.published_at for s in recent), default=None),
    }


def insufficient_reason(stats: dict[str, Any], name: str, min_statements: int,
                        min_days: int = MIN_DAYS_WITH_STATEMENTS) -> str | None:
    n, d = stats["statements_30d"], stats["days_with_statements"]
    if n >= min_statements and d >= min_days:
        return None
    return (
        f"Todavía hay pocas declaraciones de {name} en lo que medimos ({n} en {d} "
        f"día{'s' if d != 1 else ''} del último mes). Para comparar hacen falta al menos "
        f"{min_statements} en {min_days} días distintos."
    )


def _piece_payload(p: Piece, tz) -> dict[str, Any]:
    d = p.as_dict()
    d["local_date"] = p.published_at.astimezone(tz).date().isoformat()
    return d


def scan_candidate(
    *,
    candidate: dict[str, Any],
    data: dict[str, Any],
    settings: Any,
    llm: InconsistencyLLM | None,
    budget_left: float,
    now: datetime,
    last_scan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Devuelve {'scan': fila de inconsistency_scans, 'alerts': filas nuevas, 'cost_usd'} sin escribir."""
    profile = profile_for(candidate["slug"])
    tz = profile.zone
    name = candidate.get("name") or candidate["slug"]
    pieces = extract_pieces(candidate, data.get("mentions") or [], data.get("topics") or [])
    statements = pieces["own"] + pieces["attributed"]
    stats = statement_stats(statements, pieces["flag"], now, tz)
    reason = insufficient_reason(stats, name, settings.min_statements, getattr(settings, "min_days", MIN_DAYS_WITH_STATEMENTS))
    judged = list((last_scan or {}).get("judged_keys") or [])
    judged_set = set(judged)
    last_at = (last_scan or {}).get("last_scan_at")
    if isinstance(last_at, str):
        last_at = datetime.fromisoformat(last_at.replace("Z", "+00:00"))
    new_since = (last_at - timedelta(hours=1)) if last_at else now - timedelta(days=BACKFILL_DAYS)
    new_since = max(new_since, now - timedelta(hours=max(settings.new_window_hours, 1))) if last_at else new_since

    pairs = []
    if reason is None:
        pairs = [
            p for p in candidate_pairs(statements, now=now, new_since=new_since,
                                       min_gap_days=settings.min_gap_days, max_pairs=settings.max_pairs * 2)
            if alert_key("par", p.earlier.id, p.later.id) not in judged_set
        ][: settings.max_pairs]
    flags = [
        f for f in flag_contexts(pieces["flag"], statements + pieces["context"], new_since=new_since,
                                 max_flags=settings.max_flags * 2)
        if alert_key("senalamiento", None, f.flag.id) not in judged_set
    ][: settings.max_flags]

    scan = {
        "candidate_id": str(candidate["id"]),
        "status": "insufficient" if reason and not flags else "ok",
        "last_scan_at": now.isoformat(),
        "reason": reason,
        "stats": {**stats, "first_statement_at": stats["first_statement_at"].isoformat() if stats["first_statement_at"] else None,
                  "pairs_checked": 0, "flags_checked": 0, "alerts_new": 0, "clean": 0, "dropped": []},
        "judged_keys": judged,
        "model": None,
        "prompt_version": PROMPT_VERSION,
        "cost_usd": 0.0,
    }
    if not pairs and not flags:
        return {"scan": scan, "alerts": [], "cost_usd": 0.0}

    # Piezas numeradas: s1..sN. El modelo no ve ids ni URLs.
    ordered: list[Piece] = []
    for p in pairs:
        ordered += [p.earlier, p.later]
    for f in flags:
        ordered += [*f.earlier, f.flag]
    ref_of: dict[str, str] = {}
    pack_pieces: list[dict[str, Any]] = []
    by_ref: dict[str, dict[str, Any]] = {}
    for piece in ordered:
        if piece.id in ref_of:
            continue
        ref = f"s{len(ref_of) + 1}"
        ref_of[piece.id] = ref
        row = {
            "ref": ref, "kind": piece.kind, "fecha": piece.published_at.astimezone(tz).date().isoformat(),
            "medio": piece.outlet or "", "tema": piece.topic or "", "texto": piece.text[:400],
        }
        pack_pieces.append(row)
        by_ref[ref] = {**row, "_piece": piece}
    pair_items = [{"item": f"p{i + 1}", "antes": ref_of[p.earlier.id], "despues": ref_of[p.later.id]}
                  for i, p in enumerate(pairs)]
    flag_items = [{"item": ref_of[f.flag.id], "previas": [ref_of[e.id] for e in f.earlier]} for f in flags]
    system, user = build_messages(candidate_name=name, language_style=profile.language_style,
                                  tz_label=profile.tz_label, pieces=pack_pieces, pairs=pair_items, flags=flag_items)
    n_items = len(pair_items) + len(flag_items)
    estimate = estimate_cost(settings.model, system, user, n_items)
    cap = min(settings.max_cost_per_call_usd, budget_left)
    if llm is None or estimate is None or estimate > cap:
        scan["status"] = "skipped"
        scan["stats"]["skip_reason"] = "no_llm" if llm is None else ("unknown_price" if estimate is None else "cost_cap")
        return {"scan": scan, "alerts": [], "cost_usd": 0.0}

    result = llm.complete(system, user, build_schema())
    kept, dropped, clean = ground_findings(
        result.output,
        pieces_by_ref=by_ref,
        pairs={it["item"]: (it["antes"], it["despues"]) for it in pair_items},
        flags={it["item"]: it["previas"] for it in flag_items},
    )
    alerts = []
    for k in kept:
        later: Piece = by_ref[k["despues_ref"]]["_piece"]
        earlier: Piece | None = by_ref[k["antes_ref"]]["_piece"] if k["antes_ref"] else None
        key = alert_key("par" if k["origin"] == "par" else "senalamiento",
                        earlier.id if (earlier and k["origin"] == "par") else None, later.id)
        mention_ids = list(dict.fromkeys(
            mid for r in k["refs"] for mid in by_ref[r]["_piece"].mention_ids
        ))
        alerts.append({
            "candidate_id": str(candidate["id"]),
            "alert_key": key,
            "origin": k["origin"],
            "kind": k["kind"],
            "severity": k["severity"],
            "topic_label": k["topic"] or later.topic or (earlier.topic if earlier else None),
            "topic_id": later.topic_id,
            "earlier": _piece_payload(earlier, tz) if earlier else None,
            "later": _piece_payload(later, tz),
            "days_between": days_between(by_ref[k["antes_ref"]]["fecha"], by_ref[k["despues_ref"]]["fecha"]) if earlier else None,
            "explanation": k["why"],
            "next_step": k["next_step"],
            "mention_ids": mention_ids,
            "detected_at": now.isoformat(),
            "model": result.model,
            "prompt_version": PROMPT_VERSION,
        })
    newly = [alert_key("par", p.earlier.id, p.later.id) for p in pairs] + \
            [alert_key("senalamiento", None, f.flag.id) for f in flags]
    scan["judged_keys"] = (judged + [k for k in newly if k not in judged_set])[-MAX_JUDGED_KEYS:]
    scan["model"] = result.model
    scan["cost_usd"] = result.cost_usd
    scan["stats"].update({"pairs_checked": len(pairs), "flags_checked": len(flags), "alerts_new": len(alerts),
                          "clean": clean, "dropped": dropped, "estimate_usd": round(estimate, 6), **result.usage})
    return {"scan": scan, "alerts": alerts, "cost_usd": result.cost_usd}


def run_inconsistency(
    *,
    store: Any,
    settings: Any,
    llm: InconsistencyLLM | None = None,
    only_slug: str | None = None,
    now: datetime | None = None,
    write: bool = True,
    force: bool = False,
) -> RunOutcome:
    now = now or datetime.now(timezone.utc)
    outcome = RunOutcome()
    client = llm if llm is not None else (InconsistencyLLM(settings) if settings.llm_api_key else None)
    for candidate in store.list_candidates(only_slug):
        part = CandidateOutcome(slug=candidate["slug"])
        try:
            last = store.last_scan(str(candidate["id"]))
            last_at = (last or {}).get("last_scan_at")
            if isinstance(last_at, str):
                last_at = datetime.fromisoformat(last_at.replace("Z", "+00:00"))
            if not force and last_at and now - last_at < timedelta(hours=settings.every_hours):
                part.status = "skipped_recent"
            else:
                since = now - timedelta(days=settings.lookback_days)
                data = store.load_window(str(candidate["id"]), since, now)
                budget = settings.max_cost_per_run_usd - outcome.cost_usd
                res = scan_candidate(candidate=candidate, data=data, settings=settings, llm=client,
                                     budget_left=budget, now=now, last_scan=last)
                part.status = res["scan"]["status"]
                part.cost_usd = float(res["cost_usd"] or 0)
                part.alerts_new = len(res["alerts"])
                part.pairs_checked = res["scan"]["stats"]["pairs_checked"]
                part.flags_checked = res["scan"]["stats"]["flags_checked"]
                part.dropped = len(res["scan"]["stats"].get("dropped") or [])
                part.scan, part.alerts = res["scan"], res["alerts"]
                if write:
                    for a in res["alerts"]:
                        store.save_alert(a)
                    if res["scan"]["status"] != "skipped":
                        store.save_scan(res["scan"])
        except Exception as exc:  # noqa: BLE001
            log.exception("Falló la revisión de contradicciones de %s", candidate["slug"])
            part.status = "error"
            part.error = type(exc).__name__
        outcome.cost_usd += part.cost_usd
        outcome.candidates.append(part)
    return outcome
