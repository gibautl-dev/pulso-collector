"""Lectura con pulso_classifier y escritura en inconsistency_alerts / inconsistency_scans. No imprime la URL."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pulso.crisis.db import _plain, connect  # noqa: F401  (misma receta de conexión)

ALERT_COLUMNS = (
    "candidate_id", "alert_key", "origin", "kind", "severity", "topic_label", "topic_id", "earlier", "later",
    "days_between", "explanation", "next_step", "mention_ids", "detected_at", "model", "prompt_version",
)


class PostgresStore:
    def __init__(self, conn) -> None:
        self.conn = conn

    def list_candidates(self, only_slug: str | None = None) -> list[dict[str, Any]]:
        sql = "select id, slug, name from public.candidates where coalesce(collection_paused, false) = false"
        params: list[Any] = []
        if only_slug:
            sql += " and slug = %s"
            params.append(only_slug)
        sql += " order by slug"
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return _plain(cur.fetchall())

    def last_scan(self, candidate_id: str) -> dict[str, Any] | None:
        with self.conn.cursor() as cur:
            cur.execute(
                "select last_scan_at, judged_keys from public.inconsistency_scans where candidate_id = %s",
                (UUID(str(candidate_id)),),
            )
            row = cur.fetchone()
        return _plain([row])[0] if row else None

    def load_window(self, candidate_id: str, since: datetime, until: datetime) -> dict[str, Any]:
        cid = UUID(str(candidate_id))
        with self.conn.cursor() as cur:
            # Solo medios y cuentas propias: los posts de terceros en X/YouTube no son declaraciones.
            cur.execute(
                """
                select id, candidate_id, source, url, title, left(content, 400) as content,
                       author, outlet, published_at, account_relation, tone, target, topic_id
                from public.mentions
                where candidate_id = %s and published_at >= %s and published_at < %s
                  and (source in ('google_news', 'rss_media', 'google_alerts')
                       or account_relation = 'own')
                """,
                (cid, since, until),
            )
            mentions = _plain(cur.fetchall())
            cur.execute("select id, candidate_id, label from public.topics where candidate_id = %s", (cid,))
            topics = _plain(cur.fetchall())
        return {"mentions": mentions, "topics": topics}

    def save_alert(self, row: dict[str, Any]) -> str | None:
        from psycopg.types.json import Jsonb

        values = []
        for col in ALERT_COLUMNS:
            v = row.get(col)
            if col in {"earlier", "later"}:
                v = Jsonb(v) if v is not None else None
            elif col == "candidate_id":
                v = UUID(str(v))
            elif col == "topic_id":
                v = UUID(str(v)) if v else None
            elif col == "mention_ids":
                v = [UUID(str(x)) for x in v or []]
            values.append(v)
        with self.conn.cursor() as cur:
            cur.execute(
                f"""
                insert into public.inconsistency_alerts ({", ".join(ALERT_COLUMNS)})
                values ({", ".join(["%s"] * len(ALERT_COLUMNS))})
                on conflict (candidate_id, alert_key) do nothing
                returning id
                """,
                values,
            )
            got = cur.fetchone()
        self.conn.commit()
        return str(got["id"]) if got else None

    def save_scan(self, row: dict[str, Any]) -> None:
        from psycopg.types.json import Jsonb

        with self.conn.cursor() as cur:
            cur.execute(
                """
                insert into public.inconsistency_scans
                  (candidate_id, status, last_scan_at, reason, stats, judged_keys, model, prompt_version, cost_usd)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (candidate_id) do update set
                  status = excluded.status, last_scan_at = excluded.last_scan_at, reason = excluded.reason,
                  stats = excluded.stats, judged_keys = excluded.judged_keys, model = excluded.model,
                  prompt_version = excluded.prompt_version, cost_usd = excluded.cost_usd, updated_at = now()
                """,
                (
                    UUID(str(row["candidate_id"])), row["status"], row["last_scan_at"], row.get("reason"),
                    Jsonb(row.get("stats") or {}), list(row.get("judged_keys") or []), row.get("model"),
                    row["prompt_version"], row.get("cost_usd") or 0,
                ),
            )
        self.conn.commit()


class MemoryStore:
    """Tests y corridas locales con un pack exportado (solo lectura de la base)."""

    def __init__(self, candidates: list[dict[str, Any]], mentions: list[dict[str, Any]],
                 topics: list[dict[str, Any]] | None = None, scans: dict[str, dict[str, Any]] | None = None) -> None:
        self.candidates = candidates
        self.mentions = mentions
        self.topics = topics or []
        self.scans = dict(scans or {})
        self.alerts: list[dict[str, Any]] = []

    def list_candidates(self, only_slug: str | None = None) -> list[dict[str, Any]]:
        return [c for c in self.candidates if not c.get("collection_paused") and (not only_slug or c["slug"] == only_slug)]

    def last_scan(self, candidate_id: str) -> dict[str, Any] | None:
        return self.scans.get(str(candidate_id))

    def load_window(self, candidate_id: str, since: datetime, until: datetime) -> dict[str, Any]:
        from pulso.inconsistency.statements import _dt

        ms = [
            m for m in self.mentions
            if str(m.get("candidate_id")) == str(candidate_id)
            and (d := _dt(m.get("published_at"))) is not None and since <= d < until
        ]
        return {"mentions": ms, "topics": [t for t in self.topics if str(t.get("candidate_id")) == str(candidate_id)]}

    def save_alert(self, row: dict[str, Any]) -> str | None:
        if any(a["candidate_id"] == row["candidate_id"] and a["alert_key"] == row["alert_key"] for a in self.alerts):
            return None
        ident = f"inc-{len(self.alerts) + 1}"
        self.alerts.append({**row, "id": ident, "status": "new"})
        return ident

    def save_scan(self, row: dict[str, Any]) -> None:
        self.scans[str(row["candidate_id"])] = dict(row)
