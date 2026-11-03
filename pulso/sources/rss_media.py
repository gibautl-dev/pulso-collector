import asyncio
import calendar
import re
import unicodedata
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlencode, urljoin, urlsplit
import feedparser
import httpx
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_exponential
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

class Retryable(Exception): pass

async def request_feed(client, url, settings, headers, *, return_final=False, data=None):
    # No se siguen redirects sin validar cada destino; máximo cinco saltos.
    async for attempt in AsyncRetrying(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=2,max=8),
            retry=retry_if_exception_type((httpx.TimeoutException,httpx.NetworkError,Retryable)), reraise=True):
        with attempt:
            current = url
            for _ in range(6):
                current = await asyncio.to_thread(validate_feed_url,current,settings)
                async with client.stream("POST" if data is not None else "GET",current,headers=headers,data=data) as response:
                    if response.status_code in {301,302,303,307,308}:
                        current = urljoin(current,response.headers["location"])
                        continue
                    if response.status_code == 429:
                        raw = response.headers.get("retry-after", "")
                        try:
                            delay = float(raw)
                        except ValueError:
                            try: delay = (parsedate_to_datetime(raw)-datetime.now(timezone.utc)).total_seconds()
                            except (ValueError,TypeError): delay = 61
                        if not 0 <= delay <= 60:
                            raise ValueError("rate_limited")
                        await asyncio.sleep(delay)
                        raise Retryable("rate_limited")
                    if response.status_code >= 500: raise Retryable("upstream_5xx")
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
                trust_env=self.settings.http_trust_env,headers={"User-Agent":self.settings.user_agent}) as client:
            for index,url in enumerate(feeds):
                # Errores solo con índice: Google Alerts puede incluir tokens en su URL.
                try:
                    old = states.get(url,{})
                    headers = {}
                    if old.get("etag"): headers["If-None-Match"] = old["etag"]
                    if old.get("modified"): headers["If-Modified-Since"] = old["modified"]
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
                    result.errors.append(f"feed_{index}: {type(exc).__name__}")
        result.cursor = {"feeds":states}
        return result
