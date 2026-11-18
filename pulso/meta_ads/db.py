"""Persistencia de meta_ads con el rol pulso_collector.

Solo se usa cuando la corrida no es dry-run. Nunca registra la URL ni la
contraseña. El clasificador no ve estas credenciales.
"""
from __future__ import annotations

import os
from datetime import date, datetime
from urllib.parse import urlsplit
from uuid import UUID

from pulso.sources.meta_ads import ArchivedAd

FORBIDDEN_DB_USERS = ("postgres", "service_role", "supabase_admin", "pulso_classifier")
TZ_NAME = "America/Argentina/Buenos_Aires"


def database_url_from_env() -> tuple[str, str | None]:
    url = os.getenv("DATABASE_URL", "")
    parsed = urlsplit(url)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        raise ValueError("Configurar DATABASE_URL")
    if "sslmode=require" not in url and "sslmode=verify" not in url:
        raise ValueError("DATABASE_URL requiere sslmode=require o superior")
    user = (parsed.username or "").split(".")[0]
    if not user or user in FORBIDDEN_DB_USERS:
        raise ValueError("DATABASE_URL debe usar el rol pulso_collector")
    password = os.getenv("PGPASSWORD") or None
    return url, password


class MetaAdsDB:
    def __init__(self, url: str, password: str | None):
        import psycopg
        from psycopg.rows import dict_row
        kwargs = {"autocommit": True, "row_factory": dict_row, "connect_timeout": 15}
        if password:
            kwargs["password"] = password
        self.connection = psycopg.connect(url, **kwargs)

    def close(self):
        self.connection.close()

    def candidate(self, slug: str) -> dict:
        row = self.connection.execute(
            "select id, slug, name from public.candidates where slug=%s", (slug,)
        ).fetchone()
        if not row:
            raise ValueError("Candidato inexistente")
        return row

    def settings(self, candidate_id) -> dict | None:
        return self.connection.execute(
            """select enabled, search_terms, search_page_ids, ad_reached_countries,
                      ad_active_status, ad_type, last_run_on
               from public.meta_ads_settings where candidate_id=%s""",
            (candidate_id,),
        ).fetchone()

    def already_ran_on(self, candidate_id, run_on: date) -> bool:
        row = self.connection.execute(
            """select 1 from public.meta_ads_settings
               where candidate_id=%s and last_run_on=%s""",
            (candidate_id, run_on),
        ).fetchone()
        if row:
            return True
        row = self.connection.execute(
            """select 1 from public.meta_ads
               where candidate_id=%s and fetched_on=%s limit 1""",
            (candidate_id, run_on),
        ).fetchone()
        return row is not None

    def upsert_ads(self, candidate_id, ads: list[ArchivedAd],
                   fetched_at: datetime, fetched_on: date) -> int:
        from psycopg.types.json import Jsonb

        upserted = 0
        cid = UUID(str(candidate_id))
        with self.connection.transaction():
            for ad in ads:
                self.connection.execute(
                    """insert into public.meta_ads (
                         candidate_id, ad_id, page_id, page_name, bylines,
                         publisher_platforms, currency,
                         spend_lower, spend_upper, spend_raw,
                         impressions_lower, impressions_upper, impressions_raw,
                         estimated_audience_size_lower, estimated_audience_size_upper,
                         estimated_audience_size_raw,
                         demographic_distribution, delivery_by_region, languages,
                         ad_creative_bodies, ad_creative_link_captions,
                         ad_creative_link_descriptions, ad_creative_link_titles,
                         ad_snapshot_url, ad_creation_time,
                         ad_delivery_start_time, ad_delivery_stop_time,
                         query_kind, query_value, fetched_at, fetched_on, updated_at
                       ) values (
                         %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                         %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
                       )
                       on conflict (candidate_id, ad_id) do update set
                         page_id = excluded.page_id,
                         page_name = excluded.page_name,
                         bylines = excluded.bylines,
                         publisher_platforms = excluded.publisher_platforms,
                         currency = excluded.currency,
                         spend_lower = excluded.spend_lower,
                         spend_upper = excluded.spend_upper,
                         spend_raw = excluded.spend_raw,
                         impressions_lower = excluded.impressions_lower,
                         impressions_upper = excluded.impressions_upper,
                         impressions_raw = excluded.impressions_raw,
                         estimated_audience_size_lower = excluded.estimated_audience_size_lower,
                         estimated_audience_size_upper = excluded.estimated_audience_size_upper,
                         estimated_audience_size_raw = excluded.estimated_audience_size_raw,
                         demographic_distribution = excluded.demographic_distribution,
                         delivery_by_region = excluded.delivery_by_region,
                         languages = excluded.languages,
                         ad_creative_bodies = excluded.ad_creative_bodies,
                         ad_creative_link_captions = excluded.ad_creative_link_captions,
                         ad_creative_link_descriptions = excluded.ad_creative_link_descriptions,
                         ad_creative_link_titles = excluded.ad_creative_link_titles,
                         ad_snapshot_url = excluded.ad_snapshot_url,
                         ad_creation_time = excluded.ad_creation_time,
                         ad_delivery_start_time = excluded.ad_delivery_start_time,
                         ad_delivery_stop_time = excluded.ad_delivery_stop_time,
                         query_kind = excluded.query_kind,
                         query_value = excluded.query_value,
                         fetched_at = excluded.fetched_at,
                         fetched_on = excluded.fetched_on,
                         updated_at = excluded.updated_at
                       """,
                    (
                        cid, ad.ad_id, ad.page_id, ad.page_name, ad.bylines,
                        Jsonb(ad.publisher_platforms), ad.currency,
                        ad.spend_lower, ad.spend_upper, Jsonb(ad.spend_raw) if ad.spend_raw is not None else None,
                        ad.impressions_lower, ad.impressions_upper,
                        Jsonb(ad.impressions_raw) if ad.impressions_raw is not None else None,
                        ad.estimated_audience_size_lower, ad.estimated_audience_size_upper,
                        Jsonb(ad.estimated_audience_size_raw) if ad.estimated_audience_size_raw is not None else None,
                        Jsonb(ad.demographic_distribution), Jsonb(ad.delivery_by_region),
                        Jsonb(ad.languages), Jsonb(ad.ad_creative_bodies),
                        Jsonb(ad.ad_creative_link_captions),
                        Jsonb(ad.ad_creative_link_descriptions),
                        Jsonb(ad.ad_creative_link_titles),
                        ad.ad_snapshot_url, ad.ad_creation_time,
                        ad.ad_delivery_start_time, ad.ad_delivery_stop_time,
                        ad.query_kind, ad.query_value, fetched_at, fetched_on, fetched_at,
                    ),
                )
                upserted += 1
            self.connection.execute(
                """insert into public.meta_ads_settings (candidate_id, last_run_on, updated_at)
                   values (%s, %s, %s)
                   on conflict (candidate_id) do update set
                     last_run_on = excluded.last_run_on,
                     updated_at = excluded.updated_at""",
                (cid, fetched_on, fetched_at),
            )
        return upserted
