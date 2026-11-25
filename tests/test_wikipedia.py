import json
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch
import httpx

from pulso.wikipedia.client import (
    AGENT,
    fetch_pageviews,
    pageviews_url,
    parse_items,
    parse_timestamp,
    range_for,
)
from pulso.wikipedia.defaults import article_for, article_url, normalize_title, project_for

FIXTURES = Path(__file__).parent / "fixtures" / "wikipedia"


class DefaultsTests(unittest.TestCase):
    def test_default_articles(self):
        self.assertEqual(article_for("axel-kicillof"), "Axel_Kicillof")
        self.assertEqual(article_for("milei"), "Javier_Milei")
        self.assertEqual(article_for("pedro-sanchez"), "Pedro_Sánchez")
        self.assertEqual(project_for(), "es.wikipedia")

    def test_override_and_url(self):
        self.assertEqual(article_for("milei", {"article": "Javier Milei"}), "Javier_Milei")
        self.assertEqual(
            article_for("x", {"article": "https://es.wikipedia.org/wiki/Javier_Milei"}),
            "Javier_Milei",
        )
        self.assertEqual(
            article_url("es.wikipedia", "Pedro_Sánchez"),
            "https://es.wikipedia.org/wiki/Pedro_S%C3%A1nchez",
        )
        with self.assertRaises(ValueError):
            article_for("desconocido")

    def test_normalize(self):
        self.assertEqual(normalize_title("  Axel Kicillof  "), "Axel_Kicillof")


class ClientTests(unittest.IsolatedAsyncioTestCase):
    def test_parse_and_range(self):
        self.assertEqual(parse_timestamp("2026112400"), date(2026, 11, 24))
        payload = json.loads((FIXTURES / "pageviews.json").read_text())
        rows = parse_items(payload)
        self.assertEqual(len(rows), 7)
        self.assertEqual(rows[-1]["views"], 1100)
        self.assertEqual(rows[-1]["day"], date(2026, 11, 24))
        start, end = range_for(today=date(2026, 11, 25), days=30)
        self.assertEqual(end, date(2026, 11, 25))
        self.assertEqual(start, date(2026, 10, 27))
        self.assertEqual(AGENT, "user")
        url = pageviews_url("es.wikipedia", "Axel_Kicillof", start, end)
        self.assertTrue(url.startswith("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"))
        self.assertIn("/user/", url)
        self.assertIn("Axel_Kicillof", url)

    async def test_fetch_sends_honest_ua_and_handles_404(self):
        calls = []
        payload = json.loads((FIXTURES / "pageviews.json").read_text())

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append({"ua": request.headers.get("user-agent"), "url": str(request.url)})
            if "Missing_Page" in str(request.url):
                return httpx.Response(404, json={"type": "not found"})
            return httpx.Response(200, json=payload)

        transport = httpx.MockTransport(handler)
        ua = "PulsoCollector/0.3 (+https://pulso-web-re4x.onrender.com)"
        rows = await fetch_pageviews(
            project="es.wikipedia",
            title="Axel_Kicillof",
            start=date(2026, 11, 18),
            end=date(2026, 11, 24),
            user_agent=ua,
            transport=transport,
        )
        self.assertEqual(len(rows), 7)
        self.assertEqual(calls[0]["ua"], ua)
        missing = await fetch_pageviews(
            project="es.wikipedia",
            title="Missing_Page",
            start=date(2026, 11, 18),
            end=date(2026, 11, 24),
            user_agent=ua,
            transport=transport,
        )
        self.assertEqual(missing, [])
