"""Lectura y escritura de visitas de Wikipedia. No se usa en --dry-run."""
from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID

import psycopg
from psycopg.rows import dict_row


class MissingWikipediaSchema(Exception):
    pass


def _is_missing(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "wikipedia_pageviews" in msg and ("does not exist" in msg or "no existe" in msg)


class WikipediaDB:
    def __init__(self, url: str):
        self.connection = psycopg.connect(url, autocommit=True, row_factory=dict_row, connect_timeout=15)

    def close(self):
        self.connection.close()

    def candidate(self, slug: str) -> dict:
        row = self.connection.execute(
            "select id, slug, name, collection_paused from public.candidates where slug=%s", (slug,)
        ).fetchone()
        if not row:
            raise ValueError("Candidato inexistente")
        return row

    def settings(self, candidate_id: UUID) -> dict | None:
        try:
            return self.connection.execute(
                """select candidate_id, enabled, project, article, last_run_on, updated_at
                     from public.wikipedia_pageview_settings
                    where candidate_id=%s""",
                (candidate_id,),
            ).fetchone()
        except Exception as exc:
            if _is_missing(exc):
                raise MissingWikipediaSchema from exc
            raise

    def upsert_views(self, candidate_id: UUID, project: str, article: str, rows: list[dict], run_on: date):
        now = datetime.now(timezone.utc)
        with self.connection.transaction():
            for row in rows:
                self.connection.execute(
                    """insert into public.wikipedia_pageviews
                         (candidate_id, project, article, day, views, collected_at)
                       values (%s,%s,%s,%s,%s,%s)
                       on conflict (candidate_id, project, article, day)
                       do update set views=excluded.views, collected_at=excluded.collected_at""",
                    (candidate_id, project, article, row["day"], row["views"], now),
                )
            self.connection.execute(
                """update public.wikipedia_pageview_settings
                      set last_run_on=%s, project=%s, article=%s, updated_at=%s
                    where candidate_id=%s""",
                (run_on, project, article, now, candidate_id),
            )
