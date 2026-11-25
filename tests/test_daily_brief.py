"""Resumen diario: cifras, validación de fuentes/cifras, corrida y paso del cron. Sin red ni Postgres."""

from __future__ import annotations

import json
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest import mock
from zoneinfo import ZoneInfo

from pulso.daily_brief.db import MemoryStore
from pulso.daily_brief.grounding import allowed_numbers, ground_items, numbers_in, ungrounded_numbers
from pulso.daily_brief.llm import DailyBriefLLM, build_schema
from pulso.daily_brief.metrics import compute_metrics, highlight_options, select_pieces
from pulso.daily_brief.run import build_brief, run_daily_brief
from pulso.daily_brief.settings import DailyBriefSettings, DailyBriefSettingsError

AR = ZoneInfo("America/Argentina/Buenos_Aires")
DAY = date(2026, 11, 24)
CID = "11111111-0000-0000-0000-000000000001"
T_ECO = "t-eco"
T_GES = "t-ges"
TOPICS = [{"id": T_ECO, "candidate_id": CID, "label": "economía"}, {"id": T_GES, "candidate_id": CID, "label": "gestión"}]
CAND = {"id": CID, "slug": "axel-kicillof", "name": "Axel Kicillof"}


def _m(i, d, *, source="google_news", tone="informativo", target="candidate", topic=T_GES, hour=12, **extra):
    at = datetime(d.year, d.month, d.day, hour, 0, tzinfo=AR).astimezone(timezone.utc)
    row = {
        "id": f"m-{d.isoformat()}-{i}",
        "candidate_id": CID,
        "source": source,
        "url": f"https://example.org/{d.isoformat()}/{i}",
        "title": f"Nota {d.isoformat()} número {i}",
        "content": "Texto de la nota",
        "outlet": f"Medio {i % 5}",
        "published_at": at.isoformat(),
        "account_relation": "third_party",
        "tone": tone,
        "target": target,
        "topic_id": topic,
        "metrics": {},
    }
    row.update(extra)
    return row


def _week(per_day=20, crit=4, today_extra=None):
    out = []
    for back in range(1, 8):
        d = DAY - timedelta(days=back)
        for i in range(per_day):
            out.append(_m(i, d, tone="critica" if i < crit else "informativo", source="x" if i % 2 else "google_news"))
    for i in range(per_day):
        out.append(_m(i, DAY, tone="critica" if i < crit else "informativo", source="x" if i % 2 else "google_news"))
    out.extend(today_extra or [])
    return out


def _settings(**kw):
    base = dict(database_url="", database_password=None, llm_api_key="k", llm_base_url="http://x", model="gpt-6-luna")
    base.update(kw)
    return DailyBriefSettings(**base)


class FakeClient:
    def __init__(self, output):
        self.output = output
        self.calls = 0
        self.last_user = None

    def complete_json(self, *, system, user, schema, schema_name):
        self.calls += 1
        self.last_user = user
        return self.output, {"input_tokens": 6000, "output_tokens": 2000}, "gpt-6-luna"


