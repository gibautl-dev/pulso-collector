"""Vigilante, coordinador y gancho del cron del equipo de crisis."""

from __future__ import annotations

import contextlib
import io
import os
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest import mock
from zoneinfo import ZoneInfo
from uuid import uuid4

from pulso import deploy_run
from pulso.crisis.agents import BriefResult, CrisisLLM
from pulso.crisis.db import MemoryStore
from pulso.crisis.run import run_crisis, run_for_candidate
from pulso.crisis.settings import CrisisSettings, CrisisSettingsError
from pulso.crisis.watcher import (
    detect_attack_ads,
    detect_negative_spikes,
    detect_rising_topics,
    detect_suspicious_campaigns,
    is_notable,
    watch,
)

TZ = ZoneInfo("America/Argentina/Buenos_Aires")
NOW = datetime(2026, 11, 24, 14, 30, tzinfo=TZ)


def mid():
    return str(uuid4())


def mention(**kw):
    published = kw.pop("published_at", NOW - timedelta(hours=10))
    if isinstance(published, datetime) and published.tzinfo is None:
        published = published.replace(tzinfo=TZ)
    row = {
        "id": kw.pop("id", mid()),
        "candidate_id": "cand-k",
        "source": "rss_media",
        "url": kw.pop("url", f"https://example.test/{mid()}"),
        "title": "Control laboral y la Sociedad Rural",
        "content": "La Sociedad Rural criticó el control de jornadas y sueldos a pymes.",
        "author": "Redacción",
        "author_handle": None,
        "outlet": "LA NACION",
        "published_at": published.isoformat() if isinstance(published, datetime) else published,
        "collected_at": NOW.isoformat(),
        "account_relation": "third_party",
        "tone": "critica",
        "target": "candidate",
        "topic_id": None,
        "relevance": "alta",
        "metrics": {},
    }
    row.update(kw)
    return row


def x_mention(text, impressions=200, **kw):
    return mention(
        source="x",
        title=None,
        content=text,
        outlet=None,
        author_handle=kw.pop("handle", "vecino"),
        metrics={"impression_count": impressions, "like_count": kw.pop("likes", 6)},
        **kw,
    )


