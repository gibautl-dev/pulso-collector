"""python -m pulso.crisis [--candidate slug] [--pack path.json] [--dry-run]"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from pulso.crisis.agents import CrisisLLM
from pulso.crisis.db import MemoryStore, PostgresStore, connect
from pulso.crisis.run import run_crisis
from pulso.crisis.settings import CrisisSettings, CrisisSettingsError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Equipo de agentes de crisis de Pulso. No publica nada.")
    parser.add_argument("--candidate", help="Slug (por defecto, todos los prendidos).")
    parser.add_argument("--pack", help="JSON exportado (mentions etc.) para correr sin Postgres.")
    parser.add_argument("--dry-run", action="store_true", help="Detecta y arma briefs, no escribe tablas.")
    parser.add_argument("--out", help="Guarda el resultado JSON en este path.")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    if args.pack:
        pack_data = json.loads(Path(args.pack).read_text(encoding="utf-8"))
        candidates = pack_data.get("candidates") or []
        packs = pack_data.get("packs") or {}
        store = MemoryStore(candidates, packs)
        # Para una corrida local con pack, la URL de Postgres no es necesaria.
        try:
            settings = CrisisSettings.from_env()
        except CrisisSettingsError:
            from types import SimpleNamespace
            import os

            key = (os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY") or "").strip()
            if not key:
                print("Falta LLM_API_KEY / OPENAI_API_KEY.", file=sys.stderr)
                return 2
            settings = SimpleNamespace(  # type: ignore[assignment]
                database_url="",
                database_password=None,
                llm_api_key=key,
                llm_base_url=(os.environ.get("LLM_BASE_URL") or "https://api.openai.com/v1").rstrip("/"),
                model=(os.environ.get("LLM_MODEL") or "gpt-6-luna").strip(),
                enabled=True,
                max_cost_usd=float(os.environ.get("PULSO_CRISIS_AGENT_MAX_COST_USD") or 0.50),
                max_briefs_per_run=int(os.environ.get("PULSO_CRISIS_AGENT_MAX_BRIEFS") or 3),
                request_timeout=float(os.environ.get("LLM_TIMEOUT_SECONDS") or 90),
                reasoning_effort=(os.environ.get("LLM_REASONING_EFFORT") or "low").strip() or "low",
                max_retries=int(os.environ.get("LLM_MAX_RETRIES") or 2),
            )
        write = not args.dry_run
        outcome = run_crisis(
            store=store,
            settings=settings,  # type: ignore[arg-type]
            llm=CrisisLLM(settings),
            only_slug=args.candidate,
            write=write,
        )
        result = outcome.as_dict()
        if write:
            result["memory_alerts"] = store.alerts
            result["memory_briefs"] = store.briefs
            result["memory_runs"] = [
                {k: v for k, v in r.items() if k not in {"output"}} for r in store.runs
            ]
        text = json.dumps(result, ensure_ascii=False, default=str, indent=2)
        if args.out:
            Path(args.out).write_text(text, encoding="utf-8")
        else:
            print(text)
        return 0 if not any(c.error for c in outcome.candidates) else 1

    try:
        settings = CrisisSettings.from_env()
    except CrisisSettingsError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    with connect(settings.database_url, settings.database_password) as conn:
        store = PostgresStore(conn)
        outcome = run_crisis(
            store=store,
            settings=settings,
            only_slug=args.candidate,
            write=not args.dry_run,
        )
    text = json.dumps(outcome.as_dict(), ensure_ascii=False, default=str, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    else:
        print(text)
    return 0 if not any(c.error for c in outcome.candidates) else 1


if __name__ == "__main__":
    raise SystemExit(main())
