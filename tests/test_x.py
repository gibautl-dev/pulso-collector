import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from urllib.parse import parse_qs
import httpx
from pulso.config import Settings
from pulso.models import Candidate, FetchResult, SourceConfig, result_status
from pulso.collect_rss import due_for_run, run_exit_code
from pulso.sources.x import (
    XSource, search_query, quota_date, quota_reset_at, post_url,
)

FIXTURES = Path(__file__).parent / "fixtures" / "x"

def load(name):
    return json.loads((FIXTURES / name).read_text())

def candidate():
    return Candidate(
        id=uuid4(), slug="axel-kicillof", name="Axel Kicillof",
        keywords=["Axel Kicillof", "Kicillof", "@Kicillofok"],
        own_accounts={"x": ["Kicillofok"]},
        reference_accounts={"x": ["referenteok"]},
        x_daily_cap=300,
    )

def config(candidate_id, **updates):
    values = dict(
        candidate_id=candidate_id, source="x", enabled=True,
        interval_seconds=3600, settings={}, cursor={},
    )
    values.update(updates)
    return SourceConfig(**values)

def settings():
    return Settings("unused", x_bearer_token="test-token")

def since():
    return datetime(2026, 11, 5, tzinfo=timezone.utc)


class Transport:
    """Responde fixtures según el next_token; no guarda el token en calls."""
    def __init__(self, pages, errors=None):
        self.pages = list(pages)
        self.errors = errors or {}
        self.calls = []
        self.index = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        params = {k: v[0] for k, v in parse_qs(request.url.query.decode()).items()}
        auth = request.headers.get("authorization", "")
        self.calls.append({
            "path": request.url.path,
            "params": params,
            "has_bearer": auth.startswith("Bearer ") and len(auth) > 7,
        })
        if "error" in self.errors:
            status, payload = self.errors["error"]
            return httpx.Response(status, json=payload)
        if self.index >= len(self.pages):
            return httpx.Response(200, json=load("empty.json"))
        payload = self.pages[self.index]
        self.index += 1
        return httpx.Response(200, json=payload)


