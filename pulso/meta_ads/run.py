"""Orquesta una corrida diaria de la Biblioteca de anuncios de Meta.

El dry-run nunca escribe en la base. La escritura usa el rol pulso_collector.
La corrida programada espera a las 09:00 (hora de Argentina) y se saltea si
ya corrió ese día, salvo --force.
"""
from __future__ import annotations

from datetime import datetime
from typing import Callable
from zoneinfo import ZoneInfo

from pulso.meta_ads.settings import MetaAdsSettings, token_from_env
from pulso.sources.meta_ads import (
    ArchivedAd,
    MetaAdsClient,
    MetaAdsError,
    MetaAdsQuery,
    parse_ad,
)

TZ = ZoneInfo("America/Argentina/Buenos_Aires")
DEFAULT_SLUG = "axel-kicillof"
DEFAULT_RUN_HOUR = 9


def _now() -> datetime:
    return datetime.now(TZ)


def should_run_now(now: datetime | None = None, hour: int = DEFAULT_RUN_HOUR,
                   already: bool = False, force: bool = False) -> tuple[bool, str | None]:
    current = now or _now()
    if force:
        return True, None
    if already:
        return False, "already_ran_today"
    if current.hour < hour:
        return False, "before_hour"
    return True, None


def ads_from_payload(rows: list[dict]) -> list[ArchivedAd]:
    ads = []
    seen = set()
    for row in rows:
        ad = row if isinstance(row, ArchivedAd) else parse_ad(row if isinstance(row, dict) else {})
        if not ad or ad.ad_id in seen:
            continue
        seen.add(ad.ad_id)
        ads.append(ad)
    return ads


def run_meta_ads(
    settings: MetaAdsSettings,
    *,
    candidate_id: str | None = None,
    candidate_slug: str | None = None,
    query: MetaAdsQuery | None = None,
    client: MetaAdsClient | None = None,
    ads: list[ArchivedAd] | None = None,
    database=None,
    force: bool = False,
    already: bool = False,
    settings_enabled: bool = True,
    now: datetime | None = None,
    log: Callable[..., None] | None = None,
) -> dict:
    log = log or (lambda **kwargs: None)
    fetched_at = now or _now()
    ok, reason = should_run_now(fetched_at, settings.run_after_hour, already=already, force=force)
    if not ok:
        log(event="meta_ads_skipped", reason=reason, hour=settings.run_after_hour)
        return {
            "skipped": True,
            "reason": reason,
            "dry_run": settings.dry_run,
            "wrote_db": False,
            "ads": [],
            "fetched_at": fetched_at.isoformat(),
            "timezone": "America/Argentina/Buenos_Aires",
        }
    if not settings_enabled and not force:
        log(event="meta_ads_skipped", reason="settings_disabled")
        return {
            "skipped": True,
            "reason": "settings_disabled",
            "dry_run": settings.dry_run,
            "wrote_db": False,
            "ads": [],
            "fetched_at": fetched_at.isoformat(),
            "timezone": "America/Argentina/Buenos_Aires",
        }
    query = query or settings.query()
    if ads is None:
        client = client or MetaAdsClient(
            token_from_env(),
            timeout=settings.timeout_seconds,
            api_version=query.api_version,
        )
        ads = client.search(query)
    fetched_on = fetched_at.date()
    wrote = 0
    if not settings.dry_run:
        if database is None or not candidate_id:
            raise MetaAdsError("falta_base_o_candidato")
        wrote = database.upsert_ads(candidate_id, ads, fetched_at, fetched_on)
        log(event="meta_ads_saved", upserted=wrote, unique_ads=len(ads))
    else:
        log(event="meta_ads_dry_run", unique_ads=len(ads))
    return {
        "skipped": False,
        "dry_run": settings.dry_run,
        "wrote_db": bool(wrote),
        "upserted": wrote,
        "unique_ads": len(ads),
        "search_terms": query.search_terms,
        "search_page_ids": query.search_page_ids,
        "ad_reached_countries": query.ad_reached_countries,
        "ad_type": query.ad_type,
        "ad_active_status": query.ad_active_status,
        "candidate_id": candidate_id,
        "candidate_slug": candidate_slug,
        "fetched_at": fetched_at.isoformat(),
        "fetched_on": fetched_on.isoformat(),
        "timezone": "America/Argentina/Buenos_Aires",
        "ads": [ad.to_dict() for ad in ads],
    }
