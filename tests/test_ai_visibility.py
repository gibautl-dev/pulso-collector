import io
import json
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx

from pulso.ai.classifier import ClassifierSettings, LLMClient
from pulso.ai_visibility.citations import annotate_citations, apply_model_drops
from pulso.ai_visibility.classify_answers import ANALYSIS_PROMPT_VERSION, analyze_answers, attach_analysis
from pulso.ai_visibility.client import (
    MAX_OUTPUT_TOKENS,
    SYSTEM_INSTRUCTIONS,
    ResponsesClient,
    VisibilityError,
    count_web_search_calls,
    extract_citations,
    extract_output_text,
)
from pulso.ai_visibility.cost import cost_for_usage, monthly_projection
from pulso.ai_visibility.prompts import DEFAULT_PROMPTS, load_prompt_overrides, render_prompts
from pulso.ai_visibility.run import already_ran_today, daily_balance, run_visibility, should_run_now
from pulso.ai_visibility.settings import VisibilitySettings, api_key_from_env
from pulso.deploy_run import CLASSIFIER_ONLY, run_ai_visibility, run_command


def _settings(**kwargs):
    values = dict(api_key="sk-test-key-do-not-leak", dry_run=True, use_web_search=True,
                  max_retries=0, run_after_hour=0)
    values.update(kwargs)
    return VisibilitySettings(**values)


def _responses_payload(text="Respuesta de prueba sobre el candidato.", url="https://www.lanacion.com.ar/nota"):
    return {
        "model": "chat-latest",
        "output_text": text,
        "usage": {
            "input_tokens": 1000,
            "output_tokens": 200,
            "total_tokens": 1200,
            "input_tokens_details": {"cached_tokens": 100},
        },
        "output": [
            {"type": "web_search_call", "action": {"sources": [{"url": url, "title": "Nota"}]}},
            {
                "type": "message",
                "content": [{
                    "type": "output_text",
                    "text": text,
                    "annotations": [{"type": "url_citation", "url": url, "title": "Nota"}],
                }],
            },
        ],
    }


def _analysis_payload(refs, balance=10, drop_urls=None):
    return {
        "choices": [{
            "finish_reason": "stop",
            "message": {"content": json.dumps({
                "items": [
                    {
                        "ref": ref,
                        "balance": balance,
                        "reason": "Saldo levemente favorable.",
                        "positives": ["Bajó el homicidio"],
                        "negatives": ["Siguen los robos"],
                        "topics": ["gestión provincial"],
                        "other_politicians": ["Javier Milei"],
                        "drop_urls": drop_urls or [],
                    }
                    for ref in refs
                ]
            }, ensure_ascii=False)},
        }],
        "usage": {"prompt_tokens": 8000, "completion_tokens": 400},
        "model": "gpt-6-luna",
    }


class PromptTests(unittest.TestCase):
    def test_default_count_and_interpolation(self):
        self.assertTrue(8 <= len(DEFAULT_PROMPTS) <= 12)
        rendered = render_prompts("Axel Kicillof")
        self.assertEqual(len(rendered), len(DEFAULT_PROMPTS))
        self.assertTrue(all("Axel Kicillof" in p["text"] for p in rendered))

    def test_override_file(self):
        path = Path("/tmp/ai_visibility_prompts_test.json")
        rows = [{"key": f"q{i}", "text": f"¿Qué opinás de {{name}} en el tema {i}?"} for i in range(8)]
        path.write_text(json.dumps(rows), encoding="utf-8")
        loaded = load_prompt_overrides(path)
        self.assertEqual(len(loaded), 8)
        path.unlink(missing_ok=True)