class XTests(unittest.IsolatedAsyncioTestCase):
    async def fetch_with(self, pages, cand=None, cfg=None, source_settings=None, errors=None):
        cand = cand or candidate()
        cfg = cfg or config(cand.id)
        transport = Transport(pages, errors=errors)
        adapter = XSource(source_settings or settings())
        original = httpx.AsyncClient
        with patch("pulso.sources.x.httpx.AsyncClient", side_effect=lambda *a, **k: original(
                *a, **{**k, "transport": httpx.MockTransport(transport)})):
            result = await adapter.fetch(cand, since(), cfg)
        return result, transport, cand, cfg

    async def test_search_params_and_metrics(self):
        first = load("search.json")
        first["meta"].pop("next_token", None)
        result, transport, cand, _ = await self.fetch_with([first])
        self.assertEqual(result.feeds_ok, 1)
        self.assertEqual(result.errors, [])
        self.assertEqual(len(result.mentions), 2)
        call = transport.calls[0]
        self.assertTrue(call["has_bearer"])
        self.assertEqual(call["path"], "/2/tweets/search/recent")
        self.assertEqual(call["params"]["query"], search_query(cand, {}))
        self.assertIn("start_time", call["params"])
        self.assertNotIn("since_id", call["params"])
        self.assertIn("public_metrics", call["params"]["tweet.fields"])
        self.assertEqual(call["params"]["expansions"], "author_id")
        self.assertIn("public_metrics", call["params"]["user.fields"])
        self.assertIn("verified", call["params"]["user.fields"])
        self.assertIn("created_at", call["params"]["user.fields"])
        high = next(m for m in result.mentions if m.source_item_id == "2000000000000000002")
        self.assertEqual(high.url, post_url("medioejemplo", "2000000000000000002"))
        self.assertEqual(high.account_relation, "third_party")
        self.assertEqual(high.metrics["like_count"], 40)
        self.assertEqual(high.metrics["repost_count"], 12)
        self.assertEqual(high.metrics["reply_count"], 5)
        self.assertEqual(high.metrics["quote_count"], 2)
        self.assertEqual(high.metrics["impression_count"], 9000)
        self.assertEqual(high.metrics["author_followers"], 50000)
        self.assertEqual(high.metrics["author_created_at"], "2012-03-01T00:00:00.000Z")
        self.assertTrue(high.metrics["author_verified"])
        self.assertEqual(high.metrics["author_verified_type"], "blue")
        self.assertFalse(high.metrics["is_reply"])
        own = next(m for m in result.mentions if m.source_item_id == "2000000000000000001")
        self.assertEqual(own.account_relation, "own")
        self.assertEqual(own.author_handle, "Kicillofok")
        self.assertEqual(own.metrics["author_verified_type"], "government")
        self.assertEqual(result.cursor["since_id"], "2000000000000000002")
        self.assertEqual(result.cursor["quota"]["posts"], 2)
        self.assertEqual(result.cursor["quota"]["requests"], 1)
        dumped = str(result.model_dump())
        self.assertNotIn("test-token", dumped)

    async def test_uses_since_id_and_paginates_until_run_cap(self):
        cand = candidate()
        result, transport, _, _ = await self.fetch_with(
            [load("search.json"), load("search_page2.json")],
            cand=cand,
            cfg=config(
                cand.id,
                settings={"max_posts_per_run": 3, "max_posts_per_day": 300},
                cursor={"since_id": "1999999999999999997"},
            ),
        )
        self.assertEqual(len(transport.calls), 2)
        self.assertEqual(transport.calls[0]["params"]["since_id"], "1999999999999999997")
        self.assertNotIn("start_time", transport.calls[0]["params"])
        self.assertEqual(transport.calls[1]["params"]["next_token"], "next-page-token")
        self.assertNotIn("since_id", transport.calls[1]["params"])
        ids = [m.source_item_id for m in result.mentions]
        self.assertEqual(ids, ["2000000000000000002", "2000000000000000001", "1999999999999999998"])
        reply = next(m for m in result.mentions if m.source_item_id == "1999999999999999998")
        self.assertTrue(reply.metrics["is_reply"])
        self.assertEqual(reply.account_relation, "reference")
        self.assertNotIn("1999999999999999997", ids)
        self.assertEqual(result.cursor["since_id"], "2000000000000000002")
        self.assertEqual(result.cursor["quota"]["posts"], 4)
        self.assertEqual(result.cursor["quota"]["requests"], 2)

    async def test_query_excludes_retweets_and_replies_by_default(self):
        cand = candidate()
        self.assertEqual(
            search_query(cand, {}),
            '("Axel Kicillof" OR Kicillof OR @Kicillofok) lang:es -is:retweet -is:reply',
        )
        self.assertEqual(
            search_query(cand, {"exclude_retweets": False, "exclude_replies": False}),
            '("Axel Kicillof" OR Kicillof OR @Kicillofok) lang:es',
        )
        result, transport, _, _ = await self.fetch_with([load("empty.json")], cand=cand)
        self.assertEqual(result.feeds_ok, 1)
        self.assertEqual(result.mentions, [])
        self.assertEqual(transport.calls[0]["params"]["query"], search_query(cand, {}))

    async def test_missing_token_is_soft_failure(self):
        result, transport, _, _ = await self.fetch_with(
            [load("search.json")],
            source_settings=Settings("unused", x_bearer_token=None),
        )
        self.assertEqual(result.errors, ["missing_bearer_token"])
        self.assertTrue(result.soft_failure)
        self.assertEqual(result.feeds_ok, 0)
        self.assertEqual(transport.calls, [])
        self.assertEqual(result_status(result), "partial")

    async def test_unauthorized_is_soft_failure(self):
        result, transport, _, _ = await self.fetch_with(
            [], errors={"error": (401, load("unauthorized.json"))},
        )
        self.assertTrue(result.soft_failure)
        self.assertEqual(result.feeds_ok, 0)
        self.assertEqual(result_status(result), "partial")
        self.assertTrue(any("401" in e for e in result.errors))
        self.assertEqual(len(transport.calls), 1)

    async def test_rate_limit_is_soft_failure(self):
        result, _, _, _ = await self.fetch_with(
            [], errors={"error": (429, load("rate_limited.json"))},
        )
        self.assertTrue(result.soft_failure)
        self.assertEqual(result.feeds_ok, 0)
        self.assertEqual(result_status(result), "partial")
        self.assertTrue(result.errors)

    async def test_daily_post_cap_skips_http(self):
        cand = candidate()
        today = quota_date(datetime.now(timezone.utc))
        result, transport, _, _ = await self.fetch_with(
            [load("search.json")],
            cand=cand,
            cfg=config(cand.id, settings={"max_posts_per_day": 10}, cursor={"quota": {
                "date": today, "posts": 10, "requests": 1, "backoff_until": None,
            }}),
        )
        self.assertEqual(result.errors, ["daily_quota_cap"])
        self.assertEqual(transport.calls, [])
        self.assertTrue(result.soft_failure)

    async def test_daily_request_cap_skips_http(self):
        cand = candidate()
        today = quota_date(datetime.now(timezone.utc))
        result, transport, _, _ = await self.fetch_with(
            [load("search.json")],
            cand=cand,
            cfg=config(cand.id, settings={"max_requests_per_day": 2}, cursor={"quota": {
                "date": today, "posts": 0, "requests": 2, "backoff_until": None,
            }}),
        )
        self.assertEqual(result.errors, ["daily_quota_cap"])
        self.assertEqual(transport.calls, [])
        self.assertTrue(result.soft_failure)

    async def test_backoff_skips_http(self):
        cand = candidate()
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        result, transport, _, _ = await self.fetch_with(
            [load("search.json")],
            cand=cand,
            cfg=config(cand.id, cursor={"quota": {
                "date": quota_date(datetime.now(timezone.utc)),
                "posts": 1, "requests": 1, "backoff_until": future,
            }}),
        )
        self.assertEqual(result.errors, ["quota_backoff"])
        self.assertEqual(transport.calls, [])
        self.assertTrue(result.soft_failure)

    async def test_quota_resets_on_new_utc_day(self):
        cand = candidate()
        result, transport, _, _ = await self.fetch_with(
            [load("empty.json")],
            cand=cand,
            cfg=config(cand.id, cursor={"quota": {
                "date": "2020-01-01", "posts": 300, "requests": 10, "backoff_until": None,
            }}),
        )
        self.assertEqual(result.feeds_ok, 1)
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(result.cursor["quota"]["date"], quota_date(datetime.now(timezone.utc)))
        self.assertEqual(result.cursor["quota"]["posts"], 0)
        self.assertEqual(result.cursor["quota"]["requests"], 1)

    async def test_settings_hides_token_in_repr(self):
        text = repr(Settings("unused", x_bearer_token="super-secret-token"))
        self.assertNotIn("super-secret-token", text)

    async def test_skips_posts_older_than_since(self):
        payload = load("search.json")
        payload["data"][0]["created_at"] = "2026-11-01T00:00:00.000Z"
        result, _, _, _ = await self.fetch_with([payload])
        ids = [m.source_item_id for m in result.mentions]
        self.assertEqual(ids, ["2000000000000000001"])
        self.assertEqual(result.cursor["quota"]["posts"], 2)
        self.assertEqual(result.cursor["since_id"], "2000000000000000002")


