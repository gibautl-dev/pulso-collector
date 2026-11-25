"""Tope diario total de En la IA (deploy/ai_visibility_cap.sql)."""
import json
import unittest
from pathlib import Path
from urllib.parse import urlparse

import httpx

from pulso.ai.classifier import ClassifierSettings, LLMClient
from pulso.ai_visibility.client import ResponsesClient
from pulso.ai_visibility.run import DEFAULT_RESERVE_USD, MIN_RESERVE_USD, DailyBudget, run_visibility
from tests.test_ai_visibility import _analysis_payload, _responses_payload, _settings

PROMPTS = [{"key": f"p{i}", "text": f"Pregunta {i} sobre {{name}}"} for i in range(5)]


class DailyBudgetTest(unittest.TestCase):
    def test_from_state(self):
        self.assertIsNone(DailyBudget.from_state(None))
        b = DailyBudget.from_state({"daily_budget_usd": 1, "spent_today_usd": 0.2, "recent_max_usd": 0.09})
        self.assertAlmostEqual(b.reserve_usd, 0.09)
        self.assertEqual(DailyBudget.from_state({"daily_budget_usd": 1, "spent_today_usd": 0,
                                                 "recent_max_usd": None}).reserve_usd, DEFAULT_RESERVE_USD)
        self.assertEqual(DailyBudget.from_state({"daily_budget_usd": 1, "spent_today_usd": 0,
                                                 "recent_max_usd": 0.001}).reserve_usd, MIN_RESERVE_USD)

    def test_allows(self):
        b = DailyBudget(1.0, 0.8, 0.1)
        self.assertTrue(b.allows(0.1))
        self.assertFalse(b.allows(0.11))
        self.assertFalse(DailyBudget(0, 0, 0.02).allows(0))


class RunWithBudgetTest(unittest.TestCase):
    def _run(self, budget, dry_run=False):
        calls = {"responses": 0}
        marked = []
        saved = []

        class FakeDB:
            def save_answers(self, rows, asked_at, asked_on):
                saved.append(len(rows))
                return len(rows)

        def handler(request: httpx.Request) -> httpx.Response:
            if urlparse(str(request.url)).path.endswith("/responses"):
                calls["responses"] += 1
                return httpx.Response(200, json=_responses_payload())
            body = json.loads(request.content)
            refs = body["response_format"]["json_schema"]["schema"]["properties"]["items"]["items"]["properties"]["ref"]["enum"]
            return httpx.Response(200, json=_analysis_payload(refs))

        settings = _settings(dry_run=dry_run)
        transport = httpx.MockTransport(handler)
        ask = ResponsesClient(settings, transport=transport)
        cls = LLMClient(ClassifierSettings(database_url="postgresql://unused", api_key="x", model="gpt-6-luna"),
                        transport=transport)
        try:
            payload = run_visibility(
                settings, "Axel Kicillof", candidate_id="c1", candidate_slug="axel-kicillof",
                prompts=PROMPTS, ask_client=ask, classify_client=cls,
                database=None if dry_run else FakeDB(), force=True,
                budget=budget, on_budget_reached=lambda: marked.append(True),
            )
        finally:
            ask.close()
            cls.close()
        return payload, calls["responses"], marked, saved

    def test_stops_before_exceeding_and_marks(self):
        payload, asked, marked, saved = self._run(DailyBudget(0.1, 0.0, 0.03))
        self.assertTrue(payload["budget_reached"])
        per_answer = payload["cost"]["ask"]["cost_usd"] / asked
        # Pregunta mientras lo gastado + la reserva entre en el tope, y no más.
        self.assertGreater(asked, 0)
        self.assertLess(asked, len(PROMPTS))
        self.assertLessEqual((asked - 1) * per_answer + 0.03, 0.1 + 1e-9)
        self.assertGreater(asked * per_answer + 0.03, 0.1)
        self.assertEqual(saved, [asked])
        self.assertEqual(marked, [True])
        self.assertLessEqual(payload["cost"]["ask"]["cost_usd"], 0.1)

    def test_already_spent_asks_nothing(self):
        payload, asked, marked, saved = self._run(DailyBudget(1.0, 0.95, 0.1))
        self.assertEqual(asked, 0)
        self.assertTrue(payload["budget_reached"])
        self.assertEqual(payload["answers"], [])
        self.assertEqual(marked, [True])

    def test_room_left_runs_all(self):
        payload, asked, marked, _ = self._run(DailyBudget(1.0, 0.0, 0.1))
        self.assertFalse(payload["budget_reached"])
        self.assertEqual(asked, len(PROMPTS))
        self.assertEqual(marked, [])

    def test_without_budget_runs_all(self):
        payload, asked, _, _ = self._run(None)
        self.assertEqual(asked, len(PROMPTS))
        self.assertFalse(payload["budget_reached"])

    def test_dry_run_does_not_mark(self):
        payload, asked, marked, _ = self._run(DailyBudget(0.05, 0.0, 0.03), dry_run=True)
        self.assertTrue(payload["budget_reached"])
        self.assertEqual(marked, [])


