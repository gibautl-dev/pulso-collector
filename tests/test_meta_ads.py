import contextlib
import io
import json
import os
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx

from pulso.deploy_run import (
    CLASSIFIER_ONLY,
    COLLECTOR_ONLY,
    META_ADS_ONLY,
    child_env,
    run_meta_ads,
)
from pulso.meta_ads.run import ads_from_payload, run_meta_ads as run_job, should_run_now
from pulso.meta_ads.settings import MetaAdsSettings, token_from_env
from pulso.meta_ads.__main__ import main as meta_main
from pulso.sources.meta_ads import (
    ARCHIVE_FIELDS,
    DEFAULT_SEARCH_TERMS,
    MetaAdsClient,
    MetaAdsError,
    MetaAdsQuery,
    build_params,
    chunked,
    normalize_terms,
    parse_ad,
    parse_range,
    parse_time,
)

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "meta_ads_archive.json"
TZ = ZoneInfo("America/Argentina/Buenos_Aires")


def _settings(**overrides) -> MetaAdsSettings:
    values = dict(dry_run=True, run_after_hour=9)
    values.update(overrides)
    return MetaAdsSettings(**values)


class ParseTests(unittest.TestCase):
    def test_insights_range_object(self):
        lower, upper, raw = parse_range({"lower_bound": "100", "upper_bound": "499"})
        self.assertEqual(lower, 100)
        self.assertEqual(upper, 499)
        self.assertEqual(raw["lower_bound"], "100")

    def test_open_ended_and_labels(self):
        self.assertEqual(parse_range(">1M")[:2], (1000001, None))
        self.assertEqual(parse_range("<1000")[:2], (None, 999))
        self.assertEqual(parse_range("1K-5K")[:2], (1000, 5000))
        self.assertEqual(parse_range("100-499")[:2], (100, 499))

    def test_parse_time_official_offset(self):
        moment = parse_time("2019-01-24T19:02:04+0000")
        self.assertEqual(moment.year, 2019)
        self.assertEqual(moment.hour, 19)
        self.assertEqual(moment.utcoffset().total_seconds(), 0)

    def test_parse_ad_fixture(self):
        rows = json.loads(FIXTURE.read_text())["data"]
        ad = parse_ad(rows[0])
        self.assertEqual(ad.ad_id, "111111111111111")
        self.assertEqual(ad.currency, "ARS")
        self.assertEqual(ad.spend_lower, 100)
        self.assertEqual(ad.spend_upper, 499)
        self.assertEqual(ad.impressions_lower, 1000)
        self.assertEqual(ad.page_name, "Ejemplo Página")
        self.assertIn("instagram", ad.publisher_platforms)
        self.assertTrue(ad.ad_delivery_start_time.startswith("2026-11-02"))

    def test_search_terms_length_limit(self):
        with self.assertRaises(MetaAdsError):
            normalize_terms(["x" * 101])


class QueryTests(unittest.TestCase):
    def test_build_params_requires_country_and_search(self):
        query = MetaAdsQuery(ad_reached_countries=["AR"])
        params = build_params(query, search_terms="Kicillof")
        self.assertEqual(params["ad_reached_countries"], "['AR']")
        self.assertEqual(params["ad_type"], "POLITICAL_AND_ISSUE_ADS")
        self.assertEqual(params["ad_active_status"], "ALL")
        self.assertIn("spend", params["fields"])
        self.assertIn("impressions", params["fields"])
        self.assertIn("demographic_distribution", params["fields"])
        self.assertIn("delivery_by_region", params["fields"])
        self.assertIn("bylines", params["fields"])
        self.assertIn("page_name", params["fields"])
        self.assertIn("ad_snapshot_url", params["fields"])
        self.assertNotIn("eu_total_reach", params["fields"])
        with self.assertRaises(MetaAdsError):
            build_params(query)

    def test_page_ids_chunked_in_tens(self):
        ids = [str(i) for i in range(23)]
        groups = chunked(ids)
        self.assertEqual(len(groups), 3)
        self.assertEqual(len(groups[0]), 10)
        self.assertEqual(len(groups[2]), 3)


