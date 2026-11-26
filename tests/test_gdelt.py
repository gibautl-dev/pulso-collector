import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4
from unittest.mock import patch
import httpx

from pulso.collect_rss import adapter_for, due_for_run, INTERVAL_SOURCES
from pulso.config import Settings
from pulso.models import Candidate, SourceConfig, SourceName
from tenacity import wait_none
from pulso.sources.gdelt import (
    ATTRIBUTION_URL,
    DOC_API,
    GdeltSource,
    build_query,
    parse_seendate,
    reset_throttle,
    source_country_for,
    timespan_for,
    is_transient_gdelt_error,
    wait_for_slot,
    Retryable,
    gdelt_slot_minute,
    gdelt_slot_matches,
    next_gdelt_run_at,
    MIN_INTERVAL,
    SLOT_MINUTES,
)
from pulso.urls import url_hash

FIXTURES = Path(__file__).parent / "fixtures" / "gdelt"


def candidate(**updates):
    values = dict(
        id=uuid4(), slug="axel-kicillof", name="Axel Kicillof",
        keywords=["Axel Kicillof", "Kicillof", "@Kicillofok"],
        exclude_keywords=[],
    )
    values.update(updates)
    return Candidate(**values)


def config(candidate_id, **updates):
    values = dict(
        candidate_id=candidate_id, source="gdelt", enabled=True,
        interval_seconds=1200, settings={"sourcecountry": "AR"}, cursor={},
    )
    values.update(updates)
    return SourceConfig(**values)


def settings():
    return Settings("unused", user_agent="PulsoCollector/0.3 (+https://pulso-web-re4x.onrender.com)")


class QueryTests(unittest.TestCase):
    def test_source_country_from_region_and_override(self):
        self.assertEqual(source_country_for("axel-kicillof"), "AR")
        self.assertEqual(source_country_for("milei"), "AR")
        self.assertEqual(source_country_for("pedro-sanchez"), "ES")
        self.assertEqual(source_country_for("pedro-sanchez", {"sourcecountry": "SP"}), "SP")

    def test_query_strips_handles_and_adds_country_and_exclusions(self):
        c = candidate()
        q = build_query(c, "AR")
        self.assertIn('"Axel Kicillof"', q)
        self.assertIn('"Kicillof"', q)
        self.assertIn('"Kicillofok"', q)
        self.assertNotIn("@", q)
        self.assertIn("sourcecountry:AR", q)
        s = candidate(slug="pedro-sanchez", name="Pedro Sánchez",
                      keywords=["Pedro Sánchez", "Sánchez"],
                      exclude_keywords=["Alexis Sánchez", "Hugo Sánchez"])
        q2 = build_query(s, "ES")
        self.assertIn("sourcecountry:ES", q2)
        self.assertIn('-"Alexis Sánchez"', q2)

    def test_timespan_caps_at_three_months(self):
        now = datetime(2026, 11, 25, tzinfo=timezone.utc)
        self.assertEqual(timespan_for(now - timedelta(days=7), now), "7d")
        self.assertEqual(timespan_for(now - timedelta(hours=6), now), "6h")
        self.assertEqual(timespan_for(now - timedelta(days=120), now), "3m")

    def test_seendate(self):
        self.assertEqual(
            parse_seendate("20261124T150000Z"),
            datetime(2026, 11, 24, 15, 0, tzinfo=timezone.utc),
        )
        self.assertIsNone(parse_seendate(""))
        self.assertIsNone(parse_seendate("nope"))

    def test_adapter_registration(self):
        self.assertIsInstance(adapter_for(SourceName.GDELT, settings()), GdeltSource)

    def test_transient_error_helper(self):
        self.assertTrue(is_transient_gdelt_error(Retryable("rate_limited", status=429)))
        self.assertTrue(is_transient_gdelt_error(Retryable("upstream_5xx", status=502)))
        self.assertTrue(is_transient_gdelt_error(httpx.ConnectTimeout("timed out")))
        self.assertTrue(is_transient_gdelt_error(httpx.ReadTimeout("timed out")))
        self.assertTrue(is_transient_gdelt_error(httpx.ConnectError("connection refused")))
        self.assertFalse(is_transient_gdelt_error(ValueError("gdelt_query_vacia")))
        self.assertFalse(is_transient_gdelt_error(Retryable("other")))

    def test_attribution_url(self):
        self.assertEqual(ATTRIBUTION_URL, "https://www.gdeltproject.org/")
        self.assertTrue(DOC_API.startswith("https://api.gdeltproject.org/"))