class MainPerCandidateTest(unittest.TestCase):
    def test_uses_this_candidate_budget_and_marks_it(self):
        from datetime import date
        from unittest.mock import patch
        import pulso.ai_visibility.__main__ as cli

        calls = {}

        class FakeDB:
            def __init__(self, *a, **k):
                pass

            def candidate(self, slug):
                return {"id": "cid-k", "slug": slug, "name": "Axel Kicillof"}

            def already_ran_on(self, *a):
                return False

            def budget_state(self, candidate_id):
                calls["state_for"] = candidate_id
                return {"daily_budget_usd": 1.0, "spent_today_usd": 0.2, "recent_max_usd": 0.128,
                        "today": date(2026, 11, 26)}

            def mark_budget_reached(self, candidate_id, day):
                calls["marked"] = (candidate_id, day)

            def close(self):
                pass

        def fake_run(*a, **kw):
            calls["budget"] = kw["budget"]
            kw["on_budget_reached"]()
            return {"skipped": False, "answers": [], "errors": []}

        with patch.object(cli, "api_key_from_env", return_value="k"), \
             patch.object(cli.VisibilitySettings, "from_env", return_value=_settings(dry_run=False)), \
             patch.object(cli, "database_url_from_env", return_value=("postgresql://x", None)), \
             patch.object(cli, "VisibilityDB", FakeDB), \
             patch.object(cli, "run_visibility", fake_run), \
             patch.object(cli, "log", lambda **k: None):
            self.assertEqual(cli.main(["--candidate", "axel-kicillof", "--write"]), 0)
        self.assertEqual(calls["state_for"], "cid-k")
        self.assertAlmostEqual(calls["budget"].spent_today_usd, 0.2)
        self.assertAlmostEqual(calls["budget"].reserve_usd, 0.128)
        self.assertEqual(calls["marked"], ("cid-k", date(2026, 11, 26)))

    def test_other_candidate_spend_does_not_block(self):
        # Sánchez ya gastó 0,86 hoy, pero el estado de Kicillof solo trae su propio gasto (0).
        b = DailyBudget.from_state({"daily_budget_usd": 1.0, "spent_today_usd": 0.0, "recent_max_usd": 0.128})
        self.assertTrue(b.allows(0.86))
        self.assertFalse(b.allows(0.88))


class MigrationTest(unittest.TestCase):
    def test_per_candidate_migration_is_additive(self):
        sql = Path(__file__).resolve().parents[1].joinpath("deploy/ai_visibility_cap_per_candidate.sql").read_text()
        low = sql.lower()
        self.assertNotIn("drop table", low)
        self.assertNotIn("delete from", low)
        self.assertNotIn("truncate", low)
        self.assertIn("references public.candidates(id) on delete cascade", sql)
        self.assertIn("grant update (last_reached_on) on table public.ai_visibility_candidate_budget to pulso_classifier", sql)
        self.assertIn("revoke all on table public.ai_visibility_candidate_budget from public, anon, authenticated", sql)
        self.assertIn("after insert on public.candidates", sql)
        self.assertNotIn("to anon", sql)

    def test_migration_staff_only_and_no_anon(self):
        sql = Path(__file__).resolve().parents[1].joinpath("deploy/ai_visibility_cap.sql").read_text()
        self.assertIn("daily_budget_usd numeric(10, 4) not null default 1.00", sql)
        self.assertIn("revoke all on table public.ai_visibility_budget from public, anon, authenticated", sql)
        self.assertIn("grant update (last_reached_on) on table public.ai_visibility_budget to pulso_classifier", sql)
        self.assertIn("revoke all on function public.ai_visibility_cap_reached_today() from public, anon", sql)
        self.assertNotIn("to anon", sql)


if __name__ == "__main__":
    unittest.main()