class ScheduleAndExitTests(unittest.TestCase):
    def test_x_respects_next_run_at(self):
        now = datetime(2026, 11, 12, 20, 20, tzinfo=timezone.utc)
        cfg = config(uuid4(), next_run_at=now + timedelta(minutes=40))
        self.assertFalse(due_for_run(cfg, now))
        self.assertTrue(due_for_run(cfg, now, refresh=True))
        self.assertTrue(due_for_run(cfg, now + timedelta(hours=1)))
        self.assertTrue(due_for_run(config(uuid4(), next_run_at=None), now))

    def test_x_soft_failure_does_not_fail_the_cron(self):
        rss_ok = FetchResult(feeds_ok=10, feeds_total=10)
        x = FetchResult(errors=["missing_bearer_token"], feeds_ok=0, feeds_total=1, soft_failure=True)
        self.assertEqual(run_exit_code([rss_ok, x]), 0)
        self.assertEqual(result_status(x), "partial")
        hard = FetchResult(errors=["feed_0: X"], feeds_ok=0, feeds_total=1)
        self.assertEqual(run_exit_code([rss_ok, hard]), 1)

    def test_quota_date_is_utc(self):
        now = datetime(2026, 11, 12, 23, 30, tzinfo=timezone.utc)
        self.assertEqual(quota_date(now), "2026-11-12")
        later = datetime(2026, 11, 13, 0, 0, tzinfo=timezone.utc)
        self.assertEqual(quota_date(later), "2026-11-13")
        reset = quota_reset_at(now)
        self.assertEqual(reset, datetime(2026, 11, 13, 0, 0, tzinfo=timezone.utc))
        # 21:30 en Argentina (UTC-3) sigue siendo el 12 UTC.
        ar = datetime(2026, 11, 12, 21, 30, tzinfo=timezone(timedelta(hours=-3)))
        self.assertEqual(quota_date(ar), "2026-11-13")


if __name__ == "__main__":
    unittest.main()
