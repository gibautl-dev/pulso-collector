"""Adaptador de YouTube Data API v3. La clave y la cuota quedan solo en el servidor."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
import httpx
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_exponential

from .base import Source
from .rss_media import Retryable, matches
from ..config import Settings
from ..models import Candidate, FetchResult, Mention, SourceConfig, SourceName

API_BASE = "https://www.googleapis.com/youtube/v3"
PACIFIC = ZoneInfo("America/Los_Angeles")
SEARCH_COST = 100
LIST_COST = 1
DEFAULT_MAX_SEARCHES = 20
DEFAULT_MAX_UNITS = 3000
DEFAULT_COMMENT_VIDEOS = 5
DEFAULT_COMMENTS_PER_VIDEO = 20
MAX_RESULTS = 50


class QuotaExceeded(Exception):
    """La API rechazó el pedido por cuota diaria."""


def quota_date(now: datetime) -> str:
    return now.astimezone(PACIFIC).date().isoformat()


def quota_reset_at(now: datetime) -> datetime:
    local = now.astimezone(PACIFIC)
    nxt = datetime.combine(local.date() + timedelta(days=1), datetime.min.time(), tzinfo=PACIFIC)
    return nxt.astimezone(timezone.utc)


def search_query(candidate: Candidate) -> str:
    return " OR ".join('"' + k.replace('"', "") + '"' for k in candidate.keywords)


def video_url(video_id: str) -> str:
    return "https://www.youtube.com/watch?" + urlencode({"v": video_id})


def comment_url(video_id: str, comment_id: str) -> str:
    return "https://www.youtube.com/watch?" + urlencode({"v": video_id, "lc": comment_id})


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


def _error_reason(payload: dict) -> str:
    error = payload.get("error") or {}
    for item in error.get("errors") or ():
        reason = item.get("reason")
        if reason:
            return str(reason)
    status = error.get("status") or error.get("message") or "api_error"
    return str(status)


def _as_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_published(value: str) -> datetime:
    text = (value or "").replace("Z", "+00:00")
    published = datetime.fromisoformat(text)
    if published.tzinfo is None:
        raise ValueError("publishedAt sin zona")
    return published.astimezone(timezone.utc)


class YouTubeSource(Source):
    def __init__(self, settings: Settings):
        self.settings = settings

    async def fetch(self, candidate: Candidate, since: datetime, config: SourceConfig) -> FetchResult:
        result = FetchResult(feeds_total=1, cursor=dict(config.cursor), soft_failure=False)
        cursor = dict(config.cursor)
        quota = self._quota_state(cursor, datetime.now(timezone.utc))
        cursor["quota"] = quota
        result.cursor = cursor

        if not self.settings.youtube_api_key:
            result.errors.append("missing_api_key")
            result.soft_failure = True
            return result

        now = datetime.now(timezone.utc)
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
                headers={"User-Agent": self.settings.user_agent},
            ) as client:
                await self._collect(client, candidate, since, config, result, cursor, quota, now)
        except QuotaExceeded:
            quota["backoff_until"] = quota_reset_at(now).isoformat()
            cursor["quota"] = quota
            result.cursor = cursor
            result.errors.append("quotaExceeded")
            result.soft_failure = True
        except Exception as exc:
            result.errors.append(type(exc).__name__)
            result.soft_failure = True
        return result

    def _quota_state(self, cursor: dict, now: datetime) -> dict:
        today = quota_date(now)
        raw = dict(cursor.get("quota") or {})
        if raw.get("date") != today:
            return {"date": today, "searches": 0, "units": 0, "backoff_until": None}
        return {
            "date": today,
            "searches": int(raw.get("searches") or 0),
            "units": int(raw.get("units") or 0),
            "backoff_until": raw.get("backoff_until"),
        }

    def _caps(self, config: SourceConfig) -> tuple[int, int, bool, int, int]:
        settings = config.settings or {}
        return (
            _int_setting(settings, "max_searches_per_day", DEFAULT_MAX_SEARCHES, low=1, high=100),
            _int_setting(settings, "max_units_per_day", DEFAULT_MAX_UNITS, low=SEARCH_COST, high=10_000),
            _bool_setting(settings, "collect_comments", True),
            _int_setting(settings, "max_comment_videos", DEFAULT_COMMENT_VIDEOS, low=0, high=50),
            _int_setting(settings, "max_comments_per_video", DEFAULT_COMMENTS_PER_VIDEO, low=1, high=100),
        )

    def _can_spend(self, quota: dict, cost: int, searches: int, max_searches: int, max_units: int) -> bool:
        if quota["searches"] + searches > max_searches:
            return False
        if quota["units"] + cost > max_units:
            return False
        return True

    def _spend(self, quota: dict, *, units: int = 0, searches: int = 0) -> None:
        quota["searches"] = int(quota.get("searches") or 0) + searches
        quota["units"] = int(quota.get("units") or 0) + units

    async def _collect(self, client, candidate, since, config, result, cursor, quota, now):
        max_searches, max_units, collect_comments, max_comment_videos, max_comments = self._caps(config)
        if not self._can_spend(quota, SEARCH_COST, 1, max_searches, max_units):
            result.errors.append("daily_quota_cap")
            result.soft_failure = True
            return

        published_after = cursor.get("published_after") or (now - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
        data = await self._request(client, "search", {
            "part": "snippet",
            "type": "video",
            "q": search_query(candidate),
            "regionCode": "AR",
            "relevanceLanguage": "es",
            "order": "date",
            "publishedAfter": published_after,
            "maxResults": MAX_RESULTS,
        })
        self._spend(quota, units=SEARCH_COST, searches=1)
        cursor["quota"] = quota
        result.cursor = cursor
        result.feeds_ok = 1

        items = [item for item in data.get("items") or [] if (item.get("id") or {}).get("videoId")]
        video_ids = [item["id"]["videoId"] for item in items]
        stats = await self._video_stats(client, video_ids, quota, max_searches, max_units, result, cursor)

        mentions = []
        latest = None
        for item in items:
            video_id = item["id"]["videoId"]
            snippet = item.get("snippet") or {}
            try:
                published = _parse_published(snippet.get("publishedAt", ""))
            except (ValueError, TypeError):
                result.skipped_entries += 1
                continue
            if published < since:
                continue
            latest = published if latest is None or published > latest else latest
            info = stats.get(video_id) or {}
            channel_id = snippet.get("channelId") or info.get("channel_id")
            channel_title = snippet.get("channelTitle") or info.get("channel_title")
            mentions.append(Mention(
                candidate_id=candidate.id,
                source=SourceName.YOUTUBE,
                source_item_id=video_id,
                url=video_url(video_id),
                title=snippet.get("title") or "",
                content=snippet.get("description") or "",
                author=channel_title or None,
                author_handle=channel_id or None,
                outlet=channel_title or "YouTube",
                published_at=published,
                metrics={k: v for k, v in {
                    "view_count": info.get("view_count"),
                    "like_count": info.get("like_count"),
                    "comment_count": info.get("comment_count"),
                }.items() if v is not None},
                lang=info.get("lang"),
                account_relation=_channel_relation(channel_id, candidate, config),
            ))

        if latest:
            cursor["published_after"] = latest.strftime("%Y-%m-%dT%H:%M:%SZ")
        result.cursor = cursor

        if collect_comments and max_comment_videos and mentions:
            ranked = sorted(mentions, key=lambda m: int((m.metrics or {}).get("view_count") or 0), reverse=True)
            for video in ranked[:max_comment_videos]:
                comments = await self._comments(
                    client, video, candidate, since, config, quota,
                    max_searches, max_units, max_comments, result, cursor,
                )
                mentions.extend(comments)

        result.mentions = mentions
        cursor["quota"] = quota
        result.cursor = cursor

    async def _video_stats(self, client, video_ids, quota, max_searches, max_units, result, cursor):
        stats = {}
        if not video_ids:
            return stats
        if not self._can_spend(quota, LIST_COST, 0, max_searches, max_units):
            result.errors.append("daily_quota_cap")
            return stats
        try:
            data = await self._request(client, "videos", {
                "part": "statistics,snippet",
                "id": ",".join(video_ids[:MAX_RESULTS]),
            })
        except QuotaExceeded:
            raise
        except Exception as exc:
            result.errors.append(f"videos_list:{type(exc).__name__}")
            return stats
        self._spend(quota, units=LIST_COST)
        cursor["quota"] = quota
        for item in data.get("items") or []:
            video_id = item.get("id")
            if not video_id:
                continue
            statistics = item.get("statistics") or {}
            snippet = item.get("snippet") or {}
            stats[video_id] = {
                "view_count": _as_int(statistics.get("viewCount")),
                "like_count": _as_int(statistics.get("likeCount")),
                "comment_count": _as_int(statistics.get("commentCount")),
                "channel_id": snippet.get("channelId"),
                "channel_title": snippet.get("channelTitle"),
                "lang": snippet.get("defaultAudioLanguage") or snippet.get("defaultLanguage"),
            }
        return stats

    async def _comments(self, client, video, candidate, since, config, quota,
                        max_searches, max_units, max_comments, result, cursor):
        if not self._can_spend(quota, LIST_COST, 0, max_searches, max_units):
            result.errors.append("daily_quota_cap")
            return []
        try:
            data = await self._request(client, "commentThreads", {
                "part": "snippet",
                "videoId": video.source_item_id,
                "order": "relevance",
                "textFormat": "plainText",
                "maxResults": max_comments,
            })
        except QuotaExceeded:
            raise
        except httpx.HTTPStatusError as exc:
            # 403 commentsDisabled u otros 4xx de un video no deben cortar la corrida.
            reason = "HTTPStatusError"
            try:
                reason = _error_reason(exc.response.json())
            except Exception:
                pass
            if reason not in {"commentsDisabled", "forbidden", "videoNotFound"}:
                result.errors.append(f"commentThreads:{reason}")
            return []
        except Exception as exc:
            result.errors.append(f"commentThreads:{type(exc).__name__}")
            return []
        self._spend(quota, units=LIST_COST)
        cursor["quota"] = quota
        found = []
        for item in data.get("items") or []:
            top = (item.get("snippet") or {}).get("topLevelComment") or {}
            snippet = top.get("snippet") or {}
            comment_id = top.get("id") or item.get("id")
            text = snippet.get("textDisplay") or snippet.get("textOriginal") or ""
            if not comment_id or not matches(text, candidate):
                continue
            try:
                published = _parse_published(snippet.get("publishedAt", ""))
            except (ValueError, TypeError):
                result.skipped_entries += 1
                continue
            if published < since:
                continue
            channel_id = (snippet.get("authorChannelId") or {}).get("value")
            found.append(Mention(
                candidate_id=candidate.id,
                source=SourceName.YOUTUBE,
                source_item_id=comment_id,
                url=comment_url(video.source_item_id, comment_id),
                title=text,
                content=text,
                author=snippet.get("authorDisplayName") or None,
                author_handle=channel_id or None,
                outlet=video.outlet,
                published_at=published,
                metrics={k: v for k, v in {
                    "like_count": _as_int(snippet.get("likeCount")),
                    "reply_count": _as_int((item.get("snippet") or {}).get("totalReplyCount")),
                    "video_id": video.source_item_id,
                }.items() if v is not None},
                account_relation=_channel_relation(channel_id, candidate, config),
            ))
        return found

    async def _request(self, client: httpx.AsyncClient, resource: str, params: dict) -> dict:
        url = f"{API_BASE}/{resource}"
        query = dict(params)
        query["key"] = self.settings.youtube_api_key
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=2, max=8),
            retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError, Retryable)),
            reraise=True,
        ):
            with attempt:
                response = await client.get(url, params=query)
                if response.status_code == 429 or response.status_code >= 500:
                    raise Retryable("upstream")
                payload = {}
                try:
                    payload = response.json()
                except Exception:
                    payload = {}
                reason = _error_reason(payload) if payload else ""
                if response.status_code == 403 and reason in {"quotaExceeded", "dailyLimitExceeded"}:
                    raise QuotaExceeded()
                response.raise_for_status()
                if not isinstance(payload, dict):
                    raise ValueError("invalid_payload")
                return payload
        raise RuntimeError("unreachable")


def _channel_ids(value) -> list[str]:
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    if isinstance(value, list):
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]
    return []


def _channel_relation(channel_id: str | None, candidate: Candidate, config: SourceConfig) -> str:
    if not channel_id:
        return "third_party"
    own = set(_channel_ids(config.settings.get("own_channel_ids")))
    own.update(_channel_ids((candidate.own_accounts or {}).get("youtube")))
    reference = set(_channel_ids(config.settings.get("reference_channel_ids")))
    reference.update(_channel_ids((candidate.reference_accounts or {}).get("youtube")))
    if channel_id in own:
        return "own"
    if channel_id in reference:
        return "reference"
    return "third_party"
