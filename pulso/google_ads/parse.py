"""Parseo de filas oficiales (CSV político y creative_stats del ATC)."""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

_NUM = re.compile(r"[^0-9]", re.I)


def parse_int(value: Any) -> int | None:
    if value is None or value is False:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    raw = str(value).strip()
    if not raw:
        return None
    compact = raw.lower().replace(" ", "").replace(",", "")
    if compact.endswith("m") and compact[:-1].replace(".", "").isdigit():
        try:
            return int(float(compact[:-1]) * 1_000_000)
        except ValueError:
            return None
    if compact.endswith("k") and compact[:-1].replace(".", "").isdigit():
        try:
            return int(float(compact[:-1]) * 1_000)
        except ValueError:
            return None
    digits = re.sub(r"[^0-9]", "", compact)
    if not digits:
        return None
    return int(digits)


def parse_bucket(value: Any) -> tuple[int | None, int | None, str | None]:
    """Interpreta un rango oficial de impresiones o un entero suelto."""
    if value is None:
        return None, None, None
    raw = str(value).strip()
    if not raw:
        return None, None, None
    s = raw.replace(" ", "").replace(",", "")
    s = s.replace("≤", "<=").replace("≥", ">=").replace("–", "-").replace("—", "-")
    if s.startswith(">="):
        return parse_int(s[2:]), None, raw
    if s.startswith("<="):
        return None, parse_int(s[2:]), raw
    if s.startswith(">"):
        n = parse_int(s[1:])
        return (n + 1 if n is not None else None), None, raw
    if s.startswith("<"):
        n = parse_int(s[1:])
        return None, (n - 1 if n is not None else None), raw
    if "-" in s:
        left, right = s.split("-", 1)
        return parse_int(left), parse_int(right), raw
    n = parse_int(s)
    return n, n, raw


def _list_regions(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    return [p.strip() for p in str(value).replace(";", ",").split(",") if p.strip()]


def _truthy(value: Any) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "si", "sí"}


@dataclass
class GoogleAd:
    source: str
    ad_id: str
    ad_url: str | None = None
    ad_type: str | None = None
    regions: list[str] = field(default_factory=list)
    advertiser_id: str | None = None
    advertiser_name: str | None = None
    advertiser_legal_name: str | None = None
    date_range_start: str | None = None
    date_range_end: str | None = None
    first_served_at: str | None = None
    last_served_at: str | None = None
    num_of_days: int | None = None
    impressions_lower: int | None = None
    impressions_upper: int | None = None
    impressions_raw: str | None = None
    spend_currency: str | None = None
    spend_lower: int | None = None
    spend_upper: int | None = None
    age_targeting: str | None = None
    gender_targeting: str | None = None
    geo_targeting_included: str | None = None
    geo_targeting_excluded: str | None = None
    topic: str | None = None
    ad_funded_by: str | None = None
    is_funded_by_google_ad_grants: bool | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    def as_row(self) -> dict[str, Any]:
        data = asdict(self)
        return data


def matches_advertiser(
    name: str | None,
    advertiser_id: str | None,
    *,
    advertiser_ids: list[str],
    name_patterns: list[str],
) -> bool:
    if advertiser_ids:
        if advertiser_id and advertiser_id in set(advertiser_ids):
            return True
    if name_patterns:
        hay = (name or "").lower()
        if any(pat.lower() in hay for pat in name_patterns if pat.strip()):
            return True
    if advertiser_ids or name_patterns:
        return False
    return True