class MetricsTest(unittest.TestCase):
    def test_day_vs_base_and_rising_topic(self):
        extra = [_m(100 + i, DAY, topic=T_ECO, tone="critica") for i in range(12)]
        m = compute_metrics(candidate=CAND, mentions=_week(today_extra=extra), topics=TOPICS, brief_date=DAY, tz=AR)
        self.assertEqual(m["menciones"]["dia"], 32)
        self.assertEqual(m["menciones"]["promedio_7d"], 20.0)
        self.assertTrue(m["comparacion"]["fiable"])
        self.assertEqual(m["comparacion"]["var_vs_promedio_pct"], 60)
        self.assertEqual(m["sobre_candidato"]["dia"]["criticas"], 16)
        self.assertEqual(m["comparacion"]["criticas_var_pct"], 300)
        self.assertEqual([r["tema"] for r in m["temas_en_suba"]], ["economía"])
        self.assertTrue(m["temas_en_suba"][0]["nuevo"])
        # balance = (a favor − críticas) / clasificadas · 100
        self.assertEqual(m["sobre_candidato"]["dia"]["balance"], round(-16 / 32 * 100))
        self.assertTrue(m["suficiente"])

    def test_new_source_is_not_a_spike(self):
        extra = [_m(200 + i, DAY, source="youtube") for i in range(30)]
        m = compute_metrics(candidate=CAND, mentions=_week(today_extra=extra), topics=TOPICS, brief_date=DAY, tz=AR)
        self.assertEqual(m["comparacion"]["fuentes_nuevas"], ["youtube"])
        self.assertEqual(m["comparacion"]["dia"], 20)  # solo fuentes estables
        self.assertEqual(m["comparacion"]["var_vs_promedio_pct"], 0)

    def test_ramp_up_hides_comparisons(self):
        mentions = _week(per_day=2, crit=1) + [_m(300 + i, DAY) for i in range(200)]
        m = compute_metrics(candidate=CAND, mentions=mentions, topics=TOPICS, brief_date=DAY, tz=AR)
        comp = m["comparacion"]
        self.assertFalse(comp["fiable"])
        self.assertIsNone(comp["var_vs_promedio_pct"])
        self.assertIsNone(comp["promedio_7d"])
        self.assertIsNone(m["menciones"]["promedio_7d"])
        self.assertEqual(m["temas_en_suba"], [])
        self.assertTrue(all(h["delta"] is None for h in highlight_options(m, "X") if h["key"] != "anuncios"))

    def test_own_accounts_and_other_days_excluded(self):
        mentions = _week() + [_m(900, DAY, account_relation="own"), _m(901, DAY + timedelta(days=1))]
        m = compute_metrics(candidate=CAND, mentions=mentions, topics=TOPICS, brief_date=DAY, tz=AR)
        self.assertEqual(m["menciones"]["dia"], 20)

    def test_insufficient(self):
        m = compute_metrics(candidate=CAND, mentions=[_m(i, DAY) for i in range(3)], topics=TOPICS, brief_date=DAY, tz=AR)
        self.assertFalse(m["suficiente"])
        self.assertIn("3 menciones", m["motivo_insuficiente"])

    def test_pieces_dedupe_and_refs(self):
        dup = [_m(500 + i, DAY, title="Mismo titular - Medio", tone="critica") for i in range(5)]
        pieces = select_pieces(_week() + dup, brief_date=DAY, tz=AR, topics=TOPICS, rising_topic_ids=[], limit=10)
        self.assertLessEqual(len(pieces), 10)
        self.assertEqual(sum(1 for p in pieces if p["titulo"].startswith("Mismo titular")), 1)
        self.assertEqual([p["ref"] for p in pieces], [f"m{i}" for i in range(1, len(pieces) + 1)])

    def test_x_pieces_use_handle_and_unescape(self):
        x = _m(1, DAY, source="x", author_handle="cuenta", outlet="Nombre", title="&quot;Hola&quot;")
        pieces = select_pieces([x], brief_date=DAY, tz=AR, topics=TOPICS, rising_topic_ids=[])
        self.assertEqual(pieces[0]["medio_o_autor"], "@cuenta")
        self.assertEqual(pieces[0]["titulo"], '"Hola"')


class GroundingTest(unittest.TestCase):
    def test_number_parsing(self):
        self.assertEqual(numbers_in("1.234 menciones, 60,6 y −27%"), {1234.0, 60.6, 27.0})

    def test_drops_unknown_refs_and_invented_numbers(self):
        allowed = {94.0, 24.0, 60.6, 61.0}
        dropped = []
        items = [
            {"text": "Las críticas llegaron a 94 (+24%).", "refs": ["m1"]},
            {"text": "Algo sin fuente.", "refs": ["m99"]},
            {"text": "Subió 37% en X.", "refs": ["m1"]},
            {"text": "Promedio de 61.", "refs": ["m2", "m99"]},
        ]
        kept = ground_items(items, ref_to_id={"m1": "id-1", "m2": "id-2"}, allowed=allowed,
                            text_keys=("text",), section="what_changed", dropped=dropped)
        self.assertEqual([k["text"] for k in kept], ["Las críticas llegaron a 94 (+24%).", "Promedio de 61."])
        self.assertEqual(kept[1]["mention_ids"], ["id-2"])
        self.assertEqual(sorted(d["reason"] for d in dropped), ["cifra_sin_respaldo", "sin_fuente"])

    def test_allowed_includes_piece_text_and_rounding(self):
        metrics = {"comparacion": {"promedio_7d": 75.6, "dia": 94, "dia_anterior": 70}}
        pieces = [{"titulo": "Se perdieron 400 mil empleos desde 2023", "extracto": "", "metricas": {}, "hora": "13:14"}]
        allowed = allowed_numbers(metrics, pieces, [])
        self.assertEqual(ungrounded_numbers("unas 76 por día, 400 mil desde 2023, +24 frente a ayer", allowed), [])
        self.assertEqual(ungrounded_numbers("llegó a 512", allowed), [512.0])