class ClientTests(unittest.TestCase):
    def test_pagination_and_dedupe(self):
        first = {
            "data": [
                {"id": "1", "page_name": "A", "spend": {"lower_bound": "100", "upper_bound": "499"}},
                {"id": "2", "page_name": "B"},
            ],
            "paging": {"cursors": {"after": "cursor2"}, "next": "https://graph.facebook.com/v27.0/ads_archive?after=cursor2"},
        }
        second = {
            "data": [
                {"id": "2", "page_name": "B-dup"},
                {"id": "3", "page_name": "C"},
            ],
            "paging": {"cursors": {}},
        }

        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.host, "graph.facebook.com")
            self.assertIn("/v27.0/ads_archive", str(request.url))
            self.assertIn("access_token=test-token", str(request.url))
            self.assertIn("ad_reached_countries", str(request.url))
            after = request.url.params.get("after")
            body = second if after == "cursor2" else first
            return httpx.Response(200, json=body)

        transport = httpx.MockTransport(handler)
        client = MetaAdsClient("test-token", transport=transport)
        query = MetaAdsQuery(search_terms=["Kicillof"], search_page_ids=[])
        ads = client.search(query)
        self.assertEqual({ad.ad_id for ad in ads}, {"1", "2", "3"})

    def test_terms_and_page_queries_merge(self):
        def handler(request: httpx.Request) -> httpx.Response:
            params = request.url.params
            if params.get("search_terms") == "Kicillof":
                return httpx.Response(200, json={"data": [{"id": "10"}]})
            if "999" in (params.get("search_page_ids") or ""):
                return httpx.Response(200, json={"data": [{"id": "10"}, {"id": "11"}]})
            return httpx.Response(200, json={"data": []})

        client = MetaAdsClient("tok", transport=httpx.MockTransport(handler))
        ads = client.search(MetaAdsQuery(search_terms=["Kicillof"], search_page_ids=["999"]))
        self.assertEqual({ad.ad_id for ad in ads}, {"10", "11"})

    def test_empty_data_stops_pagination(self):
        calls = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            if calls["n"] == 1:
                return httpx.Response(200, json={
                    "data": [{"id": "1"}],
                    "paging": {"cursors": {"after": "x"}},
                })
            return httpx.Response(200, json={"data": []})

        ads = MetaAdsClient("tok", transport=httpx.MockTransport(handler)).search(
            MetaAdsQuery(search_terms=["Kicillof"])
        )
        self.assertEqual([ad.ad_id for ad in ads], ["1"])
        self.assertEqual(calls["n"], 2)

    def test_rate_limit_and_token_errors(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, json={"error": {"code": 613, "message": "too many"}})

        with self.assertRaises(MetaAdsError) as ctx:
            MetaAdsClient("tok", transport=httpx.MockTransport(handler)).search(
                MetaAdsQuery(search_terms=["Kicillof"])
            )
        self.assertEqual(ctx.exception.kind, "rate_limit")
        self.assertTrue(ctx.exception.retryable)

        def bad_token(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, json={"error": {"code": 190, "message": "expired"}})

        with self.assertRaises(MetaAdsError) as ctx:
            MetaAdsClient("tok", transport=httpx.MockTransport(bad_token)).search(
                MetaAdsQuery(search_terms=["Kicillof"])
            )
        self.assertEqual(ctx.exception.kind, "token_invalido")

    def test_missing_token(self):
        with self.assertRaises(MetaAdsError):
            MetaAdsClient("")
        with patch.dict("os.environ", {"META_ADS_ACCESS_TOKEN": ""}, clear=False):
            with self.assertRaises(ValueError):
                token_from_env()


