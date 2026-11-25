"""GDELT DOC 2.0: listado de artículos por consulta, sin clave.

Uso comercial permitido con cita y enlace a https://www.gdeltproject.org/.
La propia API pide no más de un pedido cada 5 segundos (mensaje 429).
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_exponential

from .base import Source
from .rss_media import matches
from ..config import Settings
from ..models import Candidate, FetchResult, Mention, SourceConfig, SourceName
from ..region import profile_for
from ..urls import normalize_url, url_hash

DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc"
ATTRIBUTION_URL = "https://www.gdeltproject.org/"
ATTRIBUTION_TEXT = "Proyecto GDELT"
MIN_REQUEST_SECONDS = 5.0
RETRY_WAIT = wait_exponential(multiplier=5, min=5, max=20)
MAX_RECORDS = 250
# Spain is ES in ISO 3166-1; GDELT DOC also accepts the English name.
# The operator value is chosen from the candidate region, with a settings override.
SOURCECOUNTRY = {"AR": "AR", "ES": "ES"}

_throttle_lock = asyncio.Lock()
_last_request_at = 0.0


class Retryable(Exception):
    def __init__(self, reason, status=None):
        self.reason = reason
        self.status = status
        super().__init__(reason)


def source_country_for(slug: str | None, settings: dict | None = None) -> str:
    """Código para sourcecountry: de settings, si no el país del perfil regional."""
    raw = (settings or {}).get("sourcecountry") or (settings or {}).get("source_country")
    if raw and str(raw).strip():
        return str(raw).strip().upper()
    country = profile_for(slug).country
    return SOURCECOUNTRY.get(country, country)


def query_keywords(keywords: list[str]) -> list[str]:
    terms = []
    for raw in keywords:
        term = (raw or "").strip().lstrip("@")
        if term:
            terms.append(term.replace('"', ""))
    return terms


def build_query(candidate: Candidate, sourcecountry: str) -> str:
    terms = query_keywords(candidate.keywords)
    if not terms:
        raise ValueError("gdelt_query_vacia")
    core = " OR ".join(f'"{t}"' for t in terms)
    parts = [f"({core})", f"sourcecountry:{sourcecountry}"]
    for raw in candidate.exclude_keywords:
        excl = (raw or "").strip().replace('"', "")
        if excl:
            parts.append(f'-"{excl}"')
    return " ".join(parts)


def timespan_for(since: datetime, now: datetime | None = None) -> str:
    """Ventana relativa que acepta DOC 2.0; el listado no supera 3 meses."""
    now = now or datetime.now(timezone.utc)
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    seconds = max(0, (now - since).total_seconds())
    if seconds <= 15 * 60:
        return "15min"
    if seconds < 24 * 3600:
        hours = max(1, int(round(seconds / 3600)))
        return f"{hours}h"
    days = max(1, int(round(seconds / 86400)))
    if days >= 90:
        return "3m"
    return f"{days}d"


def parse_seendate(value: str | None) -> datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None
    for fmt in ("%Y%m%dT%H%M%SZ", "%Y%m%dT%H%M%S", "%Y%m%d%H%M%S"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


async def wait_for_slot(min_seconds: float = MIN_REQUEST_SECONDS, sleeper=asyncio.sleep, clock=time.monotonic):
    """Serializa los pedidos de GDELT a no más de uno cada `min_seconds`."""
    global _last_request_at
    async with _throttle_lock:
        now = clock()
        wait = min_seconds - (now - _last_request_at)
        if wait > 0:
            await sleeper(wait)
            now = now + wait
        _last_request_at = now


def reset_throttle():
    """Solo para pruebas."""
    global _last_request_at
    _last_request_at = 0.0


def parse_articles(payload) -> list[dict]:
    if not isinstance(payload, dict):
        raise ValueError("gdelt_respuesta_invalida")
    articles = payload.get("articles")
    if articles is None:
        # A veces viene un mensaje de error en JSON o un cuerpo vacío.
        if payload.get("status") == "error" or "error" in payload:
            raise ValueError("gdelt_error_upstream")
        return []
    if not isinstance(articles, list):
        raise ValueError("gdelt_respuesta_invalida")
    return [row for row in articles if isinstance(row, dict)]


class GdeltSource(Source):
    def __init__(self, settings: Settings):
        self.settings = settings

    async def fetch(self, candidate: Candidate, since: datetime, config: SourceConfig) -> FetchResult:
        result = FetchResult(feeds_total=1, cursor=dict(config.cursor))
        country = source_country_for(candidate.slug, config.settings)
        try:
            query = build_query(candidate, country)
            timespan = timespan_for(since)
        except ValueError as exc:
            result.errors.append(str(exc) or type(exc).__name__)
            return result
        url = DOC_API + "?" + urlencode({
            "query": query,
            "mode": "ArtList",
            "format": "json",
            "maxrecords": str(MAX_RECORDS),
            "timespan": timespan,
            "sort": "DateDesc",
        })
        try:
            payload = await self._request(url)
            articles = parse_articles(payload)
        except Exception as exc:
            typ = type(exc).__name__
            reason = getattr(exc, "reason", None)
            status = getattr(exc, "status", None)
            parts = [f"gdelt: {typ}"]
            if status is not None:
                parts.append(str(status))
            if typ == "Retryable" and reason:
                parts.append(reason)
            result.errors.append(" ".join(parts))
            return result
        result.feeds_ok = 1
        seen: set[str] = set()
        known = {str(h) for h in (config.settings or {}).get("known_url_hashes") or [] if h}
        for row in articles:
            raw_url = (row.get("url") or "").strip()
            if not raw_url:
                result.skipped_entries += 1
                continue
            try:
                link = normalize_url(raw_url)
            except ValueError:
                result.skipped_entries += 1
                continue
            digest = url_hash(link)
            if digest in seen or digest in known:
                result.skipped_entries += 1
                continue
            published = parse_seendate(row.get("seendate"))
            if published is None or published < since:
                result.skipped_entries += 1
                continue
            title = (row.get("title") or "").strip()
            text = f"{title} {row.get('domain') or ''}"
            if not matches(text, candidate):
                result.skipped_entries += 1
                continue
            seen.add(digest)
            domain = (row.get("domain") or "").strip() or None
            lang = (row.get("language") or "").strip() or None
            result.mentions.append(Mention(
                candidate_id=candidate.id,
                source=SourceName.GDELT,
                source_item_id=digest[:32],
                url=link,
                title=title,
                content="",
                author=None,
                author_handle=None,
                outlet=domain,
                published_at=published,
                metrics={"gdelt": True, "sourcecountry": row.get("sourcecountry")},
                lang=lang,
                account_relation="third_party",
            ))
        result.cursor = {
            **result.cursor,
            "sourcecountry": country,
            "timespan": timespan,
            "last_count": len(result.mentions),
        }
        return result

    async def _request(self, url: str):
        headers = {"User-Agent": self.settings.user_agent, "Accept": "application/json"}
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=RETRY_WAIT,
            retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError, Retryable)),
            reraise=True,
        ):
            with attempt:
                await wait_for_slot()
                async with httpx.AsyncClient(
                    timeout=self.settings.timeout_seconds,
                    follow_redirects=True,
                    trust_env=self.settings.http_trust_env,
                    headers=headers,
                ) as client:
                    response = await client.get(url)
                    if response.status_code == 429:
                        raise Retryable("rate_limited", status=429)
                    if response.status_code >= 500:
                        raise Retryable("upstream_5xx", status=response.status_code)
                    response.raise_for_status()
                    ctype = (response.headers.get("content-type") or "").lower()
                    if "json" not in ctype:
                        # GDELT a veces devuelve 200 con un mensaje de texto o HTML.
                        text = response.text.strip()[:200]
                        if "too many" in text.lower() or "limit requests" in text.lower():
                            raise Retryable("rate_limited", status=response.status_code)
                        raise ValueError("gdelt_respuesta_no_json")
                    return response.json()
