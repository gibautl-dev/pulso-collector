"""CLI: `python -m pulso.google_ads --candidate axel-kicillof [--dry-run]`.

El reporte político (Argentina) se baja del ZIP oficial, como máximo una vez
por día (reloj America/Argentina/Buenos_Aires). El Ads Transparency Center
(España) queda apagado hasta que se habilite con PULSO_GOOGLE_ADS_ATC_ENABLED
y un proyecto de GCP.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from pulso.google_ads.atc import AtcSkipped
from pulso.google_ads.db import GoogleAdsDB, database_url_from_env
from pulso.google_ads.political_csv import (
    OFFICIAL_ZIP_URL,
    download_official_zip,
    official_zip_cache_path,
    report_stamp_to_timestamptz,
)
from pulso.google_ads.run import (
    DEFAULT_SLUG,
    TZ,
    already_ran_today,
    resolve_run,
    run_google_ads,
)
from pulso.google_ads.settings import GoogleAdsSettings, env_explicitly_disabled


def log(**values):
    print(json.dumps(values, ensure_ascii=False, default=str), flush=True)


def _load_json(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        rows = payload.get("rows") or payload.get("ads") or payload.get("data") or []
    else:
        rows = payload
    if not isinstance(rows, list):
        raise ValueError("json_invalido")
    return rows


def _local_file_mode(args: argparse.Namespace) -> bool:
    return bool(args.from_csv or args.from_zip or args.from_json)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", default=DEFAULT_SLUG)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--from-csv", type=Path, help="CSV oficial o recorte local, sin bajar el ZIP")
    parser.add_argument("--from-zip", type=Path, help="ZIP oficial ya descargado")
    parser.add_argument("--from-json", type=Path, help="Filas de ejemplo del ATC, sin consultar BigQuery")
    args = parser.parse_args(argv)
    if args.dry_run and args.write:
        log(event="google_ads_error", error_type="config", detail="Usá --dry-run o --write, no los dos")
        return 2
    dry_override: bool | None
    if args.dry_run:
        dry_override = True
    elif args.write:
        dry_override = False
    elif _local_file_mode(args):
        # Archivo local sin --write: no toca la base.
        dry_override = True
    else:
        dry_override = None
    try:
        if env_explicitly_disabled() and not args.dry_run and not _local_file_mode(args):
            log(event="google_ads_skipped", reason="disabled", candidate=args.candidate)
            return 0
        settings = GoogleAdsSettings.from_env(dry_run=dry_override)
        early_query, early_skip = resolve_run(args.candidate, settings, stored=None)
        # ATC/España se corta acá, sin tocar la base ni bajar el ZIP.
        if early_skip and not _local_file_mode(args):
            log(event="google_ads_skipped", reason=early_skip, candidate=args.candidate)
            return 0
        stored = None
        db = None
        candidate = None
        if not settings.dry_run:
            url, _password = database_url_from_env()
            db = GoogleAdsDB(url)
            try:
                candidate = db.candidate(args.candidate)
                stored = db.settings(candidate["id"])
            except Exception as exc:  # noqa: BLE001 — incluye tabla ausente
                if type(exc).__name__ in {"UndefinedTable", "ProgrammingError"} and "google_ads_settings" in str(exc):
                    log(event="google_ads_skipped", reason="migration_missing", candidate=args.candidate)
                    return 0
                log(event="google_ads_error", error_type=type(exc).__name__, detail="no se pudo leer settings")
                return 1
            if not stored or not stored.get("enabled"):
                log(event="google_ads_skipped", reason="disabled", candidate=args.candidate)
                return 0
        query, skip_reason = resolve_run(args.candidate, settings, stored=stored)
        if skip_reason and not _local_file_mode(args):
            log(event="google_ads_skipped", reason=skip_reason, candidate=args.candidate)
            return 0
        today = datetime.now(TZ).date()
        last_run = stored.get("last_run_on") if stored else None
        if not settings.dry_run and already_ran_today(last_run, today):
            log(
                event="google_ads_skipped",
                reason="already_ran_today",
                candidate=args.candidate,
                last_run_on=str(last_run),
            )
            return 0
        atc_rows = _load_json(args.from_json) if args.from_json else None
        csv_path = args.from_csv
        zip_path = args.from_zip
        if query.source == "political_report" and csv_path is None and zip_path is None:
            cache = official_zip_cache_path(today)
            if cache.is_file() and cache.stat().st_size >= 100_000_000:
                log(event="google_ads_zip_cached", bytes=cache.stat().st_size, candidate=args.candidate)
                zip_path = cache
            else:
                log(event="google_ads_zip_download_started", url=OFFICIAL_ZIP_URL, candidate=args.candidate)
                started = time.monotonic()
                download_official_zip(cache)
                log(
                    event="google_ads_zip_download_finished",
                    bytes=cache.stat().st_size,
                    elapsed_seconds=round(time.monotonic() - started, 3),
                    candidate=args.candidate,
                )
                zip_path = cache
        result = run_google_ads(
            query=query,
            settings=settings,
            csv_path=csv_path,
            zip_path=zip_path,
            atc_rows=atc_rows,
            today=today,
        )
    except AtcSkipped as exc:
        log(event="google_ads_skipped", reason=str(exc), candidate=args.candidate)
        return 0
    except Exception as exc:  # noqa: BLE001 — el CLI reporta y sale
        log(event="google_ads_error", error_type=type(exc).__name__, detail=str(exc))
        return 1
    ads = result.pop("ads")
    log(event="google_ads_done", **result, sample_ad_ids=[ad.ad_id for ad in ads[:5]])
    if settings.dry_run:
        log(event="google_ads_dry_run", detail="No se escribió en la base")
        return 0
    if db is None or candidate is None:
        log(event="google_ads_error", error_type="config", detail="Falta conexión para escribir")
        return 1
    try:
        written = db.upsert_ads(candidate["id"], ads, fetched_on=today)
        db.mark_success(
            candidate["id"],
            run_on=today,
            report_updated_at=report_stamp_to_timestamptz(result.get("report_updated")),
        )
    except Exception as exc:  # noqa: BLE001
        log(event="google_ads_error", error_type=type(exc).__name__, detail="no se pudo escribir")
        return 1
    log(
        event="google_ads_written",
        candidate=args.candidate,
        items_found=result.get("items_found"),
        items_written=written,
        fetched_on=today.isoformat(),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
