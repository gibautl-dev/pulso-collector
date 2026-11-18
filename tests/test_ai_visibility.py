import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

import httpx

from pulso.ai.classifier import ClassifierSettings, LLMClient
from pulso.ai_visibility.classify_answers import (
    answers_as_mentions,
    classify_answers,
    extract_other_politicians,
)
from pulso.ai_visibility.client import (
    ResponsesClient,
    VisibilityError,
    count_web_search_calls,
    extract_citations,
    extract_output_text,
)
from pulso.ai_visibility.cost import cost_for_usage, monthly_projection, sum_costs
from pulso.ai_visibility.prompts import DEFAULT_PROMPTS, load_prompt_overrides, render_prompts
from pulso.ai_visibility.run import already_ran_today, run_visibility
from pulso.ai_visibility.settings import VisibilitySettings, api_key_from_env
from pulso.deploy_run import CLASSIFIER_ONLY, run_ai_visibility


def _settings(key="sk-test-key-do-not-leak"):
    return VisibilitySettings(api_key=key, dry_run=True, use_web_search=True, max_retries=0)


def _responses_payload(text="Respuesta de prueba sobre el candidato.", url="https://example.com/nota"):
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


def _classify_payload(refs, tone="informativo", topic="gestión provincial"):
    return {
        "choices": [{
            "finish_reason": "stop",
            "message": {"content": json.dumps({
                "items": [
                    {
                        "ref": ref,
                        "tone": tone,
                        "target": "candidate",
                        "confidence": 0.7,
                        "topic": topic,
                        "relevance": "media",
                        "reason": "Respuesta descriptiva.",
                    }
                    for ref in refs
                ]
            }, ensure_ascii=False)},
        }],
        "usage": {"prompt_tokens": 800, "completion_tokens": 120},
        "model": "gpt-6-luna",
    }


def _politicians_payload(refs, names=None):
    names = names or ["Javier Milei"]
    return {
        "choices": [{
            "finish_reason": "stop",
            "message": {"content": json.dumps({
                "items": [{"ref": ref, "politicians": names} for ref in refs]
            }, ensure_ascii=False)},
        }],
        "usage": {"prompt_tokens": 400, "completion_tokens": 40},
        "model": "gpt-6-luna",
    }


class PromptTests(unittest.TestCase):
    def test_default_count_and_interpolation(self):
        self.assertTrue(8 <= len(DEFAULT_PROMPTS) <= 12)
        rendered = render_prompts("Axel Kicillof")
        self.assertEqual(len(rendered), len(DEFAULT_PROMPTS))
        self.assertTrue(all("Axel Kicillof" in p["text"] for p in rendered))
        self.assertFalse(any("{name}" in p["text"] for p in rendered))
        keys = [p["key"] for p in rendered]
        self.assertEqual(len(keys), len(set(keys)))

    def test_override_file(self, tmp_path=None):
        path = Path("/tmp/ai_visibility_prompts_test.json")
        rows = [{"key": f"q{i}", "text": f"¿Qué opinás de {{name}} en el tema {i}?"} for i in range(8)]
        path.write_text(json.dumps(rows), encoding="utf-8")
        loaded = load_prompt_overrides(path)
        self.assertEqual(len(loaded), 8)
        self.assertIn("Axel Kicillof", render_prompts("Axel Kicillof", loaded)[0]["text"])
        path.unlink(missing_ok=True)


class CostTests(unittest.TestCase):
    def test_chat_latest_and_web_search(self):
        # 900 uncached input * 5/1M + 100 cached * 0.50/1M + 200 output * 30/1M + 1 search * 0.01
        usage = {"input_tokens": 1000, "output_tokens": 200,
                 "input_tokens_details": {"cached_tokens": 100}}
        cost = cost_for_usage("chat-latest", usage, web_search_calls=1)
        expected = 900 * 5 / 1_000_000 + 100 * 0.50 / 1_000_000 + 200 * 30 / 1_000_000 + 0.01
        self.assertAlmostEqual(cost["cost_usd"], expected, places=6)
        self.assertEqual(cost["web_search_calls"], 1)

    def test_gpt_6_luna(self):
        usage = {"prompt_tokens": 10000, "completion_tokens": 2000}
        cost = cost_for_usage("gpt-6-luna", usage, 0)
        expected = 10000 * 0.10 / 1_000_000 + 2000 * 0.50 / 1_000_000
        self.assertAlmostEqual(cost["cost_usd"], expected, places=6)

    def test_unknown_model_does_not_invent_price(self):
        cost = cost_for_usage("modelo-inventado-xyz", {"input_tokens": 10, "output_tokens": 10}, 0)
        self.assertIsNone(cost["cost_usd"])
        self.assertTrue(cost["unknown_model"])

    def test_monthly_projection(self):
        self.assertAlmostEqual(monthly_projection(0.12), 3.6, places=6)
        self.assertIsNone(monthly_projection(None))