class CostTests(unittest.TestCase):
    def test_chat_latest_and_web_search(self):
        usage = {"input_tokens": 1000, "output_tokens": 200,
                 "input_tokens_details": {"cached_tokens": 100}}
        cost = cost_for_usage("chat-latest", usage, web_search_calls=1)
        expected = 900 * 5 / 1_000_000 + 100 * 0.50 / 1_000_000 + 200 * 30 / 1_000_000 + 0.01
        self.assertAlmostEqual(cost["cost_usd"], expected, places=6)

    def test_gpt_6_luna(self):
        usage = {"prompt_tokens": 10000, "completion_tokens": 2000}
        cost = cost_for_usage("gpt-6-luna", usage, 0)
        expected = 10000 * 0.10 / 1_000_000 + 2000 * 0.50 / 1_000_000
        self.assertAlmostEqual(cost["cost_usd"], expected, places=6)

    def test_unknown_model_does_not_invent_price(self):
        cost = cost_for_usage("modelo-inventado-xyz", {"input_tokens": 10, "output_tokens": 10}, 0)
        self.assertIsNone(cost["cost_usd"])

    def test_monthly_projection(self):
        self.assertAlmostEqual(monthly_projection(0.12), 3.6, places=6)


class CitationTests(unittest.TestCase):
    def test_keeps_argentine_and_drops_obvious_foreign(self):
        rows = annotate_citations([
            {"url": "https://www.lanacion.com.ar/politica/nota", "title": "LA NACION"},
            {"url": "https://www.clarin.com/politica/nota", "title": "Clarín"},
            {"url": "https://www.infobae.com/politica/2026/11/01/kicillof/", "title": "Infobae"},
            {"url": "https://elpais.com/argentina/2026-11-16/milei-paso.html", "title": "El País AR"},
            {"url": "https://elpais.com/espana/elecciones-generales/2026-11-13/psoe.html", "title": "El País ES"},
            {"url": "https://elpais.com/economia/2026-11-16/yolanda-diaz-retira-su-candidatura-a-la-direccion-general-de-la-oit.html", "title": "Yolanda"},
            {"url": "https://los40.com/2026/11/13/rtve-confirma-la-fecha/", "title": "LOS40"},
            {"url": "https://www.huffingtonpost.es/politica/cuerpo.html", "title": "HuffPost"},
            {"url": "https://cadenaser.com/andalucia/2026/11/11/radio-sevilla", "title": "SER"},
            {"url": "https://es.wikipedia.org/wiki/Axel_Kicillof", "title": "Wikipedia"},
            {"url": "https://www.newtral.es/axel-kicillof/20250908/", "title": "Newtral"},
        ])
        kept = {r["url"]: r for r in rows if r["kept"]}
        dropped = {r["url"]: r for r in rows if not r["kept"]}
        self.assertIn("https://www.lanacion.com.ar/politica/nota", kept)
        self.assertEqual(kept["https://www.lanacion.com.ar/politica/nota"]["domain"], "lanacion.com.ar")
        self.assertIn("https://www.clarin.com/politica/nota", kept)
        self.assertIn("https://elpais.com/argentina/2026-11-16/milei-paso.html", kept)
        self.assertIn("https://es.wikipedia.org/wiki/Axel_Kicillof", kept)
        self.assertIn("https://elpais.com/espana/elecciones-generales/2026-11-13/psoe.html", dropped)
        self.assertEqual(dropped["https://elpais.com/espana/elecciones-generales/2026-11-13/psoe.html"]["filter_reason"], "fuera_de_tema")
        self.assertIn("https://los40.com/2026/11/13/rtve-confirma-la-fecha/", dropped)
        self.assertEqual(dropped["https://los40.com/2026/11/13/rtve-confirma-la-fecha/"]["filter_reason"], "fuera_de_argentina")
        self.assertIn("https://www.newtral.es/axel-kicillof/20250908/", dropped)
        self.assertIn("https://elpais.com/economia/2026-11-16/yolanda-diaz-retira-su-candidatura-a-la-direccion-general-de-la-oit.html", dropped)

    def test_model_can_drop_more_but_not_restore(self):
        rows = annotate_citations([
            {"url": "https://www.lanacion.com.ar/nota"},
            {"url": "https://los40.com/x"},
        ])
        updated = apply_model_drops(rows, ["https://www.lanacion.com.ar/nota"])
        by_url = {r["url"]: r for r in updated}
        self.assertFalse(by_url["https://www.lanacion.com.ar/nota"]["kept"])
        self.assertFalse(by_url["https://los40.com/x"]["kept"])

    def test_extracts_unique_https_urls(self):
        payload = _responses_payload(url="https://www.lanacion.com.ar/nota")
        citations = extract_citations(payload)
        self.assertEqual(len(citations), 1)
        self.assertEqual(count_web_search_calls(payload), 1)
        self.assertIn("candidato", extract_output_text(payload))


