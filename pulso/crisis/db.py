"""Acceso a Postgres con pulso_classifier. No imprime la URL."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator, Protocol
from uuid import UUID


def _psycopg():
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
    return psycopg, dict_row, Jsonb


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class CrisisStore(Protocol):
    def list_enabled_candidates(self, only_slug: str | None = None) -> list[dict[str, Any]]: ...
    def load_pack(self, candidate_id: str, since: datetime) -> dict[str, Any]: ...
    def existing_alerts(self, candidate_id: str) -> list[dict[str, Any]]: ...
    def upsert_alert(self, candidate_id: str, alert: Any) -> dict[str, Any]: ...
    def insert_brief(self, alert_id: str, candidate_id: str, brief: Any, input_ref: dict[str, Any]) -> str: ...
    def log_run(self, **row: Any) -> None: ...


@contextmanager
def connect(database_url: str, password: str | None = None):
    """Misma receta que el clasificador: URL sin clave + CLASSIFIER_PGPASSWORD."""
    psycopg, dict_row, _ = _psycopg()
    kwargs: dict = {"row_factory": dict_row}
    if password:
        kwargs["password"] = password
    with psycopg.connect(database_url, **kwargs) as conn:
        yield conn


class PostgresStore:
    def __init__(self, conn) -> None:
        self.conn = conn

    def list_enabled_candidates(self, only_slug: str | None = None) -> list[dict[str, Any]]:
        sql = """
            select c.id, c.slug, c.name, s.enabled, s.max_cost_usd, s.max_briefs_per_run, s.notify_email
            from public.candidates c
            join public.crisis_agent_settings s on s.candidate_id = c.id
            where s.enabled = true
              and coalesce(c.collection_paused, false) = false
        """
        params: list[Any] = []
        if only_slug:
            sql += " and c.slug = %s"
            params.append(only_slug)
        sql += " order by c.slug"
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())

    def load_pack(self, candidate_id: str, since: datetime) -> dict[str, Any]:
        cid = UUID(str(candidate_id))
        since = _utc(since)
        with self.conn.cursor() as cur:
            cur.execute(
                """
                select id, candidate_id, source, url, title, left(content, 600) as content,
                       author, author_handle, outlet, published_at, collected_at,
                       account_relation, tone, target, topic_id, relevance, metrics
                from public.mentions
                where candidate_id = %s and published_at >= %s
                order by published_at desc
                """,
                (cid, since),
            )
            mentions = list(cur.fetchall())
            cur.execute(
                """
                select id, platform, account_key, handle, display_name, profile_url, score,
                       signals, mention_count, first_seen_at, last_seen_at, detected_at, status
                from public.suspicious_accounts
                where candidate_id = %s and coalesce(detected_at, last_seen_at) >= %s
                """,
                (cid, since),
            )
            suspicious = list(cur.fetchall())
            cur.execute(
                """
                select id, ad_id, page_name, ad_creation_time, ad_delivery_start_time, fetched_at
                from public.meta_ads
                where candidate_id = %s
                  and coalesce(ad_delivery_start_time, ad_creation_time, fetched_at) >= %s
                """,
                (cid, since),
            )
            ads = list(cur.fetchall())
            cur.execute(
                """
                select c.ad_id, c.stance, c.meta_ad_id
                from public.meta_ad_classifications c
                where c.candidate_id = %s
                """,
                (cid,),
            )
            classifications = list(cur.fetchall())
            cur.execute(
                """
                select prompt_key, balance as score, asked_at as captured_at, asked_on, created_at
                from public.ai_answers
                where candidate_id = %s
                  and asked_at >= %s
                """,
                (cid, since),
            )
            ai_answers = list(cur.fetchall())
        return {
            "mentions": _plain(mentions),
            "suspicious_accounts": _plain(suspicious),
            "ads": _plain(ads),
            "ad_classifications": _plain(classifications),
            "ai_answers": _plain(ai_answers),
        }

    def existing_alerts(self, candidate_id: str) -> list[dict[str, Any]]:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                select a.id, a.trigger_type, a.trigger_key, a.status, a.metrics, a.last_detected_at,
                       (b.id is not null) as has_brief,
                       b.input_ref
                from public.crisis_alerts a
                left join lateral (
                    select id, input_ref
                    from public.crisis_briefs
                    where alert_id = a.id
                    order by created_at desc
                    limit 1
                ) b on true
                where a.candidate_id = %s
                """,
                (UUID(str(candidate_id)),),
            )
            return _plain(cur.fetchall())

    def upsert_alert(self, candidate_id: str, alert: Any) -> dict[str, Any]:
        """Inserta o actualiza. No toca approved/discarded."""
        with self.conn.cursor() as cur:
            cur.execute(
                """
                select id, status from public.crisis_alerts
                where candidate_id = %s and trigger_type = %s and trigger_key = %s
                """,
                (UUID(str(candidate_id)), alert.trigger_type, alert.trigger_key),
            )
            row = cur.fetchone()
            if row and row["status"] in {"approved", "discarded"}:
                return {"id": str(row["id"]), "status": row["status"], "changed": False, "locked": True}
            if row:
                cur.execute(
                    """
                    update public.crisis_alerts
                    set cluster_label = %s,
                        topic_id = %s,
                        window_start = %s,
                        window_end = %s,
                        severity = %s,
                        metrics = %s,
                        last_detected_at = now()
                    where id = %s
                    returning id, status
                    """,
                    (
                        alert.cluster_label,
                        alert.topic_id,
                        _utc(alert.window_start),
                        _utc(alert.window_end),
                        alert.severity,
                         _psycopg()[2](alert.metrics),
                        row["id"],
                    ),
                )
                updated = cur.fetchone()
                self.conn.commit()
                return {"id": str(updated["id"]), "status": updated["status"], "changed": True, "locked": False}
            cur.execute(
                """
                insert into public.crisis_alerts (
                    candidate_id, trigger_type, trigger_key, cluster_label, topic_id,
                    window_start, window_end, severity, metrics, status
                ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,'new')
                returning id, status
                """,
                (
                    UUID(str(candidate_id)),
                    alert.trigger_type,
                    alert.trigger_key,
                    alert.cluster_label,
                    alert.topic_id,
                    _utc(alert.window_start),
                    _utc(alert.window_end),
                    alert.severity,
                     _psycopg()[2](alert.metrics),
                ),
            )
            inserted = cur.fetchone()
            self.conn.commit()
            return {"id": str(inserted["id"]), "status": inserted["status"], "changed": True, "locked": False, "created": True}

    def insert_brief(self, alert_id: str, candidate_id: str, brief: Any, input_ref: dict[str, Any]) -> str:
        output = brief.output
        with self.conn.cursor() as cur:
            cur.execute(
                """
                insert into public.crisis_briefs (
                    alert_id, candidate_id, title, risk_level, model, prompt_version,
                    cost_usd, usage, output, input_ref
                ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                returning id
                """,
                (
                    UUID(str(alert_id)),
                    UUID(str(candidate_id)),
                    output.get("title"),
                    output.get("risk_level"),
                    brief.model,
                    brief.prompt_version,
                    brief.cost_usd,
                     _psycopg()[2]({
                        "input_tokens": brief.input_tokens,
                        "output_tokens": brief.output_tokens,
                    }),
                     _psycopg()[2](output),
                     _psycopg()[2](input_ref),
                ),
            )
            row = cur.fetchone()
            self.conn.commit()
            return str(row["id"])

    def log_run(self, **row: Any) -> None:
        with self.conn.cursor() as cur:
            if not row.get("alert_id") or not row.get("candidate_id"):
                return
            cur.execute(
                """
                insert into public.crisis_agent_runs (
                    candidate_id, alert_id, brief_id, agent_role, status, model,
                    prompt_version, cost_usd, usage, notes, started_at, finished_at
                ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    UUID(str(row["candidate_id"])),
                    UUID(str(row["alert_id"])),
                    UUID(str(row["brief_id"])) if row.get("brief_id") else None,
                    row.get("agent_role") or "coordinator",
                    row.get("status") or "ok",
                    row.get("model"),
                    row.get("prompt_version"),
                    row.get("cost_usd"),
                     _psycopg()[2]({
                        "input_tokens": row.get("input_tokens"),
                        "output_tokens": row.get("output_tokens"),
                        **(row.get("extras") or {}),
                    }),
                    row.get("notes") or row.get("error"),
                    row.get("started_at") or datetime.now(timezone.utc),
                    row.get("finished_at") or datetime.now(timezone.utc),
                ),
            )
            self.conn.commit()


def _plain(rows: list[Any]) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        item = dict(row)
        for key, val in list(item.items()):
            if hasattr(val, "hex") and not isinstance(val, (bytes, str)):
                item[key] = str(val)
            elif isinstance(val, datetime):
                item[key] = val.isoformat()
        out.append(item)
    return out


class MemoryStore:
    """Para tests y corridas con un pack exportado, sin tocar Postgres."""

    def __init__(self, candidates: list[dict[str, Any]], packs: dict[str, dict[str, Any]] | None = None) -> None:
        self.candidates = candidates
        self.packs = packs or {}
        self.alerts: list[dict[str, Any]] = []
        self.briefs: list[dict[str, Any]] = []
        self.runs: list[dict[str, Any]] = []

    def list_enabled_candidates(self, only_slug: str | None = None) -> list[dict[str, Any]]:
        rows = [c for c in self.candidates if c.get("enabled") and not c.get("collection_paused")]
        if only_slug:
            rows = [c for c in rows if c.get("slug") == only_slug]
        return rows

    def load_pack(self, candidate_id: str, since: datetime) -> dict[str, Any]:
        return self.packs.get(str(candidate_id)) or {
            "mentions": [],
            "suspicious_accounts": [],
            "ads": [],
            "ad_classifications": [],
            "ai_answers": [],
        }

    def existing_alerts(self, candidate_id: str) -> list[dict[str, Any]]:
        rows = []
        for a in self.alerts:
            if a["candidate_id"] != str(candidate_id):
                continue
            briefs = [b for b in self.briefs if b["alert_id"] == a["id"]]
            last = briefs[-1] if briefs else None
            rows.append({
                **a,
                "has_brief": last is not None,
                "input_ref": (last or {}).get("input_ref"),
            })
        return rows

    def upsert_alert(self, candidate_id: str, alert: Any) -> dict[str, Any]:
        for row in self.alerts:
            if (
                row["candidate_id"] == str(candidate_id)
                and row["trigger_type"] == alert.trigger_type
                and row["trigger_key"] == alert.trigger_key
            ):
                if row["status"] in {"approved", "discarded"}:
                    return {"id": row["id"], "status": row["status"], "changed": False, "locked": True}
                row.update(
                    {
                        "cluster_label": alert.cluster_label,
                        "metrics": alert.metrics,
                        "severity": alert.severity,
                    }
                )
                return {"id": row["id"], "status": row["status"], "changed": True, "locked": False}
        ident = f"alert-{len(self.alerts)+1}"
        self.alerts.append(
            {
                "id": ident,
                "candidate_id": str(candidate_id),
                "trigger_type": alert.trigger_type,
                "trigger_key": alert.trigger_key,
                "cluster_label": alert.cluster_label,
                "status": "new",
                "metrics": alert.metrics,
                "severity": alert.severity,
                "mention_ids": list(alert.mention_ids),
            }
        )
        return {"id": ident, "status": "new", "changed": True, "locked": False, "created": True}

    def insert_brief(self, alert_id: str, candidate_id: str, brief: Any, input_ref: dict[str, Any]) -> str:
        ident = f"brief-{len(self.briefs)+1}"
        self.briefs.append(
            {
                "id": ident,
                "alert_id": alert_id,
                "candidate_id": str(candidate_id),
                "output": brief.output,
                "cost_usd": brief.cost_usd,
                "model": brief.model,
                "input_ref": input_ref,
            }
        )
        return ident

    def log_run(self, **row: Any) -> None:
        self.runs.append(row)
