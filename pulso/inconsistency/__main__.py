"""python -m pulso.inconsistency [--candidate slug] [--dry-run] [--force] | --pack pack.json [--findings f.json]"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

from pulso.inconsistency.db import MemoryStore, PostgresStore, connect
from pulso.inconsistency.llm import InconsistencyLLM
from pulso.inconsistency.run import run_inconsistency
from pulso.inconsistency.settings import InconsistencySettings, InconsistencySettingsError


class _CannedClient:
    """Respuesta del modelo leída de un archivo (ejemplos sin clave). Nunca se usa en el cron."""

    def __init__(self, path: str) -> None:
        self.by_slug = json.loads(Path(path).read_text(encoding="utf-8"))
        self.slug = None

    def complete_json(self, *, system, user, schema, schema_name):
        out = self.by_slug.get(self.slug) or {"findings": []}
        usage = {"input_tokens": int((len(system) + len(user)) / 3.5), "output_tokens": 160 * max(1, len(out["findings"]))}
        return out, usage, "gpt-6-luna"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m pulso.inconsistency")
    parser.add_argument("--candidate")
    parser.add_argument("--dry-run", action="store_true", help="Calcula sin escribir.")
    parser.add_argument("--force", action="store_true", help="Ignora la frecuencia mínima.")
    parser.add_argument("--pack", help="JSON local {candidates, mentions, topics} (solo lectura, sin DB).")
    parser.add_argument("--findings", help="Con --pack: respuesta del modelo escrita a mano (ejemplos sin clave).")
    parser.add_argument("--now", help="Con --pack: momento de la corrida (ISO).")
    parser.add_argument("--out", help="Guarda el resultado JSON en este path.")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        settings = InconsistencySettings.from_env(require_db=not args.pack, require_key=not (args.pack and args.findings))
    except InconsistencySettingsError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    def finish(outcome, rows: bool) -> int:
        text = json.dumps(outcome.as_dict(include_rows=rows), ensure_ascii=False, default=str, indent=2)
        if args.out:
            Path(args.out).write_text(text, encoding="utf-8")
        summary = {c.slug: {"status": c.status, "alerts_new": c.alerts_new, "pairs": c.pairs_checked,
                            "flags": c.flags_checked, "cost_usd": c.cost_usd} for c in outcome.candidates}
        print(json.dumps({"event": "inconsistency_finished", "candidates": summary,
                          "cost_usd": round(outcome.cost_usd, 6)}, ensure_ascii=False))
        return 0 if not any(c.status == "error" for c in outcome.candidates) else 1

    if args.pack:
        pack = json.loads(Path(args.pack).read_text(encoding="utf-8"))
        store = MemoryStore(pack.get("candidates") or [], pack.get("mentions") or [], pack.get("topics") or [])
        now = datetime.fromisoformat(args.now) if args.now else None
        if args.findings:
            canned = _CannedClient(args.findings)
            from pulso.inconsistency.run import RunOutcome

            total = RunOutcome()
            for c in store.list_candidates(args.candidate):
                canned.slug = c["slug"]
                part = run_inconsistency(store=store, settings=settings, llm=InconsistencyLLM(settings, client=canned),
                                         only_slug=c["slug"], now=now, write=True, force=True)
                total.candidates += part.candidates
                total.cost_usd += part.cost_usd
            return finish(total, rows=True)
        outcome = run_inconsistency(store=store, settings=settings, only_slug=args.candidate, now=now,
                                    write=True, force=True)
        return finish(outcome, rows=True)

    with connect(settings.database_url, settings.database_password) as conn:
        outcome = run_inconsistency(store=PostgresStore(conn), settings=settings, only_slug=args.candidate,
                                    write=not args.dry_run, force=args.force)
    return finish(outcome, rows=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