class ClientTests(unittest.TestCase):
    def test_ask_requests_short_answers(self):
        self.assertIn("250 y 400 palabras", SYSTEM_INSTRUCTIONS)
        self.assertEqual(MAX_OUTPUT_TOKENS, 900)

        def handler(request: httpx.Request) -> httpx.Response:
            self.assertTrue(urlparse(str(request.url)).path.endswith("/responses"))
            body = json.loads(request.content)
            self.assertEqual(body["max_output_tokens"], 900)
            self.assertEqual(body["model"], "chat-latest")
            return httpx.Response(200, json=_responses_payload())

        client = ResponsesClient(_settings(), transport=httpx.MockTransport(handler))
        try:
            result = client.ask("¿Quién es Axel Kicillof?")
        finally:
            client.close()
        self.assertTrue(result["used_web_search"])
        self.assertNotIn("sk-test-key-do-not-leak", json.dumps(result))

    def test_unsupported_tool_is_flagged(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, json={"error": {"message": "web_search is not supported"}})

        client = ResponsesClient(_settings(), transport=httpx.MockTransport(handler))
        try:
            with self.assertRaises(VisibilityError) as ctx:
                client.ask("pregunta")
        finally:
            client.close()
        self.assertTrue(ctx.exception.tool_unsupported)

    def test_settings_repr_hides_key(self):
        self.assertNotIn("super-secret-key-value", repr(_settings(api_key="super-secret-key-value")))


class AnalysisTests(unittest.TestCase):
    def test_analyzes_full_answer_without_1200_cut(self):
        long_answer = ("palabra " * 500).strip()  # bien por encima de 1200 caracteres
        self.assertGreater(len(long_answer), 1200)
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            captured["user"] = body["messages"][1]["content"]
            refs = body["response_format"]["json_schema"]["schema"]["properties"]["items"]["items"]["properties"]["ref"]["enum"]
            return httpx.Response(200, json=_analysis_payload(refs, balance=-25))

        settings = ClassifierSettings(database_url="postgresql://unused", api_key="x", model="gpt-6-luna")
        client = LLMClient(settings, transport=httpx.MockTransport(handler))
        rows = [{
            "key": "seguridad",
            "prompt": "¿Cómo va la seguridad?",
            "answer": long_answer,
            "citations": [{"url": "https://www.clarin.com/politica/x", "domain": "clarin.com", "kept": True}],
        }]
        try:
            labels, problems, usage, model = analyze_answers(client, "Axel Kicillof", rows)
        finally:
            client.close()
        self.assertEqual(problems, [])
        self.assertEqual(labels["seguridad"]["balance"], -25)
        self.assertIn(long_answer, captured["user"])
        self.assertNotIn('"texto": "' + long_answer[:50], "")  # sanity
        self.assertEqual(model, "gpt-6-luna")
        attach_analysis(rows, labels, model)
        self.assertEqual(rows[0]["balance"], -25)
        self.assertEqual(rows[0]["classification_prompt_version"], ANALYSIS_PROMPT_VERSION)
        self.assertEqual(rows[0]["positives"], ["Bajó el homicidio"])