class WatcherTests(unittest.TestCase):
    def test_rising_topic_fires_on_new_media_cluster(self):
        titles = [
            "Kicillof avanza con un control de jornadas y sueldos: la Sociedad Rural habla de burocracia",
            "Empresas y pymes rechazan el control laboral que impulsa la Provincia",
            "La Sociedad Rural criticó el régimen de control de sueldos y jornadas",
            "Trámites y burocracia: preocupación empresaria por el control laboral",
        ]
        outlets = ["LA NACION", "Infobae", "TN", "Ámbito"]
        recent = [
            mention(title=t, outlet=o, published_at=NOW - timedelta(hours=h), tone="critica" if i < 3 else "informativo")
            for i, (t, o, h) in enumerate(zip(titles, outlets, (8, 12, 20, 30)))
        ]
        recent += [
            x_mention("La Sociedad Rural tiene razón: este control laboral a pymes es burocracia", impressions=400, published_at=NOW - timedelta(hours=6)),
            x_mention("Otra vez trámites y control de sueldos, las pymes no dan más", impressions=150, published_at=NOW - timedelta(hours=5)),
        ]
        # Baselines irrelevantes
        earlier = [
            mention(title="Agenda de gabinete en La Plata", outlet="Télam", published_at=NOW - timedelta(days=4), tone="informativo", content="Reunión de ministros."),
        ]
        alerts = detect_rising_topics(recent + earlier, tz=TZ, now=NOW)
        kinds = [a.trigger_type for a in alerts]
        self.assertIn("rising_topic", kinds)
        rising = next(a for a in alerts if a.trigger_type == "rising_topic")
        self.assertGreaterEqual(rising.metrics["media_count"], 3)
        self.assertLess(rising.metrics["baseline_daily_mean"], 1)
        self.assertTrue(rising.trigger_key.startswith("rising_topic:"))

    def test_rising_topic_skips_when_baseline_already_hot(self):
        def series(days_ago, n, title="Control laboral Sociedad Rural sueldos jornadas pymes burocracia"):
            return [
                mention(
                    title=title,
                    outlet=f"Medio {i}",
                    published_at=NOW - timedelta(days=days_ago, hours=i),
                )
                for i in range(n)
            ]
        recent = series(0, 4)  # dentro de 48h, days=0 is today
        earlier = []
        for days_ago in range(3, 10):
            earlier.extend(series(days_ago, 2))  # media diaria >= 1
        alerts = detect_rising_topics(recent + earlier, tz=TZ, now=NOW)
        self.assertEqual(alerts, [])

    def test_negative_spike_needs_z_and_floor(self):
        # 7 días previos con 4 notables/día, ayer 14 (z alto)
        rows = []
        today = NOW.date()
        for i in range(1, 8):
            day = today - timedelta(days=i)
            count = 14 if i == 1 else 4
            for j in range(count):
                when = datetime(day.year, day.month, day.day, 12, j, tzinfo=TZ)
                rows.append(
                    mention(
                        title=f"Crítica {i}-{j}",
                        outlet="Diario",
                        source="rss_media" if j % 2 == 0 else "x",
                        content="crítica al gobernador",
                        metrics={"impression_count": 120, "like_count": 5} if j % 2 else {},
                        published_at=when,
                    )
                )
        # Fuente X estable: más días con X (ya hay)
        alerts = detect_negative_spikes(rows, tz=TZ, now=NOW)
        self.assertTrue(any(a.trigger_type == "negative_spike" for a in alerts))
        # Un día apenas por arriba del promedio no alcanza
        quiet = []
        for i in range(1, 8):
            day = today - timedelta(days=i)
            for j in range(5 if i == 1 else 4):
                when = datetime(day.year, day.month, day.day, 12, j, tzinfo=TZ)
                quiet.append(mention(title=f"n{i}{j}", published_at=when, source="rss_media"))
        self.assertEqual(detect_negative_spikes(quiet, tz=TZ, now=NOW), [])

    def test_suspicious_campaign_excludes_media_syndication(self):
        now_iso = NOW.isoformat()
        media = [
            {
                "id": mid(),
                "handle": "LANACION",
                "display_name": "LA NACION",
                "detected_at": now_iso,
                "signals": {"kinds": ["coordination"], "fingerprint": "titulo-rural"},
            }
            for _ in range(4)
        ]
        self.assertEqual(detect_suspicious_campaigns(media, now=NOW), [])
        real = [
            {
                "id": mid(),
                "handle": f"bot{i}",
                "display_name": f"User {i}",
                "detected_at": now_iso,
                "signals": {"kinds": ["group_burst", "coordination"], "fingerprint": "copypasta-pymes"},
            }
            for i in range(6)
        ]
        alerts = detect_suspicious_campaigns(real, now=NOW)
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0].metrics["account_count"], 6)

    def test_attack_ads_floor(self):
        ads = []
        clas = []
        for i in range(9):
            aid = f"ad-{i}"
            ads.append({"id": mid(), "ad_id": aid, "ad_delivery_start_time": (NOW - timedelta(hours=10)).isoformat()})
            clas.append({"ad_id": aid, "stance": "en_contra"})
        alerts = detect_attack_ads(ads, clas, tz=TZ, now=NOW)
        self.assertEqual(len(alerts), 1)
        few = ads[:3]
        few_c = clas[:3]
        self.assertEqual(detect_attack_ads(few, few_c, tz=TZ, now=NOW), [])

    def test_notable_thresholds(self):
        self.assertTrue(is_notable(mention(source="rss_media")))
        self.assertTrue(is_notable(x_mention("hola", impressions=80)))
        quiet = x_mention("hola", impressions=10, likes=1)
        quiet["metrics"] = {"impression_count": 10, "like_count": 1, "followers_count": 10}
        self.assertFalse(is_notable(quiet))


