"""CLI: `python -m pulso.wikipedia --candidate axel-kicillof [--dry-run]`.

Consulta la API oficial de visitas de Wikimedia. --dry-run no escribe ni
abre la base. Con --write (después de aplicar la migración) guarda la serie.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from pulso.wikipedia.client import DEFAULT_DAYS, fetch_pageviews, range_for
from pulso.wikipedia.defaults import article_for, article_url, project_for

TZ = ZoneInfo("America/Argentina/Buenos_Aires")


def log(**values):
    print(json.dumps(values, ensure_ascii=False, default=str), flush=True)


def user_agent() -> str:
    return os.getenv("PULSO_USER_AGENT") or "PulsoCollector/0.3 (+https://pulso-web-re4x.onrender.com)"


async def collect(article: str, project: str, days: int, agent: str) -> list[dict]:
    start, end = range_for(days=days)
    rows = await fetch_pageviews(
        project=project,
        title=article,
        start=start,
        end=end,
        user_agent=agent,
    )
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", default=os.getenv("PULSO_CANDIDATE") or "axel-kicillof")
    parser.add_argument("--article", default=None, help="Título del artículo, si no se usa el default del slug")
    parser.add_argument("--project", default=None, help="Proyecto wiki, por defecto es.wikipedia")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS)
    parser.add_argument("--dry-run", action="store_true", help="Consulta la API y no escribe en la base")
    parser.add_argument("--write", action="store_true", help="Guarda la serie (requiere la migración aplicada)")
    args = parser.parse_args(argv)
    if args.dry_run and args.write:
        log(event="wikipedia_error", error_type="config", detail="Usá --dry-run o --write, no los dos")
        return 2
    write = bool(args.write) and not args.dry_run
    stored = {}
    candidate_id = None
    db = None
    if write:
        # Solo en --write se abre la base.
        from pulso.wikipedia.db import MissingWikipediaSchema, WikipediaDB
        from pulso.config import Settings as Cfg
        try:
            db = WikipediaDB(Cfg.from_env().database_url)
            row = db.candidate(args.candidate)
            candidate_id = row["id"]
            stored = db.settings(candidate_id) or {}
            if stored and not stored.get("enabled", True):
                log(event="wikipedia_skipped", reason="disabled", candidate=args.candidate)
                return 0
        except MissingWikipediaSchema:
            log(event="wikipedia_skipped", reason="schema_missing")
            return 0
        except Exception as exc:
            log(event="wikipedia_error", error_type=type(exc).__name__, hint="Revisar configuración")
            return 1
    try:
        settings = dict(stored)
        if args.article:
            settings["article"] = args.article
        if args.project:
            settings["project"] = args.project
        article = article_for(args.candidate, settings)
        project = project_for(settings)
        agent = user_agent()
        rows = asyncio.run(collect(article, project, args.days, agent))
        last = rows[-1] if rows else None
        log(
            event="wikipedia_dry_run" if not write else "wikipedia_ok",
            candidate=args.candidate,
            project=project,
            article=article,
            url=article_url(project, article),
            days_requested=args.days,
            days_returned=len(rows),
            last_day=last["day"] if last else None,
            last_views=last["views"] if last else None,
        )
        if write and db is not None and candidate_id is not None:
            today = datetime.now(TZ).date()
            db.upsert_views(candidate_id, project, article, rows, today)
        return 0
    except Exception as exc:
        log(event="wikipedia_error", error_type=type(exc).__name__, hint="Revisar artículo, red o API")
        return 1
    finally:
        if db is not None:
            db.close()


if __name__ == "__main__":
    sys.exit(main())
