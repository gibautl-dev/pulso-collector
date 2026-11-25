"""Consulta oficial del Ads Transparency Center vía BigQuery.

Sin un proyecto de GCP no se ejecuta ninguna query. No se scrapea el sitio.
"""
from __future__ import annotations

from pulso.google_ads.parse import GoogleAd, matches_advertiser, parse_atc_row

ATC_TABLE = "bigquery-public-data.google_ads_transparency_center.creative_stats"

# Query parametrizable: filtra por región al unnest. El costo real (bytes
# escaneados) hay que medirlo con dry-run en el proyecto; esta sentencia
# puede igual leer la tabla completa si no está agrupada por región.
ATC_QUERY = """
SELECT
  advertiser_id,
  creative_id,
  creative_page_url,
  ad_format_type,
  advertiser_disclosed_name,
  advertiser_legal_name,
  advertiser_location,
  advertiser_verification_status,
  topic,
  is_funded_by_google_ad_grants,
  ad_funded_by,
  region_stats
FROM `bigquery-public-data.google_ads_transparency_center.creative_stats`
WHERE EXISTS (
  SELECT 1 FROM UNNEST(region_stats) AS r
  WHERE r.region_code = @region
)
"""


class AtcSkipped(RuntimeError):
    """No se puede consultar el ATC con la configuración actual."""


def atc_skip_reason(*, gcp_project: str | None, credentials_path: str | None = None) -> str | None:
    if gcp_project or credentials_path:
        return None
    return (
        "Falta un proyecto de Google Cloud para consultar "
        "bigquery-public-data.google_ads_transparency_center. "
        "El sandbox oficial de BigQuery no pide tarjeta, dentro de 1 TB/mes. "
        "No se scrapea adstransparency.google.com."
    )


def ads_from_atc_rows(
    rows: list[dict],
    *,
    region: str,
    advertiser_ids: list[str],
    name_patterns: list[str],
) -> list[GoogleAd]:
    ads: list[GoogleAd] = []
    for row in rows:
        ad = parse_atc_row(row, region=region)
        if ad is None:
            continue
        if not matches_advertiser(
            ad.advertiser_name,
            ad.advertiser_id,
            advertiser_ids=advertiser_ids,
            name_patterns=name_patterns,
        ):
            continue
        ads.append(ad)
    return ads


def estimated_bytes_ok(estimated_bytes: int | None, max_bytes: int) -> tuple[bool, str | None]:
    if estimated_bytes is None:
        return False, "No hay dry-run de BigQuery; no se ejecuta la consulta."
    if estimated_bytes > max_bytes:
        return False, (
            f"El dry-run estima {estimated_bytes} bytes, por encima del tope "
            f"{max_bytes}. No se ejecuta la consulta."
        )
    return True, None
