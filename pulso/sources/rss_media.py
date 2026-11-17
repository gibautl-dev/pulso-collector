import asyncio
import calendar
import json
import random
import re
import unicodedata
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlencode, urljoin, urlsplit
import feedparser
import httpx
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_combine, wait_exponential, wait_random
from .base import Source
from ..config import Settings
from ..models import Candidate, FetchResult, Mention, SourceConfig, SourceName
from ..urls import normalize_url, unwrap_alert, validate_feed_url

class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []
    def handle_data(self, value): self.parts.append(value)

def plain(value):
    parser = Text(); parser.feed(value or "")
    return " ".join(unescape(" ".join(parser.parts)).split())

def fold(value):
    return "".join(c for c in unicodedata.normalize("NFD",value.casefold()) if not unicodedata.combining(c))

def matches(text, candidate):
    text = fold(text)
    def has(term):
        return bool(term.strip()) and re.search(r"(?<!\w)" + re.escape(fold(term.strip())) + r"(?!\w)", text) is not None
    return any(has(k) for k in candidate.keywords) and not any(has(k) for k in candidate.exclude_keywords)

def account_relation(link, config):
    host = (urlsplit(link).hostname or "").lower()
    for key, relation in (("own_domains","own"),("reference_domains","reference")):
        for domain in config.settings.get(key,[]):
            domain = domain.lower().strip().rstrip(".")
            if domain and (host == domain or host.endswith("."+domain)):
                return relation
    return "third_party"

DEFAULT_ACCEPT = (
    "application/rss+xml, application/atom+xml, application/xml;q=0.9, "
    "text/xml;q=0.8, */*;q=0.5"
)
DEFAULT_ACCEPT_LANGUAGE = "es-AR,es;q=0.9,en;q=0.8"
ALERT_HOSTS = {"google.com", "www.google.com", "google.com.ar", "www.google.com.ar"}


class Retryable(Exception):
    def __init__(self, reason, status=None, url=None):
        self.reason = reason
        self.status = status
        self.url = url
        super().__init__(reason)


def client_headers(settings, user_agent=None):
    return {
        "User-Agent": user_agent or settings.user_agent,
        "Accept": DEFAULT_ACCEPT,
        "Accept-Language": DEFAULT_ACCEPT_LANGUAGE,
    }


def feed_user_agent(settings, config, url):
    overrides = (config.settings or {}).get("feed_user_agents") or {}
    if isinstance(overrides, dict):
        value = overrides.get(url)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return settings.user_agent