def parse_political_row(row: dict[str, Any], *, region: str | None = None) -> GoogleAd | None:
    ad_id = str(row.get("Ad_ID") or row.get("ad_id") or "").strip()
    if not ad_id:
        return None
    regions = _list_regions(row.get("Regions") or row.get("regions"))
    if region and region.upper() not in {r.upper() for r in regions}:
        return None
    currency = None
    spend_lower = spend_upper = None
    # Prefer the configured region's currency; ARS for Argentina.
    for code in ((region or "ARS").upper(), "ARS", "EUR", "USD"):
        lo = row.get(f"Spend_Range_Min_{code}") or row.get(f"spend_range_min_{code.lower()}")
        hi = row.get(f"Spend_Range_Max_{code}") or row.get(f"spend_range_max_{code.lower()}")
        if lo not in (None, "") or hi not in (None, ""):
            currency = code if code != "AR" else "ARS"
            if currency == "AR":
                currency = "ARS"
            spend_lower = parse_int(lo)
            spend_upper = parse_int(hi)
            break
    if currency is None and region and region.upper() == "AR":
        currency = "ARS"
        spend_lower = parse_int(row.get("Spend_Range_Min_ARS"))
        spend_upper = parse_int(row.get("Spend_Range_Max_ARS"))
    impressions_lower, impressions_upper, impressions_raw = parse_bucket(
        row.get("Impressions") or row.get("impressions")
    )
    return GoogleAd(
        source="political_report",
        ad_id=ad_id,
        ad_url=(str(row.get("Ad_URL") or row.get("ad_url") or "").strip() or None),
        ad_type=(str(row.get("Ad_Type") or row.get("ad_type") or "").strip() or None),
        regions=regions,
        advertiser_id=(str(row.get("Advertiser_ID") or row.get("advertiser_id") or "").strip() or None),
        advertiser_name=(str(row.get("Advertiser_Name") or row.get("advertiser_name") or "").strip() or None),
        date_range_start=(str(row.get("Date_Range_Start") or row.get("date_range_start") or "").strip() or None),
        date_range_end=(str(row.get("Date_Range_End") or row.get("date_range_end") or "").strip() or None),
        first_served_at=(str(row.get("First_Served_Timestamp") or row.get("first_served_timestamp") or "").strip() or None),
        last_served_at=(str(row.get("Last_Served_Timestamp") or row.get("last_served_timestamp") or "").strip() or None),
        num_of_days=parse_int(row.get("Num_of_Days") or row.get("num_of_days")),
        impressions_lower=impressions_lower,
        impressions_upper=impressions_upper,
        impressions_raw=impressions_raw,
        spend_currency=currency,
        spend_lower=spend_lower,
        spend_upper=spend_upper,
        age_targeting=(str(row.get("Age_Targeting") or "").strip() or None),
        gender_targeting=(str(row.get("Gender_Targeting") or "").strip() or None),
        geo_targeting_included=(str(row.get("Geo_Targeting_Included") or "").strip() or None),
        geo_targeting_excluded=(str(row.get("Geo_Targeting_Excluded") or "").strip() or None),
        is_funded_by_google_ad_grants=_truthy(row.get("Is_Funded_By_Google_Ad_Grants")),
        raw={"Ad_ID": ad_id},
    )


def _region_stat(row: dict[str, Any], region: str | None) -> dict[str, Any] | None:
    stats = row.get("region_stats") or []
    if not isinstance(stats, list):
        return None
    if not region:
        return stats[0] if stats else None
    wanted = region.upper()
    for item in stats:
        if str(item.get("region_code") or "").upper() == wanted:
            return item
    return None


def parse_atc_row(row: dict[str, Any], *, region: str | None = None) -> GoogleAd | None:
    ad_id = str(row.get("creative_id") or row.get("Ad_ID") or "").strip()
    if not ad_id:
        return None
    stat = _region_stat(row, region)
    if region and stat is None:
        return None
    regions = []
    for item in row.get("region_stats") or []:
        code = str(item.get("region_code") or "").strip()
        if code:
            regions.append(code)
    impressions_lower = impressions_upper = None
    impressions_raw = None
    first_shown = last_shown = None
    if stat:
        impressions_lower = parse_int(stat.get("times_shown_lower_bound"))
        impressions_upper = parse_int(stat.get("times_shown_upper_bound"))
        if impressions_lower is not None or impressions_upper is not None:
            impressions_raw = f"{impressions_lower or ''}-{impressions_upper or ''}".strip("-")
        first_shown = str(stat.get("first_shown") or "").strip() or None
        last_shown = str(stat.get("last_shown") or "").strip() or None
    return GoogleAd(
        source="ads_transparency_center",
        ad_id=ad_id,
        ad_url=(str(row.get("creative_page_url") or "").strip() or None),
        ad_type=(str(row.get("ad_format_type") or "").strip() or None),
        regions=regions,
        advertiser_id=(str(row.get("advertiser_id") or "").strip() or None),
        advertiser_name=(str(row.get("advertiser_disclosed_name") or "").strip() or None),
        advertiser_legal_name=(str(row.get("advertiser_legal_name") or "").strip() or None),
        date_range_start=first_shown,
        date_range_end=last_shown,
        first_served_at=first_shown,
        last_served_at=last_shown,
        impressions_lower=impressions_lower,
        impressions_upper=impressions_upper,
        impressions_raw=impressions_raw,
        topic=(str(row.get("topic") or "").strip() or None),
        ad_funded_by=(str(row.get("ad_funded_by") or "").strip() or None),
        is_funded_by_google_ad_grants=_truthy(row.get("is_funded_by_google_ad_grants")),
        raw={"creative_id": ad_id, "example": bool(row.get("_example"))},
    )
