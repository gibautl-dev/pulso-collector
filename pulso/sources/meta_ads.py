"""Cliente de la Ad Library API de Meta (ads_archive).

No scrapea facebook.com/ads/library. Solo llama a graph.facebook.com/ads_archive,
que exige un access token. Sin META_ADS_ACCESS_TOKEN no hay consulta real.

Documentación oficial consultada (Graph API v27.0, 2026-11-18):
- https://www.facebook.com/ads/library/api/
- https://developers.facebook.com/docs/graph-api/reference/ads_archive/
- https://developers.facebook.com/docs/graph-api/reference/archived-ad/
- https://developers.facebook.com/docs/graph-api/reference/insights-range-value/
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit
import re

API_HOST = "https://graph.facebook.com"
DEFAULT_API_VERSION = "v27.0"
DEFAULT_COUNTRIES = ("AR",)
DEFAULT_AD_TYPE = "POLITICAL_AND_ISSUE_ADS"
DEFAULT_ACTIVE_STATUS = "ALL"
# search_page_ids admite hasta 10 IDs por pedido (docs oficiales de ads_archive).
PAGE_IDS_PER_REQUEST = 10
# Tope nuestro, no un límite publicado por Meta para este endpoint.
DEFAULT_MAX_PAGES = 40
DEFAULT_MAX_ADS = 2_000
DEFAULT_PAGE_LIMIT = 25
SEARCH_TERMS_MAX_LEN = 100

# Campos útiles en anuncios políticos/de temas de Argentina. Se omiten los que
# las docs limitan a UE, Reino Unido o Brasil (target_*, eu_total_reach, etc.).
ARCHIVE_FIELDS = (
    "id",
    "ad_creation_time",
    "ad_creative_bodies",
    "ad_creative_link_captions",
    "ad_creative_link_descriptions",
    "ad_creative_link_titles",
    "ad_delivery_start_time",
    "ad_delivery_stop_time",
    "ad_snapshot_url",
    "bylines",
    "currency",
    "delivery_by_region",
    "demographic_distribution",
    "estimated_audience_size",
    "impressions",
    "languages",
    "page_id",
    "page_name",
    "publisher_platforms",
    "spend",
)

# Términos por defecto para el candidato demo. Cada uno es una consulta aparte
# (search_terms admite 100 caracteres; el espacio es un AND lógico).
DEFAULT_SEARCH_TERMS = ("Axel Kicillof", "Kicillof")

_RANGE_LABEL = re.compile(
    r"^(?P<lt><)?(?P<gt>>)?(?P<lo>\d+(?:\.\d+)?)(?P<lo_suf>[KM])?"
    r"(?:-(?P<hi>\d+(?:\.\d+)?)(?P<hi_suf>[KM])?)?$",
    re.I,
)


class MetaAdsError(Exception):
    """Error sin secretos; `kind` es seguro para loguear."""

    def __init__(self, kind: str, status: int | None = None, retryable: bool = False):
        super().__init__(kind)
        self.kind = kind
        self.status = status
        self.retryable = retryable


def _as_int(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _suffix_multiplier(suffix: str | None) -> int:
    if not suffix:
        return 1
    return {"K": 1_000, "M": 1_000_000}[suffix.upper()]


def parse_range(value) -> tuple[int | None, int | None, dict | None]:
    """Convierte InsightsRangeValue ({lower_bound, upper_bound}) a enteros.

    Si llega la etiqueta oficial (<1000, 1K-5K, >1M, etc.) se interpreta como
    respaldo. El JSON original se conserva en el tercer valor.
    """
    if value is None:
        return None, None, None
    if isinstance(value, dict):
        lower = _as_int(value.get("lower_bound"))
        upper = _as_int(value.get("upper_bound"))
        return lower, upper, value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = int(value)
        return number, number, {"lower_bound": str(number), "upper_bound": str(number)}
    text = " ".join(str(value).split())
    if not text:
        return None, None, None
    raw = {"text": text}
    match = _RANGE_LABEL.match(text.replace(" ", "").replace(",", ""))
    if not match:
        return None, None, raw
    lo = float(match.group("lo")) * _suffix_multiplier(match.group("lo_suf"))
    if match.group("lt"):
        return None, int(lo) - 1 if lo >= 1 else 0, raw
    if match.group("gt"):
        return int(lo) + 1 if lo.is_integer() else int(lo), None, raw
    if match.group("hi"):
        hi = float(match.group("hi")) * _suffix_multiplier(match.group("hi_suf"))
        return int(lo), int(hi), raw
    return int(lo), int(lo), raw


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    # Las docs muestran 2019-01-24T19:02:04+0000
    if re.search(r"[+-]\d{4}$", text):
        text = text[:-2] + ":" + text[-2:]
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


@dataclass
class ArchivedAd:
    ad_id: str
    page_id: str | None = None
    page_name: str | None = None
    bylines: str | None = None
    publisher_platforms: list = field(default_factory=list)
    currency: str | None = None
    spend_lower: int | None = None
    spend_upper: int | None = None
    spend_raw: dict | None = None
    impressions_lower: int | None = None
    impressions_upper: int | None = None
    impressions_raw: dict | None = None
    estimated_audience_size_lower: int | None = None
    estimated_audience_size_upper: int | None = None
    estimated_audience_size_raw: dict | None = None
    demographic_distribution: list = field(default_factory=list)
    delivery_by_region: list = field(default_factory=list)
    languages: list = field(default_factory=list)
    ad_creative_bodies: list = field(default_factory=list)
    ad_creative_link_captions: list = field(default_factory=list)
    ad_creative_link_descriptions: list = field(default_factory=list)
    ad_creative_link_titles: list = field(default_factory=list)
    ad_snapshot_url: str | None = None
    ad_creation_time: str | None = None
    ad_delivery_start_time: str | None = None
    ad_delivery_stop_time: str | None = None
    query_kind: str | None = None
    query_value: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def parse_ad(payload: dict, *, query_kind: str | None = None,
             query_value: str | None = None) -> ArchivedAd | None:
    ad_id = str(payload.get("id") or "").strip()
    if not ad_id:
        return None
    spend_lo, spend_hi, spend_raw = parse_range(payload.get("spend"))
    imp_lo, imp_hi, imp_raw = parse_range(payload.get("impressions"))
    aud_lo, aud_hi, aud_raw = parse_range(payload.get("estimated_audience_size"))

    def _list(name: str) -> list:
        value = payload.get(name) or []
        return list(value) if isinstance(value, list) else []

    def _time(name: str) -> str | None:
        moment = parse_time(payload.get(name))
        return moment.isoformat() if moment else (str(payload[name]) if payload.get(name) else None)

    return ArchivedAd(
        ad_id=ad_id,
        page_id=str(payload["page_id"]) if payload.get("page_id") else None,
        page_name=payload.get("page_name") or None,
        bylines=payload.get("bylines") or None,
        publisher_platforms=_list("publisher_platforms"),
        currency=payload.get("currency") or None,
        spend_lower=spend_lo,
        spend_upper=spend_hi,
        spend_raw=spend_raw,
        impressions_lower=imp_lo,
        impressions_upper=imp_hi,
        impressions_raw=imp_raw,
        estimated_audience_size_lower=aud_lo,
        estimated_audience_size_upper=aud_hi,
        estimated_audience_size_raw=aud_raw,
        demographic_distribution=_list("demographic_distribution"),
        delivery_by_region=_list("delivery_by_region"),
        languages=_list("languages"),
        ad_creative_bodies=_list("ad_creative_bodies"),
        ad_creative_link_captions=_list("ad_creative_link_captions"),
        ad_creative_link_descriptions=_list("ad_creative_link_descriptions"),
        ad_creative_link_titles=_list("ad_creative_link_titles"),
        ad_snapshot_url=payload.get("ad_snapshot_url") or None,
        ad_creation_time=_time("ad_creation_time"),
        ad_delivery_start_time=_time("ad_delivery_start_time"),
        ad_delivery_stop_time=_time("ad_delivery_stop_time"),
        query_kind=query_kind,
        query_value=query_value,
    )


def chunked(values: list[str], size: int = PAGE_IDS_PER_REQUEST) -> list[list[str]]:
    clean = []
    seen = set()
    for value in values:
        item = str(value).strip()
        if not item or item in seen:
            continue
        seen.add(item)
        clean.append(item)
    return [clean[i:i + size] for i in range(0, len(clean), size)]


def normalize_terms(terms: list[str] | tuple[str, ...] | None) -> list[str]:
    out = []
    seen = set()
    for term in terms or ():
        text = " ".join(str(term).split())
        if not text or text in seen:
            continue
        if len(text) > SEARCH_TERMS_MAX_LEN:
            raise MetaAdsError("search_terms_demasiado_largo")
        seen.add(text)
        out.append(text)
    return out


@dataclass
class MetaAdsQuery:
    search_terms: list[str] = field(default_factory=lambda: list(DEFAULT_SEARCH_TERMS))
    search_page_ids: list[str] = field(default_factory=list)
    ad_reached_countries: list[str] = field(default_factory=lambda: list(DEFAULT_COUNTRIES))
    ad_active_status: str = DEFAULT_ACTIVE_STATUS
    ad_type: str = DEFAULT_AD_TYPE
    search_type: str = "KEYWORD_EXACT_PHRASE"
    api_version: str = DEFAULT_API_VERSION
    max_pages: int = DEFAULT_MAX_PAGES
    max_ads: int = DEFAULT_MAX_ADS
    page_limit: int = DEFAULT_PAGE_LIMIT


def build_params(query: MetaAdsQuery, *, search_terms: str | None = None,
                 search_page_ids: list[str] | None = None,
                 after: str | None = None) -> dict[str, str]:
    if not query.ad_reached_countries:
        raise MetaAdsError("ad_reached_countries_requerido")
    if not search_terms and not search_page_ids:
        raise MetaAdsError("falta_search_terms_o_page_ids")
    countries = ",".join(f"'{code}'" for code in query.ad_reached_countries)
    params = {
        "ad_reached_countries": f"[{countries}]",
        "ad_type": query.ad_type,
        "ad_active_status": query.ad_active_status,
        "fields": ",".join(ARCHIVE_FIELDS),
        "limit": str(query.page_limit),
    }
    if search_terms:
        params["search_terms"] = search_terms
        params["search_type"] = query.search_type
    if search_page_ids:
        params["search_page_ids"] = "[" + ",".join(search_page_ids) + "]"
    if after:
        params["after"] = after
    return params


def _paging_after(payload: dict) -> str | None:
    paging = payload.get("paging") or {}
    cursors = paging.get("cursors") or {}
    after = cursors.get("after")
    if after:
        return str(after)
    nxt = paging.get("next")
    if not nxt:
        return None
    parsed = urlsplit(str(nxt))
    values = parse_qs(parsed.query)
    if values.get("after"):
        return values["after"][0]
    return None


class MetaAdsClient:
    """GET /{version}/ads_archive con paginación por cursor."""

    def __init__(self, access_token: str, *, timeout: float = 30,
                 transport=None, api_version: str = DEFAULT_API_VERSION):
        token = (access_token or "").strip()
        if not token:
            raise MetaAdsError("falta_access_token")
        self._token = token
        self.timeout = timeout
        self.transport = transport
        self.api_version = api_version or DEFAULT_API_VERSION

    def _url(self) -> str:
        return f"{API_HOST}/{self.api_version}/ads_archive"

    def _get(self, params: dict) -> dict:
        import httpx
        query = dict(params)
        query["access_token"] = self._token
        try:
            with httpx.Client(timeout=self.timeout, transport=self.transport) as client:
                response = client.get(self._url(), params=query)
        except httpx.TimeoutException as exc:
            raise MetaAdsError("timeout", retryable=True) from exc
        except httpx.HTTPError as exc:
            raise MetaAdsError("http_error", retryable=True) from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise MetaAdsError("json_invalido", status=response.status_code) from exc
        if response.status_code >= 400 or (isinstance(payload, dict) and payload.get("error")):
            error = (payload or {}).get("error") or {}
            code = error.get("code")
            kind = "api_error"
            if code == 613:
                kind = "rate_limit"
            elif code == 190:
                kind = "token_invalido"
            elif code == 10:
                kind = "sin_permiso"
            elif code == 100:
                kind = "parametro_invalido"
            raise MetaAdsError(kind, status=response.status_code, retryable=(code == 613))
        if not isinstance(payload, dict):
            raise MetaAdsError("respuesta_invalida", status=response.status_code)
        return payload

    def _iter_pages(self, params: dict, query: MetaAdsQuery,
                    kind: str, value: str) -> list[ArchivedAd]:
        ads: list[ArchivedAd] = []
        after = None
        for _ in range(query.max_pages):
            page_params = dict(params)
            if after:
                page_params["after"] = after
            payload = self._get(page_params)
            rows = payload.get("data") or []
            if not rows:
                # Docs: data vacío al paginar significa el final del resultado.
                break
            for row in rows:
                if not isinstance(row, dict):
                    continue
                ad = parse_ad(row, query_kind=kind, query_value=value)
                if ad:
                    ads.append(ad)
                if len(ads) >= query.max_ads:
                    return ads
            after = _paging_after(payload)
            if not after:
                break
        return ads

    def search(self, query: MetaAdsQuery) -> list[ArchivedAd]:
        terms = normalize_terms(query.search_terms)
        pages = chunked(query.search_page_ids)
        if not terms and not pages:
            raise MetaAdsError("falta_search_terms_o_page_ids")
        merged: dict[str, ArchivedAd] = {}
        for term in terms:
            params = build_params(query, search_terms=term)
            for ad in self._iter_pages(params, query, "terms", term):
                merged.setdefault(ad.ad_id, ad)
                if len(merged) >= query.max_ads:
                    return list(merged.values())
        for group in pages:
            params = build_params(query, search_page_ids=group)
            label = ",".join(group)
            for ad in self._iter_pages(params, query, "page_ids", label):
                merged.setdefault(ad.ad_id, ad)
                if len(merged) >= query.max_ads:
                    return list(merged.values())
        return list(merged.values())
