"""Orquesta una corrida de anuncios de Google."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pulso.google_ads.atc import AtcSkipped, ads_from_atc_rows, atc_skip_reason
from pulso.google_ads.parse import GoogleAd
from pulso.google_ads.political_csv import ads_from_csv_path, ads_from_zip
from pulso.google_ads.settings import GoogleAdsSettings, defaults_for_slug

TZ = ZoneInfo("America/Argentina/Buenos_Aires")
DEFAULT_SLUG = "axel-kicillof"


@dataclass
class GoogleAdsQuery:
    slug: str
    source: str
    region: str
    advertiser_ids: list[str]
    advertiser_name_patterns: list[str]


def resolve_query(slug: str, stored: dict | None = None) -> GoogleAdsQuery:
    base = defaults_for_slug(slug)
    stored = stored or {}
    source = stored.get("source") or base["source"]
    region = stored.get("region") or base["region"]
    ids = list(stored.get("advertiser_ids") or base["advertiser_ids"])
    patterns = list(stored.get("advertiser_name_patterns") or base["advertiser_name_patterns"])
    return GoogleAdsQuery(
        slug=slug,
        source=source,
        region=region,
        advertiser_ids=ids,
        advertiser_name_patterns=patterns,
    )


def already_ran_today(last_run_on: date | datetime | None, today: date) -> bool:
    """True si ya hubo una corrida exitosa hoy (reloj America/Argentina/Buenos_Aires)."""
    if last_run_on is None:
        return False
    if isinstance(last_run_on, datetime):
        last_run_on = last_run_on.date()
    return last_run_on == today


def resolve_run(
    slug: str,
    settings: GoogleAdsSettings,
    stored: dict | None = None,
) -> tuple[GoogleAdsQuery, str | None]:
    if not settings.enabled and not settings.dry_run:
        return resolve_query(slug, stored), "disabled"
    query = resolve_query(slug, stored)
    if query.source == "ads_transparency_center":
        # España/ATC queda apagado salvo flag explícito; el dry-run con --from-json sí pasa.
        if not settings.atc_enabled and not settings.dry_run:
            return query, "atc_disabled"
        reason = atc_skip_reason(gcp_project=settings.gcp_project)
        return query, None if settings.dry_run else reason
    return query, None


def run_google_ads(
    *,
    query: GoogleAdsQuery,
    settings: GoogleAdsSettings,
    csv_path: Path | None = None,
    zip_path: Path | None = None,
    atc_rows: list[dict] | None = None,
    today: date | None = None,
) -> dict:
    today = today or datetime.now(TZ).date()
    ads: list[GoogleAd] = []
    report_updated = None
    skip = None
    if query.source == "political_report":
        if csv_path is not None:
            ads = ads_from_csv_path(
                csv_path,
                region=query.region,
                advertiser_ids=query.advertiser_ids,
                name_patterns=query.advertiser_name_patterns,
            )
        elif zip_path is not None:
            ads, report_updated = ads_from_zip(
                zip_path,
                region=query.region,
                advertiser_ids=query.advertiser_ids,
                name_patterns=query.advertiser_name_patterns,
            )
        else:
            skip = "missing_political_file"
    elif query.source == "ads_transparency_center":
        if atc_rows is not None:
            ads = ads_from_atc_rows(
                atc_rows,
                region=query.region,
                advertiser_ids=query.advertiser_ids,
                name_patterns=query.advertiser_name_patterns,
            )
        else:
            reason = atc_skip_reason(gcp_project=settings.gcp_project)
            skip = reason or "atc_query_not_implemented_without_approval"
            if reason:
                raise AtcSkipped(reason)
    else:
        skip = f"unknown_source:{query.source}"
    return {
        "candidate": query.slug,
        "source": query.source,
        "region": query.region,
        "dry_run": settings.dry_run,
        "fetched_on": today.isoformat(),
        "items_found": len(ads),
        "report_updated": report_updated,
        "skip": skip,
        "ads": ads,
    }