class CitationTests(unittest.TestCase):
    def test_extracts_unique_https_urls(self):
        payload = _responses_payload(url="https://www.lanacion.com.ar/nota")
        payload["output"][0]["action"]["sources"].append({"url": "ftp://x", "title": "no"})
        payload["output"][1]["content"][0]["annotations"].append(
            {"type": "url_citation", "url": "https://www.lanacion.com.ar/nota", "title": "dup"}
        )
        citations = extract_citations(payload)
        self.assertEqual(len(citations), 1)
        self.assertEqual(citations[0]["url"], "https://www.lanacion.com.ar/nota")
        self.assertEqual(count_web_search_calls(payload), 1)
        self.assertIn("candidato", extract_output_text(payload))


class ClientTests(unittest.TestCase):
    def test_ask_with_web_search(self):
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertTrue(urlparse(str(request.url)).path.endswith("/responses"))
            self.assertTrue(request.headers.get("Authorization", "").startswith("Bearer "))
            body = json.loads(request.content)
            self.assertEqual(body["model"], "chat-latest")
            self.assertEqual(body["tools"][0]["type"], "web_search")
            return httpx.Response(200, json=_responses_payload())

        transport = httpx.MockTransport(handler)
        client = ResponsesClient(_settings(), transport=transport)
        try:
            result = client.ask("¿Quién es Axel Kicillof?")
        finally:
            client.close()
        self.assertEqual(result["model"], "chat-latest")
        self.assertTrue(result["used_web_search"])
        self.assertEqual(len(result["citations"]), 1)
        self.assertNotIn("sk-test-key-do-not-leak", json.dumps(result))

    def test_unsupported_tool_is_flagged(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, json={"error": {"message": "web_search is not supported"}})

        client = ResponsesClient(_settings(max_retries := 0) if False else _settings(),
                                 transport=httpx.MockTransport(handler))
        try:
            with self.assertRaises(VisibilityError) as ctx:
                client.ask("pregunta")
        finally:
            client.close()
        self.assertTrue(ctx.exception.tool_unsupported)

    def test_settings_repr_hides_key(self):
        settings = _settings("super-secret-key-value")
        self.assertNotIn("super-secret-key-value", repr(settings))


