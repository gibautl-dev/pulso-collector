"""CLI: `python -m pulso.google_ads --candidate axel-kicillof [--dry-run]`.

En dry-run o con --from-csv/--from-json no escribe en la base. Sin proyecto
GCP no hay consulta al Ads Transparency Center. El job no está en el cron.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pulso.google_ads.atc import AtcSkipped
from pulso.google_ads.run import DEFAULT_SLUG, resolve_run, run_google_ads
from pulso.google_ads.settings import GoogleAdsSettings


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
    if args.dry_run or args.from_csv or args.from_zip or args.from_json:
        dry_override = True
        if args.write:
            dry_override = False
    elif args.write:
        dry_override = False
    else:
        dry_override = None
    try:
        settings = GoogleAdsSettings.from_env(dry_run=dry_override)
        query, skip_reason = resolve_run(args.candidate, settings, stored=None)
        if skip_reason and not (args.from_csv or args.from_zip or args.from_json):
            log(event="google_ads_skipped", reason=skip_reason, candidate=args.candidate)
            return 0
        atc_rows = _load_json(args.from_json) if args.from_json else None
        result = run_google_ads(
            query=query,
            settings=settings,
            csv_path=args.from_csv,
            zip_path=args.from_zip,
            atc_rows=atc_rows,
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
    elif args.write:
        log(event="google_ads_write_skipped", detail="La migración no está aplicada; no se escribe")
    return 0


if __name__ == "__main__":
    sys.exit(main())
