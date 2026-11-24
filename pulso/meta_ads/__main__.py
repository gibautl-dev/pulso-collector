"""CLI: `python -m pulso.meta_ads --candidate axel-kicillof [--dry-run|--write]`.

En dry-run o con --from-json no escribe en la base. Sin token no hay consulta
real a Graph; usá --from-json con una respuesta simulada.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from pulso.meta_ads.db import MetaAdsDB, database_url_from_env
from pulso.meta_ads.run import DEFAULT_SLUG, TZ, ads_from_payload, resolve_meta_ads_query, run_meta_ads
from pulso.meta_ads.settings import MetaAdsSettings, token_from_env
from pulso.sources.meta_ads import MetaAdsError


def log(**values):
    print(json.dumps(values, ensure_ascii=False, default=str), flush=True)


def _load_json(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        rows = payload.get("ads") or payload.get("data") or payload.get("rows") or []
    else:
        rows = payload
    if not isinstance(rows, list):
        raise ValueError("json_invalido")
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", default=DEFAULT_SLUG)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--from-json", type=Path,
                        help="Lee anuncios simulados de un JSON, sin llamar a Meta")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args(argv)
    if args.dry_run and args.write:
        log(event="meta_ads_error", error_type="config",
            detail="Usá --dry-run o --write, no los dos")
        return 2
    dry_override: bool | None
    if args.dry_run or args.from_json:
        dry_override = True
        if args.write:
            dry_override = False
    elif args.write:
        dry_override = False
    else:
        dry_override = None
    database = None
    try:
        settings = MetaAdsSettings.from_env(dry_run=dry_override)
        ads = ads_from_payload(_load_json(args.from_json)) if args.from_json else None
        candidate_id = None
        already = False
        stored = None
        if not settings.dry_run:
            url, password = database_url_from_env()
            database = MetaAdsDB(url, password)
            row = database.candidate(args.candidate)
            candidate_id = str(row["id"])
            already = database.already_ran_on(row["id"], datetime.now(TZ).date())
            stored = database.settings(row["id"])
        query, settings_enabled, skip_reason = resolve_meta_ads_query(
            args.candidate, settings, stored,
        )
        if skip_reason:
            log(event="meta_ads_skipped", reason=skip_reason, candidate=args.candidate)
            return 0
        if ads is None:
            token_from_env()
        payload = run_meta_ads(
            settings,
            candidate_id=candidate_id,
            candidate_slug=args.candidate,
            query=query,
            ads=ads,
            database=database,
            force=args.force,
            already=already,
            settings_enabled=settings_enabled,
            log=log,
        )
    except (ValueError, MetaAdsError) as exc:
        kind = getattr(exc, "kind", None) or str(exc) or type(exc).__name__
        log(event="meta_ads_error", error_type=kind)
        return 2 if isinstance(exc, ValueError) else 1
    except Exception as exc:
        log(event="meta_ads_error", error_type=type(exc).__name__)
        return 1
    finally:
        if database is not None:
            database.close()
    if args.output and not payload.get("skipped"):
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n",
            encoding="utf-8",
        )
        log(event="meta_ads_wrote_output", path=str(args.output))
    if payload.get("skipped"):
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