class RunTests(unittest.TestCase):
    def test_skips_before_hour_and_if_already_ran(self):
        morning = datetime(2026, 11, 18, 8, 0, tzinfo=TZ)
        ok, reason = should_run_now(morning, hour=9, already=False)
        self.assertFalse(ok)
        self.assertEqual(reason, "before_hour")
        ok, reason = should_run_now(datetime(2026, 11, 18, 10, tzinfo=TZ), already=True)
        self.assertEqual(reason, "already_ran_today")
        ok, reason = should_run_now(morning, already=True, force=True)
        self.assertTrue(ok)

    def test_dry_run_from_fixture_does_not_write(self):
        class Boom:
            def upsert_ads(self, *args, **kwargs):
                raise AssertionError("no debía escribir")

        rows = json.loads(FIXTURE.read_text())["data"]
        ads = ads_from_payload(rows)
        payload = run_job(
            _settings(dry_run=True),
            candidate_id=str(uuid4()),
            ads=ads,
            database=Boom(),
            force=True,
            now=datetime(2026, 11, 18, 15, tzinfo=TZ),
        )
        self.assertFalse(payload["wrote_db"])
        self.assertTrue(payload["dry_run"])
        self.assertEqual(payload["unique_ads"], 1)

    def test_cli_from_json_is_read_only(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = meta_main(["--from-json", str(FIXTURE), "--dry-run"])
        self.assertEqual(code, 0)
        events = [json.loads(line)["event"] for line in output.getvalue().splitlines() if line]
        self.assertIn("meta_ads_dry_run", events)
        self.assertNotIn("meta_ads_saved", events)

    def test_cli_without_token_fails_without_calling_meta(self):
        output = io.StringIO()
        env = {"META_ADS_ACCESS_TOKEN": "", "PULSO_META_ADS_DRY_RUN": "true"}
        with patch.dict("os.environ", env, clear=False):
            with contextlib.redirect_stdout(output):
                code = meta_main(["--dry-run"])
        self.assertEqual(code, 2)
        logged = output.getvalue()
        self.assertIn("meta_ads_error", logged)
        self.assertNotIn("graph.facebook.com", logged)


class SqlTests(unittest.TestCase):
    def test_migration_grants_and_no_collector_trigger(self):
        sql = Path("/tmp/repo/deploy/meta_ads.sql").read_text(encoding="utf-8")
        self.assertIn("create table if not exists public.meta_ads", sql)
        self.assertIn("unique (candidate_id, ad_id)", sql)
        self.assertIn("spend_lower", sql)
        self.assertIn("impressions_lower", sql)
        self.assertIn("demographic_distribution", sql)
        self.assertIn("delivery_by_region", sql)
        self.assertIn("enable row level security", sql)
        self.assertIn("force row level security", sql)
        self.assertIn("to pulso_collector", sql)
        self.assertIn("candidate_members", sql)
        self.assertIn("(select auth.uid())", sql)
        self.assertIn("revoke all on table public.meta_ads_settings, public.meta_ads", sql)
        self.assertIn("grant select on table public.meta_ads_settings, public.meta_ads to authenticated", sql)
        self.assertNotIn("create function", sql.lower())
        self.assertNotIn("create or replace function", sql.lower())
        self.assertNotIn("create trigger", sql.lower())
        self.assertIn("NO APLICAR", sql)
        for line in sql.splitlines():
            stripped = line.strip().lower()
            if stripped.startswith("grant") and "anon" in stripped:
                self.fail(f"grant a anon: {line}")


class HookTests(unittest.TestCase):
    def test_skipped_by_default(self):
        output = io.StringIO()
        with patch.dict("os.environ", {"PULSO_META_ADS_ENABLED": "false"}, clear=False):
            with contextlib.redirect_stdout(output):
                result = run_meta_ads([])
        self.assertIsNone(result)
        self.assertIn("meta_ads_skipped", output.getvalue())

    def test_enabled_keeps_token_only_in_meta_job(self):
        captured = {}

        def fake_run_command(command, timeout, env=None, prefix="cron"):
            captured["command"] = command
            captured["prefix"] = prefix
            captured["env"] = env
            return 0

        with patch.dict("os.environ", {
            "PULSO_META_ADS_ENABLED": "true",
            "PULSO_META_ADS_TIMEOUT_SECONDS": "180",
            "META_ADS_ACCESS_TOKEN": "secret-token",
            "DATABASE_URL": "postgresql://pulso_collector@host/db?sslmode=require",
            "LLM_API_KEY": "llm-secret",
        }, clear=False):
            with patch("pulso.deploy_run.run_command", fake_run_command):
                run_meta_ads(["--candidate", "axel-kicillof"])
            isolated = child_env(CLASSIFIER_ONLY)
            collector = child_env(CLASSIFIER_ONLY, META_ADS_ONLY)
            classifier = child_env(COLLECTOR_ONLY)
        self.assertEqual(captured["prefix"], "meta_ads")
        self.assertIn("pulso.meta_ads", captured["command"])
        self.assertIn("axel-kicillof", captured["command"])
        self.assertEqual(isolated.get("META_ADS_ACCESS_TOKEN"), "secret-token")
        self.assertNotIn("META_ADS_ACCESS_TOKEN", collector)
        self.assertNotIn("META_ADS_ACCESS_TOKEN", classifier)
        self.assertNotIn("LLM_API_KEY", isolated)
        self.assertIn("DATABASE_URL", isolated)

    def test_failure_does_not_change_cron_exit_contract(self):
        # El hook se invoca después de la recolección; un error suyo no se
        # propaga como código de salida del cron (igual que IA y sospechosas).
        with patch.dict("os.environ", {"PULSO_META_ADS_ENABLED": "true",
                                       "PULSO_META_ADS_TIMEOUT_SECONDS": "abc"}, clear=False):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                result = run_meta_ads([])
        self.assertIsNone(result)
        self.assertIn("meta_ads_error", output.getvalue())


if __name__ == "__main__":
    unittest.main()