def _ok_output(highlight_key="criticas"):
    return {
        "headline": "Suben las críticas",
        "highlight_key": highlight_key,
        "what_changed": [{"text": "Las críticas fueron 16.", "refs": ["m1", "m2"]}, {"text": "Inventado 999.", "refs": ["m1"]}],
        "why_it_matters": [{"text": "Puede instalarse.", "refs": ["m3"]}],
        "what_to_do": [{"action": "Aclarar la medida.", "why": "Responde la crítica.", "priority": "alta",
                        "area": "comunicacion", "refs": ["m1"]}, {"action": "Sin fuente", "why": "", "priority": "baja",
                        "area": "digital", "refs": []}],
        "aclaracion": "",
    }


class RunTest(unittest.TestCase):
    def _store(self, mentions=None):
        return MemoryStore([CAND], {CID: {"mentions": mentions if mentions is not None else _week(crit=8), "topics": TOPICS}})

    def test_writes_grounded_brief_with_real_ids(self):
        client = FakeClient(_ok_output())
        store = self._store()
        out = run_daily_brief(store=store, settings=_settings(), llm=DailyBriefLLM(_settings(), client=client),
                              now=datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc))
        self.assertEqual(out.candidates[0].status, "ok")
        self.assertEqual(client.calls, 1)
        row = store.saved[0]
        self.assertEqual(row["brief_date"], "2026-11-24")
        o = row["output"]
        self.assertEqual(len(o["what_changed"]), 1)
        self.assertEqual(len(o["what_to_do"]), 1)
        cited = {i for sec in ("what_changed", "why_it_matters", "what_to_do") for it in o[sec] for i in it["mention_ids"]}
        self.assertEqual(cited, {s["id"] for s in o["sources"]})
        self.assertTrue(all(s["url"].startswith("https://example.org/2026-11-24/") for s in o["sources"]))
        self.assertTrue(cited <= set(row["input_ref"]["mention_ids"]))
        self.assertEqual(o["highlight"]["key"], "criticas")
        self.assertFalse(o["coordinator"]["auto_publish"])
        self.assertEqual(len(o["coordinator"]["dropped_items"]), 2)
        self.assertGreater(row["cost_usd"], 0)
        # Los ids reales no viajan al modelo, solo las refs.
        self.assertNotIn("m-2026-11-24-0", client.last_user)

    def test_invalid_highlight_key_falls_back(self):
        out = _ok_output(highlight_key="inventado")
        client = FakeClient(out)
        store = self._store()
        run_daily_brief(store=store, settings=_settings(), llm=DailyBriefLLM(_settings(), client=client),
                        brief_date=DAY, force=True)
        self.assertIn(store.saved[0]["output"]["highlight"]["key"], {"volumen", "criticas", "balance"})

    def test_insufficient_does_not_call_llm(self):
        client = FakeClient(_ok_output())
        store = self._store([_m(i, DAY) for i in range(4)])
        out = run_daily_brief(store=store, settings=_settings(), llm=DailyBriefLLM(_settings(), client=client),
                              brief_date=DAY, force=True)
        self.assertEqual(out.candidates[0].status, "insufficient")
        self.assertEqual(client.calls, 0)
        self.assertEqual(store.saved[0]["output"]["what_to_do"], [])
        self.assertEqual(store.saved[0]["cost_usd"], 0)

    def test_before_hour_and_already_done(self):
        client = FakeClient(_ok_output())
        store = self._store()
        early = datetime(2026, 11, 25, 7, 30, tzinfo=AR)
        out = run_daily_brief(store=store, settings=_settings(run_after_hour=8),
                              llm=DailyBriefLLM(_settings(), client=client), now=early)
        self.assertEqual(out.candidates[0].status, "skipped_before_hour")
        store.existing.add((CID, "2026-11-24"))
        out = run_daily_brief(store=store, settings=_settings(), llm=DailyBriefLLM(_settings(), client=client),
                              now=datetime(2026, 11, 25, 9, 0, tzinfo=AR))
        self.assertEqual(out.candidates[0].status, "skipped_already_done")
        self.assertEqual(client.calls, 0)

    def test_cost_cap_skips_call(self):
        client = FakeClient(_ok_output())
        store = self._store()
        out = run_daily_brief(store=store, settings=_settings(max_cost_per_brief_usd=0.0),
                              llm=DailyBriefLLM(_settings(), client=client), brief_date=DAY, force=True)
        self.assertEqual(out.candidates[0].status, "skipped")
        self.assertEqual(client.calls, 0)
        self.assertEqual(store.saved, [])

    def test_spain_candidate_uses_madrid_day_and_style(self):
        cand = {"id": CID, "slug": "pedro-sanchez", "name": "Pedro Sánchez"}
        client = FakeClient(_ok_output())
        row = build_brief(candidate=cand, data={"mentions": _week(crit=8), "topics": TOPICS}, brief_date=DAY,
                          settings=_settings(), llm=DailyBriefLLM(_settings(), client=client), budget_left=1,
                          now=datetime(2026, 11, 25, tzinfo=timezone.utc))
        self.assertEqual(row["timezone"], "Europe/Madrid")
        self.assertIsNone(row["metrics"]["anuncios"])  # sin Meta Ads en la UE

    def test_schema_restricts_highlight_keys(self):
        schema = build_schema(["volumen", "balance"])
        self.assertEqual(schema["properties"]["highlight_key"]["enum"], ["volumen", "balance"])
        self.assertEqual(schema["properties"]["what_to_do"]["maxItems"], 3)