class FakeLLM:
    def complete_brief(self, payload):
        return BriefResult(
            output={
                "title": "Control laboral",
                "risk_level": "medio_alto",
                "summary": "Salió el tema en medios.",
                "analyst": {"diagnosis": "pico", "who": "medios", "reach": "acotado", "key_pieces": []},
                "evidence": {"dossier_recommended": False, "reason": "sindicación", "accounts": [], "caveats": ""},
                "strategist": {"options": [{"id": "A", "title": "a", "rationale": "r", "audience": "x", "risk": "bajo", "when_to_use": "ahora"}] * 3},
                "writer": {"drafts": []},
            },
            model="gpt-6-luna",
            prompt_version="test",
            input_tokens=100,
            output_tokens=50,
            cost_usd=0.01,
        )


def settings(**kw):
    return SimpleNamespace(
        database_url="postgresql://pulso_classifier@h/db",
        llm_api_key="sk-test",
        llm_base_url="https://api.openai.com/v1",
        model="gpt-6-luna",
        enabled=True,
        max_cost_usd=kw.get("max_cost_usd", 0.50),
        max_briefs_per_run=kw.get("max_briefs_per_run", 3),
        request_timeout=90,
        reasoning_effort="low",
        max_retries=2,
    )


def labor_pack():
    titles = [
        "Kicillof avanza con un control de jornadas y sueldos: la Sociedad Rural habla de burocracia",
        "Empresas y pymes rechazan el control laboral que impulsa la Provincia",
        "La Sociedad Rural criticó el régimen de control de sueldos y jornadas",
        "Trámites y burocracia: preocupación empresaria por el control laboral",
    ]
    mentions = [
        mention(title=t, outlet=o, published_at=NOW - timedelta(hours=h))
        for t, o, h in zip(titles, ["LA NACION", "Infobae", "TN", "Ámbito"], (8, 12, 20, 30))
    ]
    return {
        "mentions": mentions,
        "suspicious_accounts": [],
        "ads": [],
        "ad_classifications": [],
        "ai_answers": [],
    }


class CoordinatorTests(unittest.TestCase):
    def test_writes_brief_and_does_not_reset_approved(self):
        cand = {"id": "cand-k", "slug": "axel-kicillof", "name": "Axel Kicillof", "enabled": True, "max_cost_usd": 0.50, "max_briefs_per_run": 3}
        store = MemoryStore([cand], {"cand-k": labor_pack()})
        out = run_for_candidate(store=store, llm=FakeLLM(), settings=settings(), candidate=cand, now=NOW, write=True)
        self.assertGreaterEqual(out.briefs_written, 1)
        self.assertEqual(store.alerts[0]["status"], "new")
        roles = {r["agent_role"] for r in store.runs}
        self.assertGreaterEqual(roles, {"watcher", "analyst", "evidence", "strategist", "writer", "coordinator"})
        # Aprobar a mano y volver a correr: no se toca.
        store.alerts[0]["status"] = "approved"
        out2 = run_for_candidate(store=store, llm=FakeLLM(), settings=settings(), candidate=cand, now=NOW, write=True)
        self.assertEqual(out2.skipped_locked, 1)
        self.assertEqual(out2.briefs_written, 0)
        self.assertEqual(store.alerts[0]["status"], "approved")

    def test_cost_cap_stops_extra_briefs(self):
        cand = {"id": "cand-k", "slug": "axel-kicillof", "name": "Axel Kicillof", "enabled": True, "max_cost_usd": 0.015, "max_briefs_per_run": 3}
        pack = labor_pack()
        # Segundo cluster distinto
        pack["mentions"] += [
            mention(
                title="Cayó el índice de visibilidad de un candidato en ChatGPT y Gemini de golpe",
                content="ChatGPT Gemini visibilidad respuestas de modelos de inteligencia artificial",
                outlet="Infobae",
                published_at=NOW - timedelta(hours=4),
            ),
            mention(
                title="ChatGPT y Gemini recortan menciones: visibilidad en respuestas de IA",
                content="modelos de inteligencia artificial visibilidad ChatGPT Gemini",
                outlet="LA NACION",
                published_at=NOW - timedelta(hours=6),
            ),
            mention(
                title="La visibilidad en ChatGPT y Gemini preocupa al equipo de campaña",
                content="inteligencia artificial visibilidad ChatGPT Gemini respuestas",
                outlet="TN",
                published_at=NOW - timedelta(hours=7),
            ),
        ]
        store = MemoryStore([cand], {"cand-k": pack})
        class Pricey(FakeLLM):
            def complete_brief(self, payload):
                r = super().complete_brief(payload)
                r.cost_usd = 0.012
                return r
        out = run_for_candidate(store=store, llm=Pricey(), settings=settings(max_cost_usd=0.015), candidate=cand, now=NOW, write=True)
        self.assertEqual(out.briefs_written, 1)
        self.assertGreaterEqual(out.skipped_cost + out.skipped_cap, 0)
        # Si hay un segundo cluster, el tope de costo tiene que frenarlo (0.012 + 0.012 > 0.015)
        if out.alerts_detected >= 2:
            self.assertEqual(out.briefs_written, 1)
            self.assertGreaterEqual(out.skipped_cost, 1)
        else:
            self.assertEqual(out.briefs_written, 1)

    def test_disabled_candidates_are_ignored(self):
        rows = [
            {"id": "k", "slug": "axel-kicillof", "name": "Axel Kicillof", "enabled": True, "max_cost_usd": 0.5, "max_briefs_per_run": 3},
            {"id": "p", "slug": "pedro-sanchez", "name": "Pedro Sánchez", "enabled": False, "max_cost_usd": 0.5, "max_briefs_per_run": 3},
        ]
        store = MemoryStore(rows, {"k": labor_pack(), "p": labor_pack()})
        out = run_crisis(store=store, settings=settings(), llm=FakeLLM(), now=NOW, write=True)
        slugs = [c.slug for c in out.candidates]
        self.assertEqual(slugs, ["axel-kicillof"])

    def test_repr_hides_secrets_and_requires_classifier_url(self):
        env = {
            "CLASSIFIER_DATABASE_URL": "postgresql://pulso_collector:s3cret@host:5432/postgres",
            "LLM_API_KEY": "sk-secret-value-no-imprimir",
        }
        with self.assertRaisesRegex(CrisisSettingsError, "pulso_classifier"):
            CrisisSettings.from_env(env)
        env["CLASSIFIER_DATABASE_URL"] = "postgresql://pulso_classifier:s3cret@host:5432/postgres"
        s = CrisisSettings.from_env(env)
        text = repr(s)
        self.assertNotIn("sk-secret-value-no-imprimir", text)
        self.assertNotIn("s3cret", text)
        self.assertFalse(s.enabled)
        self.assertEqual(s.max_cost_usd, 0.50)