class ThrottleTests(unittest.IsolatedAsyncioTestCase):
    async def test_waits_between_requests(self):
        reset_throttle()
        slept = []

        async def fake_sleep(seconds):
            slept.append(seconds)

        clock_values = iter([10.0, 12.0])

        def clock():
            return next(clock_values)

        await wait_for_slot(min_seconds=5, sleeper=fake_sleep, clock=clock, path="")
        self.assertEqual(slept, [])
        await wait_for_slot(min_seconds=5, sleeper=fake_sleep, clock=clock, path="")
        self.assertEqual(slept, [3.0])
        reset_throttle()

    async def test_shared_file_throttles_fresh_process(self):
        """Un segundo proceso (reloj monotónico en 0) respeta el sello wall del archivo."""
        reset_throttle()
        slept = []

        async def fake_sleep(seconds):
            slept.append(seconds)

        with TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "gdelt_stamp")
            Path(path).write_text("100.0\n")
            await wait_for_slot(
                min_seconds=8,
                sleeper=fake_sleep,
                clock=lambda: 0.0,
                wall=lambda: 103.0,
                path=path,
            )
            self.assertEqual(slept, [5.0])
            self.assertEqual(float(Path(path).read_text().strip()), 108.0)
        reset_throttle()


class FetchTests(unittest.IsolatedAsyncioTestCase):
    async def fetch_with(self, responses, cand=None, cfg=None, since=None):
        reset_throttle()
        cand = cand or candidate()
        cfg = cfg or config(cand.id)
        since = since or datetime(2026, 11, 20, tzinfo=timezone.utc)
        payload = responses

        def handler(request: httpx.Request) -> httpx.Response:
            self.calls.append({"url": str(request.url), "ua": request.headers.get("user-agent")})
            if callable(payload):
                return payload(request)
            status, body = payload
            if isinstance(body, bytes):
                return httpx.Response(status, content=body, headers={"content-type": "text/plain"})
            return httpx.Response(status, json=body)

        self.calls = []
        adapter = GdeltSource(settings())
        original = httpx.AsyncClient

        def factory(*args, **kwargs):
            kwargs = dict(kwargs)
            kwargs["transport"] = httpx.MockTransport(handler)
            return original(*args, **kwargs)

        with patch("pulso.sources.gdelt.wait_for_slot", new=self._noop_slot), patch(
            "pulso.sources.gdelt.RETRY_WAIT", wait_none()
        ), patch(
            "pulso.sources.gdelt.httpx.AsyncClient", side_effect=factory
        ):
            return await adapter.fetch(cand, since, cfg)

    async def _noop_slot(self, *args, **kwargs):
        return None

    async def test_filters_duplicates_unrelated_and_dateless(self):
        articles = json.loads((FIXTURES / "articles.json").read_text())
        result = await self.fetch_with((200, articles))
        self.assertEqual(result.feeds_ok, 1)
        self.assertEqual(len(result.mentions), 1)
        mention = result.mentions[0]
        self.assertEqual(mention.url, "https://www.infobae.com/politica/2026/11/24/kicillof-anuncio/")
        self.assertEqual(mention.outlet, "infobae.com")
        self.assertEqual(mention.source, SourceName.GDELT)
        self.assertGreaterEqual(result.skipped_entries, 3)
        self.assertIn("PulsoCollector", self.calls[0]["ua"])
        self.assertIn("pulso-web-re4x.onrender.com", self.calls[0]["ua"])
        self.assertIn("sourcecountry%3AAR", self.calls[0]["url"])

    async def test_known_url_hashes_are_skipped(self):
        articles = json.loads((FIXTURES / "articles.json").read_text())
        cand = candidate()
        digest = url_hash("https://www.infobae.com/politica/2026/11/24/kicillof-anuncio/")
        result = await self.fetch_with(
            (200, articles),
            cand=cand,
            cfg=config(cand.id, settings={"sourcecountry": "AR", "known_url_hashes": [digest]}),
        )
        self.assertEqual(result.mentions, [])

    async def test_spain_query_uses_es(self):
        cand = candidate(
            slug="pedro-sanchez", name="Pedro Sánchez",
            keywords=["Pedro Sánchez"], exclude_keywords=[],
        )
        result = await self.fetch_with(
            (200, {"articles": []}),
            cand=cand,
            cfg=config(cand.id, settings={}),
        )
        self.assertEqual(result.feeds_ok, 1)
        self.assertIn("sourcecountry%3AES", self.calls[0]["url"])

    async def test_429_then_success(self):
        articles = {"articles": []}
        state = {"n": 0}

        def payload(request):
            state["n"] += 1
            if state["n"] == 1:
                return httpx.Response(429, content=b"Please limit requests to one every 5 seconds")
            return httpx.Response(200, json=articles)

        result = await self.fetch_with(payload)
        self.assertEqual(result.feeds_ok, 1)
        self.assertEqual(result.errors, [])
        self.assertEqual(len(self.calls), 2)

    async def test_plain_rate_limit_message(self):
        result = await self.fetch_with((200, b"Please limit requests to one every 5 seconds or contact us"))
        # 200 + text retried then fails as a soft skip (el cron no debe salir 1).
        self.assertTrue(result.errors)
        self.assertEqual(result.feeds_ok, 0)
        self.assertTrue(result.soft_failure)
        self.assertTrue(any("rate_limited" in e for e in result.errors))

    async def test_persistent_429_is_soft_failure(self):
        def payload(request):
            return httpx.Response(429, content=b"Please limit requests to one every 5 seconds")

        result = await self.fetch_with(payload)
        self.assertEqual(result.feeds_ok, 0)
        self.assertEqual(result.mentions, [])
        self.assertTrue(result.soft_failure)
        self.assertTrue(any("429" in e and "rate_limited" in e for e in result.errors))
        self.assertGreaterEqual(len(self.calls), 3)

    async def test_persistent_connect_timeout_is_soft_failure(self):
        def payload(request):
            raise httpx.ConnectTimeout("timed out", request=request)

        result = await self.fetch_with(payload)
        self.assertEqual(result.feeds_ok, 0)
        self.assertEqual(result.mentions, [])
        self.assertTrue(result.soft_failure)
        self.assertTrue(any("ConnectTimeout" in e for e in result.errors))
        self.assertGreaterEqual(len(self.calls), 3)

    async def test_persistent_connect_error_is_soft_failure(self):
        def payload(request):
            raise httpx.ConnectError("connection refused", request=request)

        result = await self.fetch_with(payload)
        self.assertEqual(result.feeds_ok, 0)
        self.assertTrue(result.soft_failure)
        self.assertTrue(any("ConnectError" in e for e in result.errors))

    async def test_persistent_502_is_soft_failure(self):
        def payload(request):
            return httpx.Response(502, content=b"bad gateway")

        result = await self.fetch_with(payload)
        self.assertEqual(result.feeds_ok, 0)
        self.assertTrue(result.soft_failure)
        self.assertTrue(any("upstream_5xx" in e for e in result.errors))
        self.assertGreaterEqual(len(self.calls), 3)

    async def test_invalid_response_is_hard_failure(self):
        result = await self.fetch_with((200, b"not a rate limit and not json"))
        self.assertEqual(result.feeds_ok, 0)
        self.assertFalse(result.soft_failure)
        self.assertTrue(result.errors)