class RunTests(unittest.TestCase):
    def _clients(self, handler):
        transport = httpx.MockTransport(handler)
        settings = _settings()
        ask_client = ResponsesClient(settings, transport=transport)
        cls_settings = ClassifierSettings(database_url="postgresql://unused", api_key="sk-test-key-do-not-leak",
                                          model="gpt-6-luna", dry_run=True)
        classify_client = LLMClient(cls_settings, transport=transport)
        return settings, ask_client, classify_client

    def test_dry_run_analyzes_and_does_not_write(self):
        prompts = [{"key": "quien_es", "text": "¿Quién es {name}?"},
                   {"key": "economia", "text": "¿Cómo va la economía con {name}?"}]
        calls = {"responses": 0, "completions": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            path = urlparse(str(request.url)).path
            if path.endswith("/responses"):
                calls["responses"] += 1
                return httpx.Response(200, json=_responses_payload("Gestión descripta con matices."))
            calls["completions"] += 1
            body = json.loads(request.content)
            refs = body["response_format"]["json_schema"]["schema"]["properties"]["items"]["items"]["properties"]["ref"]["enum"]
            return httpx.Response(200, json=_analysis_payload(refs, balance=20))

        settings, ask_client, classify_client = self._clients(handler)
        try:
            payload = run_visibility(
                settings, "Axel Kicillof",
                candidate_id="2c4f83ed-f2bd-4afe-89a3-fa6263cc5b7e",
                candidate_slug="axel-kicillof",
                prompts=prompts,
                ask_client=ask_client,
                classify_client=classify_client,
                force=True,
            )
        finally:
            ask_client.close()
            classify_client.close()
        self.assertTrue(payload["dry_run"])
        self.assertFalse(payload["wrote_db"])
        self.assertEqual(len(payload["answers"]), 2)
        self.assertEqual(payload["answers"][0]["balance"], 20)
        self.assertEqual(payload["answers"][0]["topics"], ["gestión provincial"])
        self.assertEqual(payload["answers"][0]["other_politicians"], ["Javier Milei"])
        self.assertEqual(payload["daily_balance"], 20)
        self.assertTrue(payload["web_search_used"])
        self.assertEqual(calls["responses"], 2)
        self.assertEqual(calls["completions"], 1)
        self.assertNotIn("sk-test-key-do-not-leak", json.dumps(payload))
        # Una sola llamada de análisis, no la de menciones ni una extra de políticos.
        self.assertIsNotNone(payload["cost"]["classifier"]["cost_usd"])

    def test_write_uses_database(self):
        prompts = [{"key": "quien_es", "text": "¿Quién es {name}?"}]
        saved = []

        class FakeDB:
            def save_answers(self, rows, asked_at, asked_on):
                saved.append((len(rows), asked_on))
                return len(rows)

        def handler(request: httpx.Request) -> httpx.Response:
            path = urlparse(str(request.url)).path
            if path.endswith("/responses"):
                return httpx.Response(200, json=_responses_payload())
            body = json.loads(request.content)
            refs = body["response_format"]["json_schema"]["schema"]["properties"]["items"]["items"]["properties"]["ref"]["enum"]
            return httpx.Response(200, json=_analysis_payload(refs, balance=5))

        settings = _settings(dry_run=False)
        transport = httpx.MockTransport(handler)
        ask_client = ResponsesClient(settings, transport=transport)
        classify_client = LLMClient(
            ClassifierSettings(database_url="postgresql://unused", api_key="x", model="gpt-6-luna"),
            transport=transport,
        )
        try:
            payload = run_visibility(
                settings, "Axel Kicillof",
                candidate_id="2c4f83ed-f2bd-4afe-89a3-fa6263cc5b7e",
                prompts=prompts, ask_client=ask_client, classify_client=classify_client,
                database=FakeDB(), force=True,
            )
        finally:
            ask_client.close()
            classify_client.close()
        self.assertTrue(payload["wrote_db"])
        self.assertEqual(payload["saved"], 1)
        self.assertEqual(saved[0][0], 1)

    def test_write_without_db_is_rejected(self):
        settings = _settings(dry_run=False)
        with self.assertRaises(RuntimeError):
            run_visibility(settings, "Axel Kicillof", force=True, prompts=[
                {"key": "quien_es", "text": "¿Quién es {name}?"}
            ])

    def test_skips_before_hour_and_if_already_ran(self):
        now = datetime(2026, 11, 18, 8, 0, tzinfo=ZoneInfo("America/Argentina/Buenos_Aires"))
        ok, reason = should_run_now(now, hour=9, already=False, force=False)
        self.assertFalse(ok)
        self.assertEqual(reason, "before_hour")
        later = datetime(2026, 11, 18, 9, 5, tzinfo=ZoneInfo("America/Argentina/Buenos_Aires"))
        ok, reason = should_run_now(later, hour=9, already=False)
        self.assertTrue(ok)
        ok, reason = should_run_now(later, hour=9, already=True)
        self.assertFalse(ok)
        self.assertEqual(reason, "already_ran_today")
        ok, reason = should_run_now(now, hour=9, already=True, force=True)
        self.assertTrue(ok)
        self.assertTrue(already_ran_today([date(2026, 11, 18)], later))
        self.assertFalse(already_ran_today([date(2026, 11, 17)], later))

        settings = _settings(run_after_hour=9, dry_run=True)
        payload = run_visibility(settings, "Axel Kicillof", now=now)
        self.assertTrue(payload["skipped"])
        self.assertEqual(payload["reason"], "before_hour")
        self.assertFalse(payload["wrote_db"])

    def test_daily_balance_average(self):
        self.assertEqual(daily_balance([{"balance": 10}, {"balance": -20}, {"balance": None}]), -5.0)
        self.assertIsNone(daily_balance([]))


class SqlTests(unittest.TestCase):
    def test_migration_has_balance_rls_and_no_anon_grant(self):
        sql = Path("/tmp/repo/deploy/ai_visibility.sql").read_text(encoding="utf-8")
        self.assertIn("create table if not exists public.ai_answers", sql)
        self.assertIn("balance integer", sql)
        self.assertIn("positives jsonb", sql)
        self.assertNotIn("tone text", sql)
        self.assertIn("enable row level security", sql)
        self.assertIn("force row level security", sql)
        self.assertIn("to pulso_classifier", sql)
        self.assertIn("candidate_members", sql)
        self.assertIn("revoke all on table public.ai_visibility_settings, public.ai_answers", sql)
        self.assertIn("grant select on table public.ai_visibility_settings, public.ai_answers to authenticated", sql)
        for line in sql.splitlines():
            stripped = line.strip().lower()
            if stripped.startswith("grant") and "anon" in stripped:
                self.fail(f"grant a anon: {line}")


class HookTests(unittest.TestCase):
    def test_skipped_by_default(self):
        import contextlib
        output = io.StringIO()
        with patch.dict("os.environ", {"PULSO_AI_VISIBILITY_ENABLED": "false"}, clear=False):
            with contextlib.redirect_stdout(output):
                result = run_ai_visibility([])
        self.assertIsNone(result)
        self.assertIn("ai_visibility_skipped", output.getvalue())

    def test_enabled_does_not_force_dry_run(self):
        captured = {}

        def fake_run_command(command, timeout, env=None, prefix="cron"):
            captured["command"] = command
            captured["prefix"] = prefix
            return 0

        with patch.dict("os.environ", {
            "PULSO_AI_VISIBILITY_ENABLED": "true",
            "PULSO_AI_VISIBILITY_TIMEOUT_SECONDS": "600",
            "PULSO_AI_VISIBILITY_DRY_RUN": "false",
        }, clear=False):
            with patch("pulso.deploy_run.run_command", fake_run_command):
                run_ai_visibility(["--candidate", "axel-kicillof"])
        self.assertEqual(captured["prefix"], "ai_visibility")
        self.assertIn("pulso.ai_visibility", captured["command"])
        self.assertIn("axel-kicillof", captured["command"])
        self.assertNotIn("--dry-run", captured["command"])

    def test_classifier_only_includes_openai_key(self):
        self.assertIn("OPENAI_API_KEY", CLASSIFIER_ONLY)
        self.assertIn("LLM_API_KEY", CLASSIFIER_ONLY)


class KeyEnvTests(unittest.TestCase):
    def test_missing_key(self):
        with patch.dict("os.environ", {"LLM_API_KEY": "", "OPENAI_API_KEY": ""}, clear=False):
            with self.assertRaises(ValueError):
                api_key_from_env()


if __name__ == "__main__":
    unittest.main()
