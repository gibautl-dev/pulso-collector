"""Lectura con pulso_classifier y escritura en public.daily_briefs. No imprime la URL."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pulso.crisis.db import _plain, connect  # noqa: F401  (misma receta de conexión)


class PostgresStore:
    def __init__(self, conn) -> None:
        self.conn = conn

    def list_candidates(self, only_slug: str | None = None) -> list[dict[str, Any]]:
        sql = "select id, slug, name from public.candidates"
        params: list[Any] = []
        if only_slug:
            sql += " where slug = %s"
            params.append(only_slug)
        sql += " order by slug"
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return _plain(cur.fetchall())

    def brief_exists(self, candidate_id: str, brief_date: date) -> bool:
        with self.conn.cursor() as cur:
            cur.execute(
                "select 1 from public.daily_briefs where candidate_id = %s and brief_date = %s",
                (UUID(str(candidate_id)), brief_date),
            )
            return cur.fetchone() is not None

    def load_window(self, candidate_id: str, since: datetime, until: datetime) -> dict[str, Any]:
        cid = UUID(str(candidate_id))
        with self.conn.cursor() as cur:
            cur.execute(
                """
                select id, candidate_id, source, url, title, left(content, 600) as content,
                       author, author_handle, outlet, published_at, account_relation,
                       tone, target, topic_id, relevance, metrics
                from public.mentions
                where candidate_id = %s and published_at >= %s and published_at < %s
                """,
                (cid, since, until),
            )
            mentions = _plain(cur.fetchall())
            cur.execute("select id, candidate_id, label from public.topics where candidate_id = %s", (cid,))
            topics = _plain(cur.fetchall())
            cur.execute(
                """
                select id, ad_id, ad_creation_time, ad_delivery_start_time
                from public.meta_ads
                where candidate_id = %s
                  and coalesce(ad_delivery_start_time, ad_creation_time) >= %s::date
                """,
                (cid, since),
            )
            ads = _plain(cur.fetchall())
            cur.execute(
                "select ad_id, meta_ad_id, stance from public.meta_ad_classifications where candidate_id = %s",
                (cid,),
            )
            classifications = _plain(cur.fetchall())
            cur.execute(
                """
                select trigger_type, cluster_label, severity, status, window_start, window_end, last_detected_at
                from public.crisis_alerts
                where candidate_id = %s and last_detected_at >= %s
                """,
                (cid, since),
            )
            alerts = _plain(cur.fetchall())
        return {
            "mentions": mentions,
            "topics": topics,
            "ads": ads,
            "ad_classifications": classifications,
            "alerts": alerts,
        }

    def save_brief(self, row: dict[str, Any], *, replace: bool = False) -> str | None:
        from psycopg.types.json import Jsonb

        conflict = (
            """do update set status = excluded.status, headline = excluded.headline,
                 metrics = excluded.metrics, output = excluded.output, input_ref = excluded.input_ref,
                 model = excluded.model, prompt_version = excluded.prompt_version,
                 cost_usd = excluded.cost_usd, usage = excluded.usage, updated_at = now()"""
            if replace
            else "do nothing"
        )
        with self.conn.cursor() as cur:
            cur.execute(
                f"""
                insert into public.daily_briefs
                  (candidate_id, brief_date, timezone, status, headline, metrics, output, input_ref,
                   model, prompt_version, cost_usd, usage)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (candidate_id, brief_date) {conflict}
                returning id
                """,
                (
                    UUID(str(row["candidate_id"])), row["brief_date"], row["timezone"], row["status"],
                    row.get("headline"), Jsonb(row["metrics"]), Jsonb(row["output"]), Jsonb(row["input_ref"]),
                    row.get("model"), row["prompt_version"], row.get("cost_usd"), Jsonb(row.get("usage") or {}),
                ),
            )
            got = cur.fetchone()
        self.conn.commit()
        return str(got["id"]) if got else None


class MemoryStore:
    """Tests y corridas locales con un pack exportado (solo lectura de la base)."""

    def __init__(self, candidates: list[dict[str, Any]], packs: dict[str, dict[str, Any]], existing=None) -> None:
        self.candidates = candidates
        self.packs = packs
        self.saved: list[dict[str, Any]] = []
        self.existing = set(existing or [])

    def list_candidates(self, only_slug: str | None = None) -> list[dict[str, Any]]:
        return [c for c in self.candidates if not only_slug or c["slug"] == only_slug]

    def brief_exists(self, candidate_id: str, brief_date: date) -> bool:
        return (str(candidate_id), brief_date.isoformat()) in self.existing or any(
            r["candidate_id"] == str(candidate_id) and r["brief_date"] == brief_date.isoformat() for r in self.saved
        )

    def load_window(self, candidate_id: str, since: datetime, until: datetime) -> dict[str, Any]:
        pack = self.packs.get(str(candidate_id)) or {}
        from pulso.daily_brief.metrics import _dt

        mentions = [
            m for m in pack.get("mentions") or []
            if (d := _dt(m.get("published_at"))) is not None and since <= d < until
        ]
        return {**pack, "mentions": mentions}

    def save_brief(self, row: dict[str, Any], *, replace: bool = False) -> str | None:
        ident = f"daily-{len(self.saved) + 1}"
        self.saved.append({**row, "id": ident, "candidate_id": str(row["candidate_id"]),
                           "brief_date": str(row["brief_date"])})
        return ident
