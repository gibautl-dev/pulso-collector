import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from urllib.parse import parse_qs
import httpx
from pulso.config import Settings
from pulso.models import Candidate, FetchResult, SourceConfig, result_status
from pulso.collect_rss import due_for_run, run_exit_code
from pulso.sources.youtube import (
    YouTubeSource, search_query, quota_date, quota_reset_at, comment_url,
)

FIXTURES = Path(__file__).parent / "fixtures" / "youtube"

def load(name):
    return json.loads((FIXTURES / name).read_text())

def candidate():
    return Candidate(
        id=uuid4(), slug="axel-kicillof", name="Axel Kicillof",
        keywords=["Axel Kicillof", "Kicillof"],
        own_accounts={"youtube": ["UCown"]},
    )

def config(candidate_id, **updates):
    values = dict(
        candidate_id=candidate_id, source="youtube", enabled=True,
        interval_seconds=3600, settings={}, cursor={},
    )
    values.update(updates)
    return SourceConfig(**values)

def settings():
    return Settings("unused", youtube_api_key="test-key")

def since():
    return datetime(2026, 11, 5, tzinfo=timezone.utc)

class Transport:
    """Responde fixtures según el path; registra pedidos sin devolver la key."""
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.rsplit("/", 1)[-1]
        params = {k: v[0] for k, v in parse_qs(request.url.query.decode()).items()}
        recorded = dict(params)
        recorded.pop("key", None)
        self.calls.append({"resource": path, "params": recorded, "has_key": "key" in params})
        item = self.responses.get(path)
        if item is None:
            if path == "commentThreads":
                return httpx.Response(200, json={"items": []})
            return httpx.Response(404, json={"error": {"errors": [{"reason": "notFound"}]}})
        status, payload = item
        if path == "commentThreads" and params.get("videoId") not in {None, "vidOldViews"}:
            return httpx.Response(200, json={"items": []})
        return httpx.Response(status, json=payload)


