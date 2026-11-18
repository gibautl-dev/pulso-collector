"""Adaptador de X API v2 recent search. El token queda solo en el servidor."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import httpx
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_exponential

from .base import Source
from .rss_media import Retryable
from ..config import Settings
from ..models import Candidate, FetchResult, Mention, SourceConfig, SourceName

API_URL = "https://api.x.com/2/tweets/search/recent"
QUERY_MAX_LEN = 512
MIN_RESULTS = 10
MAX_RESULTS = 100
DEFAULT_MAX_POSTS = 300
DEFAULT_MAX_REQUESTS = 10
DEFAULT_MAX_PER_RUN = 25
RECENT_WINDOW = timedelta(days=7)
TWEET_FIELDS = (
    "id,text,author_id,created_at,lang,public_metrics,"
    "conversation_id,in_reply_to_user_id,referenced_tweets"
)
USER_FIELDS = "id,name,username,created_at,verified,verified_type,public_metrics"


def quota_date(now: datetime) -> str:
    return now.astimezone(timezone.utc).date().isoformat()


def quota_reset_at(now: datetime) -> datetime:
    utc = now.astimezone(timezone.utc)
    return datetime.combine(utc.date() + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)


def post_url(username: str | None, post_id: str) -> str:
    handle = (username or "i").lstrip("@") or "i"
    return f"https://x.com/{handle}/status/{post_id}"


def _int_setting(settings: dict, key: str, default: int, *, low: int, high: int) -> int:
    raw = settings.get(key, default)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = default
    return max(low, min(high, value))


def _bool_setting(settings: dict, key: str, default: bool) -> bool:
    raw = settings.get(key, default)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return raw.lower() in {"true", "1", "yes"}
    return default


def _as_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_time(value: str) -> datetime:
    text = (value or "").replace("Z", "+00:00")
    published = datetime.fromisoformat(text)
    if published.tzinfo is None:
        raise ValueError("fecha sin zona")
    return published.astimezone(timezone.utc)


def _handles(value) -> set[str]:
    items = []
    if isinstance(value, str) and value.strip():
        items = [value]
    elif isinstance(value, list):
        items = value
    return {str(item).strip().lstrip("@").lower() for item in items if str(item).strip()}


def account_relation(username: str | None, candidate: Candidate, config: SourceConfig) -> str:
    handle = (username or "").lstrip("@").lower()
    if not handle:
        return "third_party"
    own = _handles(config.settings.get("own_handles"))
    own.update(_handles((candidate.own_accounts or {}).get("x")))
    reference = _handles(config.settings.get("reference_handles"))
    reference.update(_handles((candidate.reference_accounts or {}).get("x")))
    if handle in own:
        return "own"
    if handle in reference:
        return "reference"
    return "third_party"


def _keyword_clause(keyword: str) -> str | None:
    text = (keyword or "").strip().replace('"', "")
    if not text:
        return None
    if text.startswith("@") or " " in text:
        return text if text.startswith("@") else f'"{text}"'
    return text


def search_query(candidate: Candidate, settings: dict | None = None) -> str:
    settings = settings or {}
    parts = []
    seen = set()
    for keyword in candidate.keywords:
        clause = _keyword_clause(keyword)
        if clause and clause.lower() not in seen:
            seen.add(clause.lower())
            parts.append(clause)
    if not parts:
        raise ValueError("query_vacia")
    core = " OR ".join(parts)
    if len(parts) > 1:
        core = f"({core})"
    query = core
    if _bool_setting(settings, "lang_es", True):
        query += " lang:es"
    if _bool_setting(settings, "exclude_retweets", True):
        query += " -is:retweet"
    if _bool_setting(settings, "exclude_replies", True):
        query += " -is:reply"
    if len(query) > QUERY_MAX_LEN:
        raise ValueError("query_demasiado_larga")
    return query


def _ref_types(post: dict) -> set[str]:
    return {str(item.get("type")) for item in post.get("referenced_tweets") or [] if item.get("type")}


def _metrics(post: dict, author: dict) -> dict:
    public = post.get("public_metrics") or {}
    user_public = author.get("public_metrics") or {}
    types = _ref_types(post)
    values = {
        "like_count": _as_int(public.get("like_count")),
        "repost_count": _as_int(public.get("retweet_count")),
        "reply_count": _as_int(public.get("reply_count")),
        "quote_count": _as_int(public.get("quote_count")),
        "impression_count": _as_int(public.get("impression_count")),
        "bookmark_count": _as_int(public.get("bookmark_count")),
        "author_id": author.get("id") or post.get("author_id"),
        "author_followers": _as_int(user_public.get("followers_count")),
        "author_following": _as_int(user_public.get("following_count")),
        "author_tweet_count": _as_int(user_public.get("tweet_count")),
        "author_listed_count": _as_int(user_public.get("listed_count")),
        "author_created_at": author.get("created_at"),
        "author_verified": author.get("verified"),
        "author_verified_type": author.get("verified_type"),
        "is_reply": bool(post.get("in_reply_to_user_id") or "replied_to" in types),
        "is_quote": "quoted" in types,
        "is_retweet": "retweeted" in types,
        "conversation_id": post.get("conversation_id"),
    }
    return {key: value for key, value in values.items() if value is not None}


class XSource(Source):
    def __init__(self, settings: Settings):
        self.settings = settings

    async def fetch(self, candidate: Candidate, since: datetime, config: SourceConfig) -> FetchResult:
        result = FetchResult(feeds_total=1, cursor=dict(config.cursor), soft_failure=False)
        cursor = dict(config.cursor)
        now = datetime.now(timezone.utc)
        quota = self._quota_state(cursor, now)
        cursor["quota"] = quota
        result.cursor = cursor

        if not self.settings.x_bearer_token:
            result.errors.append("missing_bearer_token")
            result.soft_failure = True
            return result

        backoff = quota.get("backoff_until")
        if backoff:
            until = datetime.fromisoformat(str(backoff).replace("Z", "+00:00"))
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            if until > now:
                result.errors.append("quota_backoff")
                result.soft_failure = True
                return result

        try:
            async with httpx.AsyncClient(
                timeout=self.settings.timeout_seconds,
                follow_redirects=False,
                trust_env=self.settings.http_trust_env,
                headers={
                    "User-Agent": self.settings.user_agent,
                    "Authorization": f"Bearer {self.settings.x_bearer_token}",
                },
            ) as client:
                await self._collect(client, candidate, since, config, result, cursor, quota, now)
        except httpx.HTTPStatusError as exc:
            result.errors.append(f"HTTP{exc.response.status_code}")
            result.soft_failure = True
        except ValueError as exc:
            result.errors.append(str(exc) or type(exc).__name__)
            result.soft_failure = True
        except Exception as exc:
            result.errors.append(type(exc).__name__)
            result.soft_failure = True
        return result

    def _quota_state(self, cursor: dict, now: datetime) -> dict:
        today = quota_date(now)
        raw = dict(cursor.get("quota") or {})
        if raw.get("date") != today:
            return {"date": today, "posts": 0, "requests": 0, "backoff_until": None}
        return {
            "date": today,
            "posts": int(raw.get("posts") or 0),
            "requests": int(raw.get("requests") or 0),
            "backoff_until": raw.get("backoff_until"),
        }

    def _caps(self, candidate: Candidate, config: SourceConfig) -> tuple[int, int, int]:
        settings = config.settings or {}
        default_posts = candidate.x_daily_cap if candidate.x_daily_cap else DEFAULT_MAX_POSTS
        return (
            _int_setting(settings, "max_posts_per_day", default_posts, low=1, high=100_000),
            _int_setting(settings, "max_requests_per_day", DEFAULT_MAX_REQUESTS, low=1, high=1_000),
            _int_setting(settings, "max_posts_per_run", DEFAULT_MAX_PER_RUN, low=1, high=1_000),
        )

    async def _collect(self, client, candidate, since, config, result, cursor, quota, now):
        max_posts, max_requests, max_per_run = self._caps(candidate, config)
        remaining = min(max_posts - quota["posts"], max_per_run)
        if remaining <= 0 or quota["requests"] >= max_requests:
            result.errors.append("daily_quota_cap")
            result.soft_failure = True
            return

        query = search_query(candidate, config.settings)
        params = {
            "query": query,
            "max_results": max(MIN_RESULTS, min(MAX_RESULTS, remaining)),
            "tweet.fields": TWEET_FIELDS,
            "expansions": "author_id",
            "user.fields": USER_FIELDS,
        }
        since_id = cursor.get("since_id")
        if since_id:
            params["since_id"] = str(since_id)
        else:
            start = max(since, now - RECENT_WINDOW)
            params["start_time"] = start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        mentions = []
        newest_id = str(since_id) if since_id else None
        page = None
        run_budget = remaining
        while len(mentions) < run_budget and quota["requests"] < max_requests:
            room = run_budget - len(mentions)
            params["max_results"] = max(MIN_RESULTS, min(MAX_RESULTS, room))
            if page:
                params["next_token"] = page
            payload = await self._request(client, params)
            quota["requests"] = int(quota.get("requests") or 0) + 1
            cursor["quota"] = quota
            result.cursor = cursor
            result.feeds_ok = 1
            users = {
                item["id"]: item
                for item in (payload.get("includes") or {}).get("users") or []
                if item.get("id")
            }
            posts = payload.get("data") or []
            # Se facturan todos los posts devueltos, se guarden o no.
            quota["posts"] = int(quota.get("posts") or 0) + len(posts)
            cursor["quota"] = quota
            for post in posts:
                post_id = str(post.get("id") or "")
                if post_id and (newest_id is None or int(post_id) > int(newest_id)):
                    newest_id = post_id
                if len(mentions) >= run_budget:
                    continue
                mention = self._mention(post, users, candidate, since, config, result)
                if mention is not None:
                    mentions.append(mention)
            page = (payload.get("meta") or {}).get("next_token")
            if not page or not posts or len(mentions) >= run_budget:
                break
            params.pop("start_time", None)
            params.pop("since_id", None)

        if newest_id:
            cursor["since_id"] = newest_id
        cursor["quota"] = quota
        result.cursor = cursor
        result.mentions = mentions
        if quota["posts"] >= max_posts or quota["requests"] >= max_requests:
            if not mentions and result.feeds_ok:
                result.errors.append("daily_quota_cap")
                result.soft_failure = True

    def _mention(self, post, users, candidate, since, config, result):
        post_id = str(post.get("id") or "")
        text = post.get("text") or ""
        if not post_id or not text:
            result.skipped_entries += 1
            return None
        try:
            published = _parse_time(post.get("created_at", ""))
        except (ValueError, TypeError):
            result.skipped_entries += 1
            return None
        if published < since:
            return None
        author = users.get(post.get("author_id")) or {}
        username = author.get("username")
        name = author.get("name")
        return Mention(
            candidate_id=candidate.id,
            source=SourceName.X,
            source_item_id=post_id,
            url=post_url(username, post_id),
            title=text,
            content=text,
            author=name or username or None,
            author_handle=username or None,
            outlet=name or "X",
            published_at=published,
            metrics=_metrics(post, author),
            lang=post.get("lang"),
            account_relation=account_relation(username, candidate, config),
        )

    async def _request(self, client: httpx.AsyncClient, params: dict) -> dict:
        async for attempt in AsyncRetrying(
            retry=retry_if_exception_type(Retryable),
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=1, max=8),
            reraise=True,
        ):
            with attempt:
                response = await client.get(API_URL, params=params)
                if response.status_code == 429 or response.status_code >= 500:
                    raise Retryable("upstream")
                if response.status_code in {401, 403}:
                    response.raise_for_status()
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise ValueError("invalid_payload")
                return payload
        raise RuntimeError("unreachable")
