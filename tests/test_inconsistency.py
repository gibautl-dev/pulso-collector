"""Alertas de contradicciones: extracción de declaraciones, pares, validación, corrida y paso del cron.
Sin red ni Postgres."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from pulso.inconsistency.db import MemoryStore
from pulso.inconsistency.grounding import ground_findings
from pulso.inconsistency.llm import InconsistencyLLM, build_schema
from pulso.inconsistency.pairs import candidate_pairs, flag_contexts
from pulso.inconsistency.run import alert_key, run_inconsistency, scan_candidate
from pulso.inconsistency.settings import InconsistencySettings, InconsistencySettingsError
from pulso.inconsistency.statements import (
    aliases_for,
    attributed_statement,
    clean_title,
    extract_pieces,
    is_fact_check,
    is_flag,
)

CID = "11111111-0000-0000-0000-000000000001"
KICI = {"id": CID, "slug": "axel-kicillof", "name": "Axel Kicillof"}
SANCHEZ = {"id": "22222222-0000-0000-0000-000000000002", "slug": "pedro-sanchez", "name": "Pedro Sánchez"}
T_EDU, T_ECO, T_OTR = "t-edu", "t-eco", "t-otros"
TOPICS = [
    {"id": T_EDU, "candidate_id": CID, "label": "educación"},
    {"id": T_ECO, "candidate_id": CID, "label": "economía"},
    {"id": T_OTR, "candidate_id": CID, "label": "otros"},
]
NOW = datetime(2026, 11, 25, 22, 0, tzinfo=timezone.utc)


def _m(i, title, *, days_ago=1.0, topic=T_ECO, source="google_news", rel="third_party", outlet=None, content=""):
    return {
        "id": f"00000000-0000-0000-0000-{i:012d}",
        "candidate_id": CID,
        "source": source,
        "url": f"https://example.org/{i}",
        "title": title,
        "content": content,
        "outlet": outlet or f"Medio {i}",
        "published_at": (NOW - timedelta(days=days_ago)).isoformat(),
        "account_relation": rel,
        "tone": "informativo",
        "target": "candidate",
        "topic_id": topic,
    }


def _settings(**over):
    base = dict(database_url="", database_password=None, llm_api_key="k", llm_base_url="https://x", model="gpt-6-luna",
                min_statements=3, min_days=2)
    base.update(over)
    return InconsistencySettings(**base)


class FakeClient:
    def __init__(self, findings=None, fn=None):
        self.findings = findings or []
        self.fn = fn
        self.calls = []

    def complete_json(self, *, system, user, schema, schema_name):
        self.calls.append(user)
        findings = self.fn(user) if self.fn else self.findings
        return {"findings": findings}, {"input_tokens": 3000, "output_tokens": 600}, "gpt-6-luna"


class StatementTest(unittest.TestCase):
    def setUp(self):
        self.k = aliases_for(KICI)
        self.s = aliases_for(SANCHEZ)

    def test_colon_quote_is_candidate(self):
        st = attributed_statement('Kicillof: "Queremos que los bonaerenses disfruten en paz"', self.k)
        self.assertEqual(st["pattern"], "colon")
        self.assertEqual(st["quote"], "Queremos que los bonaerenses disfruten en paz")
        self.assertIsNotNone(attributed_statement("Axel Kicillof, sobre León XIV: “Hay pocos momentos así”", self.k))
        self.assertIsNotNone(attributed_statement("Kicillof: Milei «adultera la historia»", self.k))

    def test_candidate_as_addressee_or_entourage_is_not_his_statement(self):
        self.assertIsNone(attributed_statement("Intendentes a Kicillof: “Si logramos las reelecciones ganamos”", self.k))
        self.assertIsNone(attributed_statement("Fuerte crítica de Pareja a Kicillof: “No a las reelecciones”", self.k))
        self.assertIsNone(attributed_statement("Un ministro de Kicillof dijo que el candidato saldrá de las PASO", self.k))
        self.assertIsNone(attributed_statement("Marcelo Peretta contra el laboratorio de Kicillof: “Es un conchabo”", self.k))

    def test_headline_labels_are_not_quotes(self):
        self.assertIsNone(attributed_statement("Javier Milei y sus medidas, EN VIVO: el Gobierno destacó a Caputo", aliases_for({"name": "Javier Milei"})))
        self.assertIsNone(attributed_statement("Sánchez: medidas aprobadas en campaña y reformas pendientes", self.s))

    def test_verb_pattern(self):
        self.assertIsNotNone(attributed_statement("En una reunión con jueces, Kicillof dijo que buscará cubrir vacantes", self.k))
        self.assertIsNotNone(attributed_statement("Sánchez dice que PP y Vox no aceptarán el resultado", self.s))

    def test_common_surname_only_at_start(self):
        self.assertIsNone(attributed_statement('Ara Sánchez: "No están solas"', self.s))
        self.assertIsNone(attributed_statement('Gabriel Cruz, sobre los bailes de Sánchez: "No creo que moleste"', self.s))
        self.assertIsNotNone(attributed_statement('Pedro Sánchez: "La vivienda será nuestra gran prioridad"', self.s))

    def test_flags(self):
        self.assertTrue(is_flag("Kicillof da marcha atrás y devuelve el descuento a docentes", self.k))
        self.assertTrue(is_flag("La campaña finaliza sin el kit del A400M que Sánchez anunció como medida estrella", self.s))
        self.assertFalse(is_flag('Loles León en el mitin de Sánchez: "Ni un paso atrás"', self.s))
        self.assertFalse(is_flag("El peronismo apuesta a que el Papa exponga las contradicciones de Milei", self.k))

    def test_fact_check_outlets_are_flags(self):
        self.assertTrue(is_fact_check({"url": "https://www.newtral.es/zona-verificacion/foo/20261125/", "outlet": "Newtral"}))
        self.assertTrue(is_fact_check({"url": "https://maldita.es/desinfo/20261126/bar/", "outlet": "Maldita.es"}))
        self.assertTrue(is_fact_check({"url": "https://chequeado.com/ultimas-noticias/un-chequeo/", "outlet": "Chequeado"}))
        self.assertFalse(is_fact_check({"url": "https://www.eldiario.es/espana/nota/", "outlet": "elDiario.es"}))
        # Titular atribuido de un verificador: es señalamiento, no declaración limpia.
        ms = [
            _m(1, 'Pedro Sánchez: "La vivienda será nuestra gran prioridad"', outlet="Newtral",
               source="rss_media"),
        ]
        ms[0]["url"] = "https://www.newtral.es/zona-verificacion/vivienda-sanchez/20261125/"
        p = extract_pieces(SANCHEZ, ms, TOPICS)
        self.assertEqual(len(p["flag"]), 1)
        self.assertEqual(p["flag"][0].quote, "La vivienda será nuestra gran prioridad")
        self.assertEqual(p["attributed"], [])
        # Un medio común con el mismo titular sigue siendo declaración atribuida.
        regular = [_m(2, 'Pedro Sánchez: "La vivienda será nuestra gran prioridad"', outlet="El País")]
        regular[0]["url"] = "https://elpais.com/espana/nota/"
        p2 = extract_pieces(SANCHEZ, regular, TOPICS)
        self.assertEqual(len(p2["attributed"]), 1)
        self.assertEqual(p2["flag"], [])

    def test_clean_title_drops_outlet_suffix(self):
        self.assertEqual(clean_title("Kicillof: “Hola mundo de prueba larga” - Infobae", "Infobae"), "Kicillof: “Hola mundo de prueba larga”")

    def test_extract_groups_copies_and_own_accounts(self):
        ms = [
            _m(1, 'Kicillof: "Vamos a devolver los descuentos a los docentes"', outlet="A"),
            _m(2, 'Kicillof: "Vamos a devolver los descuentos a los docentes" - B', outlet="B", days_ago=0.9),
            _m(3, "Hoy firmamos el aumento docente", source="x", rel="own", content="Hoy firmamos el aumento docente"),
            _m(4, "Kicillof da marcha atrás con los descuentos docentes"),
            _m(5, "Una nota cualquiera sobre la provincia"),
        ]
        p = extract_pieces(KICI, ms, TOPICS)
        self.assertEqual(len(p["attributed"]), 1)
        self.assertEqual(p["attributed"][0].copies, 2)
        self.assertEqual(p["own"][0].text, "Hoy firmamos el aumento docente")
        self.assertEqual(len(p["flag"]), 1)
        self.assertEqual(len(p["context"]), 1)

    def test_third_party_posts_on_x_are_ignored(self):
        p = extract_pieces(KICI, [_m(1, 'Kicillof: "no vamos a endeudarnos"', source="x")], TOPICS)
        self.assertEqual(sum(len(v) for v in p.values()), 0)


class PairsTest(unittest.TestCase):
    def test_pairs_same_topic_new_vs_old(self):
        ms = [
            _m(1, 'Kicillof: "No vamos a tomar deuda en dólares bajo ningún concepto"', days_ago=20),
            _m(2, "Kicillof pidió autorización para tomar deuda en dólares por la emergencia", days_ago=0.5),
            _m(3, 'Kicillof: "La universidad pública es un orgullo"', days_ago=10, topic=T_EDU),
        ]
        st = extract_pieces(KICI, ms, TOPICS)
        statements = st["own"] + st["attributed"]
        pairs = candidate_pairs(statements, now=NOW, new_since=NOW - timedelta(days=2))
        self.assertEqual(len(pairs), 1)
        self.assertIn("deuda", pairs[0].shared)
        self.assertTrue(pairs[0].earlier.published_at < pairs[0].later.published_at)

    def test_restatement_and_min_gap(self):
        ms = [
            _m(1, 'Kicillof: "Argentina no va a ser el patio trasero de nadie"', days_ago=5),
            _m(2, 'Kicillof en Punta Indio: "Argentina no va a ser el patio trasero de nadie"', days_ago=0.5),
            _m(3, 'Kicillof en la costa: "La Argentina no va a ser el patio trasero de nadie"', days_ago=1),
        ]
        st = extract_pieces(KICI, ms, TOPICS)
        pairs = candidate_pairs(st["attributed"], now=NOW, new_since=NOW - timedelta(days=2), min_gap_days=2)
        self.assertEqual(pairs, [])

    def test_flag_story_counts_once(self):
        ms = [
            _m(1, "Docentes le exigen a Kicillof que devuelva los descuentos por el paro", days_ago=3, topic=T_EDU),
            _m(2, "Kicillof da marcha atrás y devuelve el descuento a docentes por el paro", days_ago=2, topic=T_EDU),
            _m(3, "Acorralado por los gremios, Kicillof se arrepintió y devolverá el descuento a docentes", days_ago=2, topic=T_EDU),
        ]
        p = extract_pieces(KICI, ms, TOPICS)
        fc = flag_contexts(p["flag"], p["context"], new_since=NOW - timedelta(days=5))
        self.assertEqual(len(fc), 1)
        self.assertEqual(fc[0].flag.copies, 2)
        self.assertEqual([e.id for e in fc[0].earlier], [ms[0]["id"]])


class GroundingTest(unittest.TestCase):
    PIECES = {
        "s1": {"ref": "s1", "fecha": "2026-11-05", "texto": 'Kicillof: "No vamos a tomar deuda"'},
        "s2": {"ref": "s2", "fecha": "2026-11-24", "texto": "Kicillof pidió deuda por US$ 1.000 millones"},
        "s3": {"ref": "s3", "fecha": "2026-11-12", "texto": "Kicillof da marcha atrás con los descuentos"},
    }

    def _f(self, **kw):
        base = {"item": "p1", "verdict": "contradiccion", "severity": "alto", "topic": "Deuda", "antes_ref": "s1",
                "despues_ref": "s2", "why": "Dijo que no tomaría deuda y 19 días después pidió US$ 1.000 millones.",
                "next_step": "Preparar una explicación.", "refs": ["s1", "s2"]}
        base.update(kw)
        return base

    def _ground(self, findings):
        return ground_findings({"findings": findings}, pieces_by_ref=self.PIECES,
                               pairs={"p1": ("s1", "s2")}, flags={"s3": []})

    def test_valid_pair_kept_with_days(self):
        kept, dropped, clean = self._ground([self._f()])
        self.assertEqual(len(kept), 1, dropped)
        self.assertEqual(kept[0]["origin"], "par")

    def test_drops(self):
        cases = {
            "par_alterado": self._f(antes_ref="s3"),
            "item_desconocido": self._f(item="p9"),
            "cifra_sin_respaldo": self._f(why="Pidió US$ 5.000 millones."),
            "accion_prohibida": self._f(next_step="Activar bots para responder."),
            "veredicto_invalido": self._f(verdict="grave"),
        }
        for reason, f in cases.items():
            kept, dropped, _ = self._ground([f])
            self.assertEqual(kept, [], reason)
            self.assertEqual(dropped[0]["reason"], reason)

    def test_clean_and_tension(self):
        kept, _d, clean = self._ground([self._f(verdict="sin_contradiccion")])
        self.assertEqual((kept, clean), ([], 1))
        kept, _d, _c = self._ground([self._f(verdict="tension", severity="alto")])
        self.assertEqual(kept[0]["severity"], "bajo")

    def test_flag_without_prior_piece(self):
        kept, dropped, _ = self._ground([self._f(item="s3", verdict="cambio_de_postura", antes_ref="", despues_ref="s3",
                                                 why="Los medios dicen que dio marcha atrás.", refs=["s3"])])
        self.assertEqual(len(kept), 1, dropped)
        self.assertIsNone(kept[0]["antes_ref"])

    def test_broken_promise_needs_prior_dated_source(self):
        promise = dict(verdict="promesa_incumplida", severity="medio", why="La nota dice que no cumplió lo anunciado.")
        # Señalamiento sin pieza previa: no se publica.
        kept, dropped, _ = self._ground([self._f(item="s3", antes_ref="", despues_ref="s3", refs=["s3"], **promise)])
        self.assertEqual(kept, [])
        self.assertEqual(dropped[0]["reason"], "promesa_sin_fuente_previa")
        # Pieza previa con fecha posterior a la nota: tampoco.
        pieces = dict(self.PIECES, s4={"ref": "s4", "fecha": "2026-11-20", "texto": "Kicillof anunció que devolverá el descuento"})
        kept, dropped, _ = ground_findings(
            {"findings": [self._f(item="s3", antes_ref="s4", despues_ref="s3", refs=["s4", "s3"], **promise)]},
            pieces_by_ref=pieces, pairs={}, flags={"s3": ["s4"]})
        self.assertEqual((kept, dropped[0]["reason"]), ([], "promesa_sin_fuente_previa"))
        # Con la promesa en una pieza anterior: se publica.
        kept, dropped, _ = self._ground([self._f(**promise)])
        self.assertEqual(len(kept), 1, dropped)
        self.assertEqual((kept[0]["kind"], kept[0]["antes_ref"]), ("promesa_incumplida", "s1"))

    def test_schema_is_strict(self):
        schema = build_schema()
        item = schema["properties"]["findings"]["items"]
        self.assertFalse(item["additionalProperties"])
        self.assertIn("sin_contradiccion", item["properties"]["verdict"]["enum"])


def _contradiction_pack():
    return [
        _m(1, 'Kicillof: "No vamos a tomar deuda en dólares bajo ningún concepto"', days_ago=20),
        _m(2, 'Kicillof: "La educación pública es prioridad absoluta"', days_ago=15, topic=T_EDU),
        _m(3, 'Kicillof: "Vamos a cuidar a los jubilados bonaerenses"', days_ago=12, topic=T_OTR),
        _m(4, "Kicillof pidió autorización para tomar deuda en dólares por la emergencia", days_ago=0.5),
    ]


class ScanTest(unittest.TestCase):
    def test_insufficient_data_says_so_and_skips_model(self):
        client = FakeClient()
        res = scan_candidate(candidate=KICI, data={"mentions": _contradiction_pack()[:2], "topics": TOPICS},
                             settings=_settings(min_statements=10), llm=InconsistencyLLM(_settings(), client=client),
                             budget_left=1, now=NOW)
        self.assertEqual(res["scan"]["status"], "insufficient")
        self.assertIn("pocas declaraciones de Axel Kicillof", res["scan"]["reason"])
        self.assertEqual(client.calls, [])
        self.assertEqual(res["alerts"], [])

    def test_alert_quotes_come_from_data_not_model(self):
        def answer(user):
            return [{"item": "p1", "verdict": "contradiccion", "severity": "alto", "topic": "Deuda en dólares",
                     "antes_ref": "s1", "despues_ref": "s2",
                     "why": "Antes dijo que no tomaría deuda en dólares; ahora pide autorización para hacerlo.",
                     "next_step": "Preparar una explicación de la emergencia.", "refs": ["s1", "s2"]}]

        client = FakeClient(fn=answer)
        settings = _settings(min_statements=3)
        mentions = _contradiction_pack()
        mentions[2]["published_at"] = (NOW - timedelta(days=9)).isoformat()
        res = scan_candidate(candidate=KICI, data={"mentions": mentions, "topics": TOPICS}, settings=settings,
                             llm=InconsistencyLLM(settings, client=client), budget_left=1, now=NOW)
        self.assertEqual(len(res["alerts"]), 1, res["scan"])
        a = res["alerts"][0]
        self.assertEqual(a["earlier"]["text"], 'Kicillof: "No vamos a tomar deuda en dólares bajo ningún concepto"')
        self.assertEqual(a["later"]["url"], "https://example.org/4")
        self.assertEqual(a["days_between"], 20)
        self.assertNotIn("example.org", client.calls[0])  # el modelo no ve URLs ni ids
        self.assertNotIn(mentions[0]["id"], client.calls[0])
        self.assertIn(alert_key("par", mentions[0]["id"], mentions[3]["id"]), res["scan"]["judged_keys"])

    def test_cost_cap_skips_call(self):
        client = FakeClient()
        settings = _settings(max_cost_per_call_usd=0.0)
        res = scan_candidate(candidate=KICI, data={"mentions": _contradiction_pack(), "topics": TOPICS}, settings=settings,
                             llm=InconsistencyLLM(settings, client=client), budget_left=1, now=NOW)
        self.assertEqual(res["scan"]["status"], "skipped")
        self.assertEqual(client.calls, [])


class RunTest(unittest.TestCase):
    def test_writes_alerts_once_and_respects_frequency(self):
        store = MemoryStore([KICI], _contradiction_pack(), TOPICS)
        client = FakeClient(findings=[{"item": "p1", "verdict": "cambio_de_postura", "severity": "medio", "topic": "Deuda",
                                       "antes_ref": "s1", "despues_ref": "s2", "why": "Cambió de postura sobre la deuda.",
                                       "next_step": "Monitorear.", "refs": ["s1", "s2"]}])
        settings = _settings()
        out = run_inconsistency(store=store, settings=settings, llm=InconsistencyLLM(settings, client=client), now=NOW)
        self.assertEqual(out.candidates[0].alerts_new, 1)
        self.assertEqual(len(store.alerts), 1)
        self.assertEqual(store.alerts[0]["status"], "new")
        again = run_inconsistency(store=store, settings=settings, llm=InconsistencyLLM(settings, client=client),
                                  now=NOW + timedelta(hours=1))
        self.assertEqual(again.candidates[0].status, "skipped_recent")
        later = run_inconsistency(store=store, settings=settings, llm=InconsistencyLLM(settings, client=client),
                                  now=NOW + timedelta(hours=7))
        self.assertEqual(later.candidates[0].pairs_checked, 0)  # ya juzgado: no se vuelve a pagar
        self.assertEqual(len(client.calls), 1)

    def test_error_is_isolated(self):
        store = MemoryStore([KICI, {**SANCHEZ, "id": "x"}], _contradiction_pack(), TOPICS)
        store.load_window = mock.Mock(side_effect=[RuntimeError("boom"), {"mentions": [], "topics": []}])
        out = run_inconsistency(store=store, settings=_settings(), llm=InconsistencyLLM(_settings(), client=FakeClient()), now=NOW)
        self.assertEqual([c.status for c in out.candidates], ["error", "insufficient"])


class SettingsTest(unittest.TestCase):
    def test_requires_classifier_role_and_hides_secrets(self):
        with self.assertRaises(InconsistencySettingsError):
            InconsistencySettings.from_env({"CLASSIFIER_DATABASE_URL": "postgresql://pulso_collector@h/db", "LLM_API_KEY": "k"})
        s = InconsistencySettings.from_env({"CLASSIFIER_DATABASE_URL": "postgresql://pulso_classifier:pw@h/db",
                                            "LLM_API_KEY": "sk-secret"})
        self.assertNotIn("sk-secret", repr(s))
        self.assertNotIn("pw", repr(s))
        self.assertEqual(s.every_hours, 6)


class CronStepTest(unittest.TestCase):
    def test_disabled_by_default(self):
        from pulso import deploy_run

        with mock.patch.dict("os.environ", {}, clear=True), mock.patch.object(deploy_run, "run_command") as rc, \
                mock.patch.object(deploy_run, "log") as lg:
            self.assertIsNone(deploy_run.run_inconsistency(["--candidate", "milei"]))
        rc.assert_not_called()
        lg.assert_called_with(event="inconsistency_skipped", reason="disabled")

    def test_enabled_runs_module_without_collector_credentials(self):
        from pulso import deploy_run

        env = {"PULSO_INCONSISTENCY_ENABLED": "true", "PULSO_INCONSISTENCY_DRY_RUN": "true", "DATABASE_URL": "x",
               "META_ADS_ACCESS_TOKEN": "t", "LLM_API_KEY": "k"}
        with mock.patch.dict("os.environ", env, clear=True), mock.patch.object(deploy_run, "run_command", return_value=0) as rc:
            deploy_run.run_inconsistency(["--candidate", "milei", "--dry-run"])
        cmd = rc.call_args.args[0]
        self.assertEqual(cmd[1:], ["-m", "pulso.inconsistency", "--candidate", "milei", "--dry-run"])
        child_env = rc.call_args.kwargs["env"]
        self.assertNotIn("DATABASE_URL", child_env)
        self.assertNotIn("META_ADS_ACCESS_TOKEN", child_env)


if __name__ == "__main__":
    unittest.main()