class YouTubeTests(unittest.IsolatedAsyncioTestCase):
    async def fetch_with(self, responses, cand=None, cfg=None, source_settings=None):
        cand = cand or candidate()
        cfg = cfg or config(cand.id)
        transport = Transport(responses)
        adapter = YouTubeSource(source_settings or settings())
        original = httpx.AsyncClient

        def factory(*args, **kwargs):
            kwargs = dict(kwargs)
            kwargs["transport"] = httpx.MockTransport(transport)
            kwargs.pop("trust_env", None)
            return original(*args, **kwargs)

        # httpx.AsyncClient signature keeps trust_env; passing transport is enough.
        from unittest.mock import patch
        with patch("pulso.sources.youtube.httpx.AsyncClient", side_effect=lambda *a, **k: original(
                *a, **{**k, "transport": httpx.MockTransport(transport)})):
            result = await adapter.fetch(cand, since(), cfg)
        return result, transport, cand, cfg

    async def test_search_params_and_video_mentions(self):
        result, transport, cand, _ = await self.fetch_with({
            "search": (200, load("search.json")),
            "videos": (200, load("videos.json")),
            "commentThreads": (200, load("comments.json")),
        })
        self.assertEqual(result.feeds_ok, 1)
        self.assertEqual(result.errors, [])
        search = next(c for c in transport.calls if c["resource"] == "search")
        self.assertTrue(search["has_key"])
        self.assertEqual(search["params"]["regionCode"], "AR")
        self.assertEqual(search["params"]["relevanceLanguage"], "es")
        self.assertEqual(search["params"]["order"], "date")
        self.assertEqual(search["params"]["type"], "video")
        self.assertIn("publishedAfter", search["params"])
        self.assertEqual(search["params"]["q"], search_query(cand))
        videos = [m for m in result.mentions if m.source_item_id in {"vidNew", "vidOldViews"}]
        self.assertEqual(len(videos), 2)
        high = next(m for m in videos if m.source_item_id == "vidOldViews")
        self.assertEqual(high.url, "https://www.youtube.com/watch?v=vidOldViews")
        self.assertEqual(high.metrics["view_count"], 90000)
        self.assertEqual(high.metrics["like_count"], 4000)
        self.assertEqual(high.metrics["comment_count"], 320)
        self.assertEqual(high.account_relation, "own")
        self.assertEqual(high.outlet, "Canal Oficial")
        self.assertEqual(high.lang, "es-419")
        news = next(m for m in videos if m.source_item_id == "vidNew")
        self.assertEqual(news.account_relation, "third_party")
        self.assertEqual(news.metrics["view_count"], 1500)
        self.assertEqual(result.cursor["quota"]["searches"], 1)
        self.assertEqual(result.cursor["quota"]["units"], 100 + 1 + 2)
        self.assertEqual(result.cursor["published_after"], "2026-11-12T15:00:00Z")

    async def test_comments_only_when_they_mention_the_candidate(self):
        result, transport, _, _ = await self.fetch_with({
            "search": (200, load("search.json")),
            "videos": (200, load("videos.json")),
            "commentThreads": (200, load("comments.json")),
        })
        comments = [m for m in result.mentions if m.source_item_id == "commentHit"]
        missed = [m for m in result.mentions if m.source_item_id == "commentMiss"]
        self.assertEqual(len(comments), 1)
        self.assertEqual(missed, [])
        comment = comments[0]
        self.assertEqual(comment.url, comment_url("vidOldViews", "commentHit"))
        self.assertIn("Kicillof", comment.title)
        self.assertEqual(comment.metrics["video_id"], "vidOldViews")
        self.assertEqual(comment.author, "@vecino")
        # El de más vistas se pide primero.
        comment_calls = [c for c in transport.calls if c["resource"] == "commentThreads"]
        self.assertEqual(comment_calls[0]["params"]["videoId"], "vidOldViews")
        self.assertEqual(comment_calls[0]["params"]["order"], "relevance")

    async def test_comments_disabled_by_settings(self):
        cand = candidate()
        result, transport, _, _ = await self.fetch_with({
            "search": (200, load("search.json")),
            "videos": (200, load("videos.json")),
        }, cand=cand, cfg=config(cand.id, settings={"collect_comments": False}))
        self.assertEqual({m.source_item_id for m in result.mentions}, {"vidNew", "vidOldViews"})
        self.assertFalse(any(c["resource"] == "commentThreads" for c in transport.calls))
        self.assertEqual(result.cursor["quota"]["units"], 101)

    async def test_default_published_after_is_24h(self):
        empty = {"kind": "youtube#searchListResponse", "items": []}
        before = datetime.now(timezone.utc)
        result, transport, _, _ = await self.fetch_with({"search": (200, empty)})
        after = datetime.now(timezone.utc)
        published = transport.calls[0]["params"]["publishedAfter"]
        stamp = datetime.strptime(published, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        self.assertLess(before - timedelta(hours=24, seconds=5), stamp)
        self.assertLess(stamp, after - timedelta(hours=23, minutes=59))
        self.assertEqual(result.mentions, [])
        self.assertEqual(result.feeds_ok, 1)

    async def test_uses_cursor_published_after(self):
        empty = {"kind": "youtube#searchListResponse", "items": []}
        cand = candidate()
        _, transport, _, _ = await self.fetch_with(
            {"search": (200, empty)},
            cand=cand,
            cfg=config(cand.id, cursor={"published_after": "2026-11-12T08:00:00Z"}),
        )
        self.assertEqual(transport.calls[0]["params"]["publishedAfter"], "2026-11-12T08:00:00Z")

    async def test_missing_api_key_is_soft_failure(self):
        result, transport, _, _ = await self.fetch_with(
            {"search": (200, load("search.json"))},
            source_settings=Settings("unused", youtube_api_key=None),
        )
        self.assertEqual(result.errors, ["missing_api_key"])
        self.assertTrue(result.soft_failure)
        self.assertEqual(result.feeds_ok, 0)
        self.assertEqual(transport.calls, [])
        self.assertEqual(result_status(result), "partial")
        self.assertNotIn("test-key", str(result.model_dump()))

    async def test_quota_exceeded_sets_backoff(self):
        result, transport, _, _ = await self.fetch_with({
            "search": (403, load("quota_exceeded.json")),
        })
        self.assertIn("quotaExceeded", result.errors)
        self.assertTrue(result.soft_failure)
        self.assertEqual(result.feeds_ok, 0)
        self.assertEqual(result_status(result), "partial")
        until = datetime.fromisoformat(result.cursor["quota"]["backoff_until"])
        self.assertGreater(until, datetime.now(timezone.utc))
        self.assertEqual(transport.calls[0]["resource"], "search")

    async def test_backoff_skips_http(self):
        cand = candidate()
        future = (datetime.now(timezone.utc) + timedelta(hours=6)).isoformat()
        result, transport, _, _ = await self.fetch_with(
            {"search": (200, load("search.json"))},
            cand=cand,
            cfg=config(cand.id, cursor={"quota": {
                "date": quota_date(datetime.now(timezone.utc)),
                "searches": 3, "units": 300, "backoff_until": future,
            }}),
        )
        self.assertEqual(result.errors, ["quota_backoff"])
        self.assertEqual(transport.calls, [])
        self.assertTrue(result.soft_failure)

    async def test_daily_search_cap(self):
        cand = candidate()
        today = quota_date(datetime.now(timezone.utc))
        result, transport, _, _ = await self.fetch_with(
            {"search": (200, load("search.json"))},
            cand=cand,
            cfg=config(cand.id, settings={"max_searches_per_day": 2}, cursor={"quota": {
                "date": today, "searches": 2, "units": 200, "backoff_until": None,
            }}),
        )
        self.assertEqual(result.errors, ["daily_quota_cap"])
        self.assertEqual(transport.calls, [])
        self.assertTrue(result.soft_failure)

    async def test_settings_hides_key_in_repr(self):
        text = repr(Settings("unused", youtube_api_key="super-secret-key"))
        self.assertNotIn("super-secret-key", text)


class ScheduleAndExitTests(unittest.TestCase):
    def test_youtube_respects_next_run_at(self):
        now = datetime(2026, 11, 12, 20, 20, tzinfo=timezone.utc)
        cfg = config(uuid4(), next_run_at=now + timedelta(minutes=40))
        self.assertFalse(due_for_run(cfg, now))
        self.assertTrue(due_for_run(cfg, now, refresh=True))
        self.assertTrue(due_for_run(cfg, now + timedelta(hours=1)))
        self.assertTrue(due_for_run(config(uuid4(), next_run_at=None), now))

    def test_rss_and_news_are_not_skipped_by_next_run_at(self):
        now = datetime(2026, 11, 12, 20, 20, tzinfo=timezone.utc)
        for source in ("rss_media", "google_news"):
            cfg = SourceConfig(
                candidate_id=uuid4(), source=source, enabled=True,
                interval_seconds=1200, next_run_at=now + timedelta(seconds=40),
            )
            self.assertTrue(due_for_run(cfg, now))

    def test_youtube_soft_failure_does_not_fail_the_cron(self):
        rss_ok = FetchResult(feeds_ok=10, feeds_total=10)
        yt = FetchResult(errors=["quotaExceeded"], feeds_ok=0, feeds_total=1, soft_failure=True)
        self.assertEqual(run_exit_code([rss_ok, yt]), 0)
        self.assertEqual(result_status(yt), "partial")
        hard = FetchResult(errors=["feed_0: X"], feeds_ok=0, feeds_total=1)
        self.assertEqual(run_exit_code([rss_ok, hard]), 1)

    def test_quota_date_is_pacific(self):
        # 23:30 UTC del 12/11 es 15:30 PT; sigue siendo el 12.
        now = datetime(2026, 11, 12, 23, 30, tzinfo=timezone.utc)
        self.assertEqual(quota_date(now), "2026-11-12")
        # 8:00 UTC del 13/11 es 00:00 PT del 13.
        later = datetime(2026, 11, 13, 8, 0, tzinfo=timezone.utc)
        self.assertEqual(quota_date(later), "2026-11-13")
        reset = quota_reset_at(now)
        self.assertEqual(quota_date(reset), "2026-11-13")
        self.assertEqual(reset, datetime(2026, 11, 13, 8, 0, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