def safe_request_target(url):
    """Host + path, sin query ni credenciales. En Google Alerts se omite el path con tokens."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return ""
    host = (parts.hostname or "").lower()
    path = parts.path or ""
    if host in ALERT_HOSTS and "/alerts/feeds/" in path:
        return f"{host}/alerts/feeds"
    return f"{host}{path}"


def retry_after_seconds(response, default=2.0, cap=20.0):
    raw = response.headers.get("retry-after", "")
    delay = default
    if raw.strip():
        try:
            delay = float(raw)
        except ValueError:
            try:
                delay = (parsedate_to_datetime(raw) - datetime.now(timezone.utc)).total_seconds()
            except (ValueError, TypeError):
                delay = default
    delay = max(0.0, min(cap, delay))
    return min(cap, delay + random.uniform(0, 0.5))


def format_feed_error(index, exc, url):
    target = safe_request_target(getattr(exc, "url", None) or url)
    status = getattr(exc, "status", None)
    if status is None and isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        target = safe_request_target(str(exc.request.url) if exc.request is not None else url)
    typ = type(exc).__name__
    reason = getattr(exc, "reason", None)
    if typ == "Retryable" and reason in {"rate_limited", "upstream_5xx"}:
        extra = reason
    else:
        extra = None
    parts = [f"feed_{index}: {typ}"]
    if status is not None:
        parts.append(str(status))
    if extra:
        parts.append(extra)
    if target:
        parts.append(target)
    return " ".join(parts)


async def request_feed(client, url, settings, headers, *, return_final=False, data=None):
    # No se siguen redirects sin validar cada destino; máximo cinco saltos.
    async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_combine(wait_exponential(multiplier=2, max=8), wait_random(0, 1)),
            retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError, Retryable)),
            reraise=True):
        with attempt:
            current = url
            for _ in range(6):
                current = await asyncio.to_thread(validate_feed_url,current,settings)
                async with client.stream("POST" if data is not None else "GET",current,headers=headers,data=data) as response:
                    if response.status_code in {301,302,303,307,308}:
                        current = urljoin(current,response.headers["location"])
                        continue
                    if response.status_code == 429:
                        await asyncio.sleep(retry_after_seconds(response))
                        raise Retryable("rate_limited", status=429, url=current)
                    if response.status_code >= 500:
                        raise Retryable("upstream_5xx", status=response.status_code, url=current)
                    if response.status_code == 304: return None, dict(response.headers)
                    response.raise_for_status()
                    chunks = []; size = 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > settings.max_feed_bytes: raise ValueError("feed_too_large")
                        chunks.append(chunk)
                    result = (b"".join(chunks), dict(response.headers))
                    return (*result,current) if return_final else result
            raise ValueError("too_many_redirects")

class RSSSource(Source):
    def __init__(self, name: SourceName, settings: Settings):
        self.name, self.settings = name, settings

    def feeds(self,candidate,config):
        if self.name == SourceName.NEWS:
            query = " OR ".join('"' + k.replace('"','') + '"' for k in candidate.keywords)
            return ["https://news.google.com/rss/search?" + urlencode({"q":query,"hl":"es-419","gl":"AR","ceid":"AR:es-419"})]
        if self.name == SourceName.ALERTS: return candidate.alert_feeds
        return config.settings.get("feeds",[])

    async def fetch(self,candidate: Candidate,since: datetime,config: SourceConfig):
        feeds = list(dict.fromkeys(self.feeds(candidate,config)))
        result = FetchResult(feeds_total=len(feeds),cursor=dict(config.cursor))
        states = dict(config.cursor.get("feeds",{}))
        if not feeds:
            result.errors.append("no_feeds_configured")
            return result
        async with httpx.AsyncClient(timeout=self.settings.timeout_seconds,follow_redirects=False,
                trust_env=self.settings.http_trust_env,headers=client_headers(self.settings)) as client:
            for index,url in enumerate(feeds):
                # Errores sin query ni tokens de Alerts: solo índice, status y host/path.
                try:
                    old = states.get(url,{})
                    headers = {}
                    if old.get("etag"): headers["If-None-Match"] = old["etag"]
                    if old.get("modified"): headers["If-Modified-Since"] = old["modified"]
                    ua = feed_user_agent(self.settings, config, url)
                    if ua != self.settings.user_agent:
                        headers["User-Agent"] = ua
                    data, response_headers = await request_feed(client,url,self.settings,headers)
                    if data is not None:
                        parsed = feedparser.parse(data)
                        if not parsed.get("version"):
                            raise ValueError("invalid_feed")
                        # Feeds malformados se reintentan en la siguiente corrida sin adelantar ETag.
                        if parsed.bozo: raise ValueError("malformed_feed")
                        resolution_failed = False
                        for entry in parsed.entries:
                            try:
                                title = plain(entry.get("title",""))
                                content = plain(entry.get("summary", "") or " ".join(c.get("value","") for c in entry.get("content",[])))
                                if not matches(title + " " + content,candidate): continue
                                date = entry.get("published_parsed") or entry.get("updated_parsed")
                                if not date:
                                    result.skipped_entries += 1; continue
                                published = datetime.fromtimestamp(calendar.timegm(date),timezone.utc)
                                if published < since: continue
                                link = entry.get("link","")
                                link = unwrap_alert(link) if self.name == SourceName.ALERTS else normalize_url(link)
                                if self.name == SourceName.NEWS:
                                    from .google_news import resolve_article
                                    try:
                                        link = await resolve_article(client,link,self.settings)
                                    except Exception as exc:
                                        resolution_failed = True
                                        result.skipped_entries += 1
                                        result.errors.append(f"feed_{index}: article_resolution_{type(exc).__name__}")
                                        continue
                                result.mentions.append(Mention(candidate_id=candidate.id,source=self.name,
                                    source_item_id=entry.get("id") or None,url=link,title=title,content=content,
                                    author=plain(entry.get("author","")) or None,
                                    outlet=plain(entry.get("source",{}).get("title", "")) or plain(parsed.feed.get("title","")),
                                    published_at=published,lang=parsed.feed.get("language"),
                                    account_relation=account_relation(link,config)))
                            except (ValueError,TypeError,OverflowError):
                                result.skipped_entries += 1
                        if not resolution_failed:
                            states[url] = {"etag":response_headers.get("etag"),"modified":response_headers.get("last-modified")}
                        else:
                            # Forzar relectura: un 304 no debe bloquear reintentos de resolución.
                            states.pop(url,None)
                    result.feeds_ok += 1
                except Exception as exc:
                    message = format_feed_error(index, exc, url)
                    result.errors.append(message)
                    print(json.dumps({"event":"feed_error","source":self.name.value,
                                      "error":message}, ensure_ascii=False), flush=True)
                    if self.name == SourceName.NEWS:
                        result.soft_failure = True
        result.cursor = {"feeds":states}
        return result
