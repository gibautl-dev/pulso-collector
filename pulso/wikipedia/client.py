"""Cliente de la API de visitas de Wikimedia. Sin clave, con User-Agent identificable."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

import httpx

API_BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article"
# Visitas de personas, sin spiders ni bots.
ACCESS = "all-access"
AGENT = "user"
GRANULARITY = "daily"
DEFAULT_DAYS = 30


def date_stamp(day: date) -> str:
    return day.strftime("%Y%m%d")


def parse_timestamp(value: str) -> date:
    raw = (value or "").strip()
    if len(raw) >= 8 and raw[:8].isdigit():
        return date(int(raw[0:4]), int(raw[4:6]), int(raw[6:8]))
    raise ValueError("wikipedia_timestamp_invalido")


def range_for(today: date | None = None, days: int = DEFAULT_DAYS) -> tuple[date, date]:
    end = today or datetime.now(timezone.utc).date()
    start = end - timedelta(days=max(1, days) - 1)
    return start, end


def pageviews_url(project: str, title: str, start: date, end: date) -> str:
    article = quote(title, safe="")
    return (
        f"{API_BASE}/{quote(project, safe='.-')}/{ACCESS}/{AGENT}/"
        f"{article}/{GRANULARITY}/{date_stamp(start)}/{date_stamp(end)}"
    )


def parse_items(payload) -> list[dict]:
    if not isinstance(payload, dict):
        raise ValueError("wikipedia_respuesta_invalida")
    items = payload.get("items")
    if not isinstance(items, list):
        raise ValueError("wikipedia_respuesta_invalida")
    rows = []
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            day = parse_timestamp(str(item.get("timestamp") or ""))
            views = int(item.get("views"))
        except (TypeError, ValueError):
            continue
        if views < 0:
            continue
        rows.append({
            "day": day,
            "views": views,
            "article": item.get("article"),
            "project": item.get("project"),
        })
    rows.sort(key=lambda r: r["day"])
    return rows


async def fetch_pageviews(
    *,
    project: str,
    title: str,
    start: date,
    end: date,
    user_agent: str,
    timeout: float = 20,
    trust_env: bool = False,
    transport=None,
) -> list[dict]:
    url = pageviews_url(project, title, start, end)
    headers = {
        "User-Agent": user_agent,
        "Accept": "application/json",
    }
    kwargs = dict(timeout=timeout, follow_redirects=True, trust_env=trust_env, headers=headers)
    if transport is not None:
        kwargs["transport"] = transport
    async with httpx.AsyncClient(**kwargs) as client:
        response = await client.get(url)
        if response.status_code == 404:
            return []
        response.raise_for_status()
        return parse_items(response.json())