class ScheduleTests(unittest.TestCase):
    def test_known_slugs_use_distinct_hourly_slots(self):
        self.assertEqual(gdelt_slot_minute("axel-kicillof"), 0)
        self.assertEqual(gdelt_slot_minute("pedro-sanchez"), 20)
        self.assertEqual(gdelt_slot_minute("milei"), 40)
        self.assertEqual(set(SLOT_MINUTES), {0, 20, 40})
        self.assertEqual(len({gdelt_slot_minute(s) for s in ("axel-kicillof", "pedro-sanchez", "milei")}), 3)

    def test_unknown_slug_is_stable_and_in_slots(self):
        self.assertEqual(gdelt_slot_minute("otro-candidato"), gdelt_slot_minute("otro-candidato"))
        self.assertIn(gdelt_slot_minute("otro-candidato"), SLOT_MINUTES)

    def test_slot_matches_current_tick(self):
        now = datetime(2026, 11, 26, 2, 0, tzinfo=timezone.utc)
        self.assertTrue(gdelt_slot_matches("axel-kicillof", now))
        self.assertFalse(gdelt_slot_matches("pedro-sanchez", now))
        self.assertFalse(gdelt_slot_matches("milei", now))
        self.assertTrue(gdelt_slot_matches("pedro-sanchez", datetime(2026, 11, 26, 2, 20, tzinfo=timezone.utc)))
        self.assertTrue(gdelt_slot_matches("milei", datetime(2026, 11, 26, 2, 40, 12, tzinfo=timezone.utc)))

    def test_next_run_at_is_at_least_55_minutes_and_on_slot(self):
        now = datetime(2026, 11, 26, 1, 21, tzinfo=timezone.utc)
        # 01:21 + 55m = 02:16; kicillof slot :00 -> 03:00
        k = next_gdelt_run_at("axel-kicillof", now)
        self.assertEqual(k, datetime(2026, 11, 26, 3, 0, tzinfo=timezone.utc))
        self.assertGreaterEqual(k - now, MIN_INTERVAL)
        # sanchez slot :20 -> 02:20 (>= 02:16)
        s = next_gdelt_run_at("pedro-sanchez", now)
        self.assertEqual(s, datetime(2026, 11, 26, 2, 20, tzinfo=timezone.utc))
        self.assertGreaterEqual(s - now, MIN_INTERVAL)
        # milei slot :40 -> 02:40
        m = next_gdelt_run_at("milei", now)
        self.assertEqual(m, datetime(2026, 11, 26, 2, 40, tzinfo=timezone.utc))

    def test_due_for_run_skips_wrong_slot_and_honors_next_run_at(self):
        cid = uuid4()
        now = datetime(2026, 11, 26, 2, 0, tzinfo=timezone.utc)
        due = config(cid, interval_seconds=3300, next_run_at=None)
        self.assertTrue(due_for_run(due, now, slug="axel-kicillof"))
        self.assertFalse(due_for_run(due, now, slug="milei"))
        self.assertTrue(due_for_run(due, now, refresh=True, slug="milei"))
        future = config(cid, interval_seconds=3300, next_run_at=now + timedelta(minutes=30))
        self.assertFalse(due_for_run(future, now, slug="axel-kicillof"))
        past = config(cid, interval_seconds=3300, next_run_at=now - timedelta(minutes=1))
        self.assertTrue(due_for_run(past, now, slug="axel-kicillof"))
        self.assertFalse(due_for_run(past, now, slug="pedro-sanchez"))

    def test_gdelt_is_interval_source_rss_is_not(self):
        self.assertIn(SourceName.GDELT, INTERVAL_SOURCES)
        self.assertNotIn(SourceName.RSS, INTERVAL_SOURCES)
        self.assertNotIn(SourceName.NEWS, INTERVAL_SOURCES)
        self.assertNotIn(SourceName.ALERTS, INTERVAL_SOURCES)
        now = datetime(2026, 11, 26, 2, 0, tzinfo=timezone.utc)
        rss = SourceConfig(
            candidate_id=uuid4(), source="rss_media", enabled=True,
            interval_seconds=1200, next_run_at=now + timedelta(hours=1),
        )
        self.assertTrue(due_for_run(rss, now, slug="axel-kicillof"))
