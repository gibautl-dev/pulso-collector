"""Configuración de la corrida diaria. El token nunca se loguea ni se repr."""
from __future__ import annotations

import os
from dataclasses import dataclass, field

from pulso.sources.meta_ads import (
    DEFAULT_ACTIVE_STATUS,
    DEFAULT_AD_TYPE,
    DEFAULT_API_VERSION,
    DEFAULT_COUNTRIES,
    DEFAULT_MAX_ADS,
    DEFAULT_MAX_PAGES,
    DEFAULT_SEARCH_TERMS,
    MetaAdsQuery,
    normalize_terms,
)


def token_from_env() -> str:
    token = (os.getenv("META_ADS_ACCESS_TOKEN") or "").strip()
    if not token:
        raise ValueError("Configurar META_ADS_ACCESS_TOKEN")
    return token


@dataclass(frozen=True)
class MetaAdsSettings:
    dry_run: bool = False
    run_after_hour: int = 9
    timeout_seconds: float = 30
    api_version: str = DEFAULT_API_VERSION
    default_search_terms: tuple[str, ...] = field(default=DEFAULT_SEARCH_TERMS)
    default_countries: tuple[str, ...] = field(default=DEFAULT_COUNTRIES)
    ad_type: str = DEFAULT_AD_TYPE
    ad_active_status: str = DEFAULT_ACTIVE_STATUS
    max_pages: int = DEFAULT_MAX_PAGES
    max_ads: int = DEFAULT_MAX_ADS

    @classmethod
    def from_env(cls, dry_run: bool | None = None) -> "MetaAdsSettings":
        if dry_run is None:
            flag = os.getenv("PULSO_META_ADS_DRY_RUN", "false").lower()
            if flag not in {"true", "false"}:
                raise ValueError("PULSO_META_ADS_DRY_RUN debe ser true o false")
            dry_run = flag == "true"
        hour = int(os.getenv("PULSO_META_ADS_RUN_HOUR", "9"))
        if not 0 <= hour <= 23:
            raise ValueError("PULSO_META_ADS_RUN_HOUR inválida")
        timeout = float(os.getenv("PULSO_META_ADS_HTTP_TIMEOUT", "30"))
        if not 5 <= timeout <= 120:
            raise ValueError("PULSO_META_ADS_HTTP_TIMEOUT inválido")
        version = (os.getenv("META_ADS_API_VERSION") or DEFAULT_API_VERSION).strip()
        if not version.startswith("v"):
            raise ValueError("META_ADS_API_VERSION inválida")
        return cls(dry_run=bool(dry_run), run_after_hour=hour,
                   timeout_seconds=timeout, api_version=version)

    def query(self, *, search_terms: list[str] | None = None,
              search_page_ids: list[str] | None = None,
              countries: list[str] | None = None) -> MetaAdsQuery:
        terms = normalize_terms(search_terms if search_terms is not None else self.default_search_terms)
        return MetaAdsQuery(
            search_terms=terms,
            search_page_ids=list(search_page_ids or []),
            ad_reached_countries=list(countries or self.default_countries),
            ad_active_status=self.ad_active_status,
            ad_type=self.ad_type,
            api_version=self.api_version,
            max_pages=self.max_pages,
            max_ads=self.max_ads,
        )