class RunTests(unittest.TestCase):
    def test_dry_run_classifies_and_does_not_write(self):
        prompts = [{"key": "quien_es", "text": "¿Quién es {name}?"},
                   {"key": "economia", "text": "¿Cómo va la economía con {name}?"}]
        calls = {"responses": 0, "completions": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            path = urlparse(str(request.url)).path
            if path.endswith("/responses"):
                calls["responses"] += 1
                return httpx.Response(200, json=_responses_payload("Gestión descripta con matices."))
            if path.endswith("/chat/completions"):
                calls["completions"] += 1
                body = json.loads(request.content)
                refs = body["response_format"]["json_schema"]["schema"]["properties"]["items"]["items"]["properties"]["ref"]["enum"]
                if "politicians" in json.dumps(body):
                    return httpx.Response(200, json=_politicians_payload(refs, ["Javier Milei"]))
                return httpx.Response(200, json=_classify_payload(refs, tone="critica", topic="economía"))
            return httpx.Response(404, json={"error": "unexpected"})

        transport = httpx.MockTransport(handler)
        settings = _settings()
        ask_client = ResponsesClient(settings, transport=transport)
        cls_settings = ClassifierSettings(database_url="postgresql://unused", api_key="sk-test-key-do-not-leak",
                                          model="gpt-6-luna", dry_run=True)
        classify_client = LLMClient(cls_settings, transport=transport)
        try:
            payload = run_visibility(
                settings, "Axel Kicillof",
                candidate_id="2c4f83ed-f2bd-4afe-89a3-fa6263cc5b7e",
                candidate_slug="axel-kicillof",
                prompts=prompts,
                ask_client=ask_client,
                classify_client=classify_client,
            )
        finally:
            ask_client.close()
            classify_client.close()
        self.assertTrue(payload["dry_run"])
        self.assertFalse(payload["wrote_db"])
        self.assertEqual(len(payload["answers"]), 2)
        self.assertEqual(payload["answers"][0]["tone"], "critica")
        self.assertEqual(payload["answers"][0]["topic"], "economía")
        self.assertEqual(payload["answers"][0]["other_politicians"], ["Javier Milei"])
        self.assertTrue(payload["web_search_used"])
        self.assertIsNotNone(payload["cost"]["cost_usd"])
        self.assertAlmostEqual(payload["cost"]["monthly_30d_usd"], payload["cost"]["cost_usd"] * 30, places=5)
        self.assertEqual(calls["responses"], 2)
        self.assertEqual(calls["completions"], 2)
        dumped = json.dumps(payload)
        self.assertNotIn("sk-test-key-do-not-leak", dumped)

    def test_web_fallback_when_tool_unsupported(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            path = urlparse(str(request.url)).path
            if path.endswith("/responses"):
                body = json.loads(request.content)
                calls.append("web" if "tools" in body else "plain")
                if "tools" in body:
                    return httpx.Response(400, json={"error": {"message": "web_search is not supported"}})
                payload = _responses_payload()
                payload["output_text"] = "Sin web."
                payload["output"] = [{"type": "message", "content": [{"type": "output_text", "text": "Sin web.", "annotations": []}]}]
                return httpx.Response(200, json=payload)
            body = json.loads(request.content)
            refs = body["response_format"]["json_schema"]["schema"]["properties"]["items"]["items"]["properties"]["ref"]["enum"]
            if "politicians" in json.dumps(body):
                return httpx.Response(200, json=_politicians_payload(refs, []))
            return httpx.Response(200, json=_classify_payload(refs))

        transport = httpx.MockTransport(handler)
        settings = _settings()
        ask_client = ResponsesClient(settings, transport=transport)
        cls_settings = ClassifierSettings(database_url="postgresql://unused", api_key="x", model="gpt-6-luna")
        classify_client = LLMClient(cls_settings, transport=transport)
        prompts = [{"key": "quien_es", "text": "¿Quién es {name}?"}]
        try:
            payload = run_visibility(settings, "Axel Kicillof", prompts=prompts,
                                     ask_client=ask_client, classify_client=classify_client)
        finally:
            ask_client.close()
            classify_client.close()
        self.assertEqual(calls, ["web", "plain"])
        self.assertTrue(payload["web_search_fallback"])
        self.assertFalse(payload["web_search_used"])
        self.assertEqual(payload["answers"][0]["answer"], "Sin web.")

    def test_write_is_rejected(self):
        settings = VisibilitySettings(api_key="x", dry_run=False)
        with self.assertRaises(RuntimeError):
            run_visibility(settings, "Axel Kicillof")

    def test_already_ran_today(self):
        from datetime import date, datetime
        from zoneinfo import ZoneInfo
        now = datetime(2026, 11, 18, 15, 0, tzinfo=ZoneInfo("America/Argentina/Buenos_Aires"))
        self.assertTrue(already_ran_today([date(2026, 11, 18)], now))
        self.assertFalse(already_ran_today([date(2026, 11, 17)], now))


class SqlTests(unittest.TestCase):
    def test_migration_has_rls_and_no_anon(self):
        sql = Path("/tmp/repo/deploy/ai_visibility.sql").read_text(encoding="utf-8")
        self.assertIn("NO APLICAR", sql)
        self.assertIn("create table if not exists public.ai_answers", sql)
        self.assertIn("enable row level security", sql)
        self.assertIn("force row level security", sql)
        self.assertIn("to pulso_classifier", sql)
        self.assertIn("candidate_members", sql)
        self.assertIn("revoke all on table public.ai_visibility_settings, public.ai_answers", sql)
        self.assertIn("grant select on table public.ai_visibility_settings, public.ai_answers to authenticated", sql)
        self.assertNotIn("to anon", sql.lower().split("revoke all")[0] or "to anon")
        # anon only appears in REVOKE, never GRANT
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
