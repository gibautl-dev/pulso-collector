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


class MigrationTest(unittest.TestCase):
    def test_migration_staff_only_and_no_anon(self):
        sql = Path(__file__).resolve().parents[1].joinpath("deploy/ai_visibility_cap.sql").read_text()
        self.assertIn("daily_budget_usd numeric(10, 4) not null default 1.00", sql)
        self.assertIn("revoke all on table public.ai_visibility_budget from public, anon, authenticated", sql)
        self.assertIn("grant update (last_reached_on) on table public.ai_visibility_budget to pulso_classifier", sql)
        self.assertIn("revoke all on function public.ai_visibility_cap_reached_today() from public, anon", sql)
        self.assertNotIn("to anon", sql)


if __name__ == "__main__":
    unittest.main()
