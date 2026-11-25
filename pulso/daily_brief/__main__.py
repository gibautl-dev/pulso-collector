"""python -m pulso.daily_brief [--candidate slug] [--date YYYY-MM-DD] [--dry-run] [--force]

Corre una vez por día por candidato, después de PULSO_DAILY_BRIEF_HOUR (hora local
del candidato). Con --pack usa un JSON exportado y no toca Postgres.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date
from pathlib import Path

from pulso.daily_brief.db import MemoryStore, PostgresStore, connect
from pulso.daily_brief.llm import DailyBriefLLM
from pulso.daily_brief.run import run_daily_brief
from pulso.daily_brief.settings import DailyBriefSettings, DailyBriefSettingsError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Resumen diario por candidato.")
    parser.add_argument("--candidate")
    parser.add_argument("--date", help="Fecha del resumen (por defecto, ayer en la zona del candidato).")
    parser.add_argument("--dry-run", action="store_true", help="Arma el resumen y no escribe.")
    parser.add_argument("--force", action="store_true", help="Ignora la hora y rehace el resumen de la fecha.")
    parser.add_argument("--pack", help="JSON exportado para correr sin Postgres (implica --dry-run).")
    parser.add_argument("--out", help="Guarda el resultado JSON en este path.")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    brief_date = date.fromisoformat(args.date) if args.date else None
    try:
        settings = DailyBriefSettings.from_env(require_db=not args.pack)
    except DailyBriefSettingsError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    def finish(outcome, rows: bool) -> int:
        text = json.dumps(outcome.as_dict(include_rows=rows), ensure_ascii=False, default=str, indent=2)
        if args.out:
            Path(args.out).write_text(text, encoding="utf-8")
        summary = {c.slug: {"status": c.status, "cost_usd": c.cost_usd, "dropped": c.dropped_items}
                   for c in outcome.candidates}
        print(json.dumps({"event": "daily_brief_finished", "candidates": summary,
                          "cost_usd": round(outcome.cost_usd, 6)}, ensure_ascii=False))
        return 0 if not any(c.status == "error" for c in outcome.candidates) else 1

    if args.pack:
        pack = json.loads(Path(args.pack).read_text(encoding="utf-8"))
        store = MemoryStore(pack.get("candidates") or [], pack.get("packs") or {})
        outcome = run_daily_brief(store=store, settings=settings, llm=DailyBriefLLM(settings),
                                  only_slug=args.candidate, brief_date=brief_date, write=False, force=True)
        return finish(outcome, rows=True)

    with connect(settings.database_url, settings.database_password) as conn:
        outcome = run_daily_brief(store=PostgresStore(conn), settings=settings, only_slug=args.candidate,
                                  brief_date=brief_date, write=not args.dry_run, force=args.force)
    return finish(outcome, rows=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