class CronHookTests(unittest.TestCase):
    def test_cron_skips_when_disabled_and_isolates_credentials(self):
        with mock.patch.dict(os.environ, {"PULSO_CRISIS_AGENT_ENABLED": "false"}, clear=False):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                result = deploy_run.run_crisis_agent([])
        self.assertIsNone(result)
        self.assertIn("disabled", out.getvalue())
        isolated = deploy_run.child_env(deploy_run.COLLECTOR_ONLY, deploy_run.META_ADS_ONLY)
        for key in ("DATABASE_URL", "PGPASSWORD", "META_ADS_ACCESS_TOKEN", "YOUTUBE_API_KEY", "X_BEARER_TOKEN"):
            self.assertNotIn(key, isolated)

    def test_cron_passes_candidate_and_classifier_env_when_enabled(self):
        calls = []

        def fake_run(command, timeout, env=None, prefix="cron"):
            calls.append({"command": command, "env": env, "prefix": prefix, "timeout": timeout})
            return 0

        with mock.patch.dict(os.environ, {"PULSO_CRISIS_AGENT_ENABLED": "true", "PULSO_CRISIS_AGENT_TIMEOUT_SECONDS": "180"}, clear=False):
            with mock.patch.object(deploy_run, "run_command", fake_run):
                code = deploy_run.run_crisis_agent(["--candidate", "axel-kicillof", "--interval", "20"])
        self.assertEqual(code, 0)
        self.assertEqual(calls[0]["prefix"], "crisis_agent")
        self.assertEqual(calls[0]["command"][-2:], ["--candidate", "axel-kicillof"])
        self.assertIn("-m", calls[0]["command"])
        self.assertIn("pulso.crisis", calls[0]["command"])


if __name__ == "__main__":
    unittest.main()