class SettingsTest(unittest.TestCase):
    def test_requires_classifier_role_and_hides_key(self):
        with self.assertRaises(DailyBriefSettingsError):
            DailyBriefSettings.from_env({"CLASSIFIER_DATABASE_URL": "postgresql://pulso_collector@h/db", "LLM_API_KEY": "k"})
        s = DailyBriefSettings.from_env({"CLASSIFIER_DATABASE_URL": "postgresql://pulso_classifier:pw@h/db",
                                         "LLM_API_KEY": "sk-secret"})
        self.assertNotIn("sk-secret", repr(s))
        self.assertNotIn("pw", repr(s))
        self.assertEqual(s.run_after_hour, 8)


class CronStepTest(unittest.TestCase):
    def test_disabled_by_default(self):
        from pulso import deploy_run

        with mock.patch.dict("os.environ", {}, clear=True), mock.patch.object(deploy_run, "run_command") as rc, \
                mock.patch.object(deploy_run, "log") as lg:
            self.assertIsNone(deploy_run.run_daily_brief(["--candidate", "milei"]))
        rc.assert_not_called()
        lg.assert_called_with(event="daily_brief_skipped", reason="disabled")

    def test_enabled_runs_module_without_collector_credentials(self):
        from pulso import deploy_run

        env = {"PULSO_DAILY_BRIEF_ENABLED": "true", "PULSO_DAILY_BRIEF_DRY_RUN": "true", "DATABASE_URL": "x",
               "META_ADS_ACCESS_TOKEN": "t", "LLM_API_KEY": "k"}
        with mock.patch.dict("os.environ", env, clear=True), mock.patch.object(deploy_run, "run_command", return_value=0) as rc:
            deploy_run.run_daily_brief(["--candidate", "milei", "--dry-run"])
        cmd, timeout = rc.call_args.args[:2]
        self.assertEqual(cmd[1:], ["-m", "pulso.daily_brief", "--candidate", "milei", "--dry-run"])
        child_env = rc.call_args.kwargs["env"]
        self.assertNotIn("DATABASE_URL", child_env)
        self.assertNotIn("META_ADS_ACCESS_TOKEN", child_env)
        self.assertIn("LLM_API_KEY", child_env)


if __name__ == "__main__":
    unittest.main()
