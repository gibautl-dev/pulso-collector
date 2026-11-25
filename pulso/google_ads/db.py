"""Acceso a google_ads / google_ads_settings."""
from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlparse

import psycopg
from psycopg.types.json import Jsonb

from pulso.google_ads.parse import GoogleAd


def database_url_from_env() -> tuple[str, str | None]:
    url = os.environ.get("DATABASE_URL") or os.environ.get("COLLECTOR_DATABASE_URL")
    if not url:
        raise RuntimeError("Falta DATABASE_URL")
    parsed = urlparse(url)
    password = parsed.password
    # psycopg puede recibir la URL completa; devolvemos también el password
    # por si hay que enmascarar logs (nunca imprimirlo).
    return url, password


class GoogleAdsDB:
    def __init__(self, url: str, password: str | None = None):
        self.url = url
        self._password = password

    def candidate(self, slug: str) -> dict[str, Any]:
        with psycopg.connect(self.url) as conn:
            row = conn.execute(
                "select id, slug, name from public.candidates where slug = %s",
                (slug,),
            ).fetchone()
        if not row:
            raise RuntimeError(f"candidato_no_encontrado:{slug}")
        return {"id": row[0], "slug": row[1], "name": row[2]}

    def settings(self, candidate_id) -> dict[str, Any] | None:
        with psycopg.connect(self.url) as conn:
            row = conn.execute(
                """
                select source, region, advertiser_ids, advertiser_name_patterns,
                       enabled, last_run_on
                from public.google_ads_settings
                where candidate_id = %s
                """,
                (candidate_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "source": row[0],
            "region": row[1],
            "advertiser_ids": list(row[2] or []),
            "advertiser_name_patterns": list(row[3] or []),
            "enabled": row[4],
            "last_run_on": row[5],
        }

    def upsert_ads(self, candidate_id, ads: list[GoogleAd], *, fetched_on) -> int:
        written = 0
        with psycopg.connect(self.url) as conn:
            for ad in ads:
                conn.execute(
                    """
                    insert into public.google_ads (
                      candidate_id, source, ad_id, ad_url, ad_type, regions,
                      advertiser_id, advertiser_name, advertiser_legal_name,
                      date_range_start, date_range_end, first_served_at, last_served_at,
                      num_of_days, impressions_lower, impressions_upper, impressions_raw,
                      spend_currency, spend_lower, spend_upper, age_targeting,
                      gender_targeting, geo_targeting_included, geo_targeting_excluded,
                      topic, ad_funded_by, is_funded_by_google_ad_grants, raw,
                      fetched_on
                    ) values (
                      %(candidate_id)s, %(source)s, %(ad_id)s, %(ad_url)s, %(ad_type)s, %(regions)s,
                      %(advertiser_id)s, %(advertiser_name)s, %(advertiser_legal_name)s,
                      %(date_range_start)s, %(date_range_end)s, %(first_served_at)s, %(last_served_at)s,
                      %(num_of_days)s, %(impressions_lower)s, %(impressions_upper)s, %(impressions_raw)s,
                      %(spend_currency)s, %(spend_lower)s, %(spend_upper)s, %(age_targeting)s,
                      %(gender_targeting)s, %(geo_targeting_included)s, %(geo_targeting_excluded)s,
                      %(topic)s, %(ad_funded_by)s, %(is_funded_by_google_ad_grants)s, %(raw)s,
                      %(fetched_on)s
                    )
                    on conflict (candidate_id, source, ad_id) do update set
                      ad_url = excluded.ad_url,
                      last_served_at = excluded.last_served_at,
                      impressions_lower = excluded.impressions_lower,
                      impressions_upper = excluded.impressions_upper,
                      spend_lower = excluded.spend_lower,
                      spend_upper = excluded.spend_upper,
                      raw = excluded.raw,
                      fetched_at = now(),
                      fetched_on = excluded.fetched_on,
                      updated_at = now()
                    """,
                    {**ad.as_row(), "candidate_id": candidate_id, "fetched_on": fetched_on, "raw": Jsonb(ad.raw)},
                )
                written += 1
            conn.commit()
        return written

    def mark_success(self, candidate_id, *, run_on, report_updated_at=None) -> None:
        with psycopg.connect(self.url) as conn:
            conn.execute(
                """
                update public.google_ads_settings
                   set last_run_on = %s,
                       report_updated_at = coalesce(%s, report_updated_at),
                       updated_at = now()
                 where candidate_id = %s
                """,
                (run_on, report_updated_at, candidate_id),
            )
            conn.commit()
