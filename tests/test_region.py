import unittest

from pulso.deploy_run import args_for_slug
from pulso.meta_ads.run import resolve_meta_ads_query
from pulso.meta_ads.settings import MetaAdsSettings
from pulso.region import allows_meta_ads_defaults, parse_candidate_slugs, profile_for
from pulso.sources.meta_ads import DEFAULT_COUNTRIES, DEFAULT_SEARCH_TERMS
from pulso.sources.rss_media import RSSSource, google_news_locale
from pulso.models import Candidate, SourceConfig, SourceName
from pulso.ai_visibility.citations import annotate_citations
from pulso.ai_visibility.prompts import SPAIN_GOVERNMENT_PROMPTS, prompts_for_slug, render_prompts
from uuid import uuid4


class RegionTests(unittest.TestCase):
    def test_default_is_argentina(self):
        profile = profile_for("axel-kicillof")
        self.assertEqual(profile.country, "AR")
        self.assertTrue(profile.show_meta_ads)
        self.assertEqual(profile_for(None).country, "AR")
        self.assertTrue(allows_meta_ads_defaults("axel-kicillof"))
        self.assertFalse(allows_meta_ads_defaults("pedro-sanchez"))

    def test_spain_profile(self):
        profile = profile_for("pedro-sanchez")
        self.assertEqual(profile.country, "ES")
        self.assertEqual(profile.timezone, "Europe/Madrid")
        self.assertEqual(profile.election_label, "Elecciones generales 29N · España")
        self.assertFalse(profile.show_meta_ads)
        self.assertEqual(profile.user_location["city"], "Madrid")


class SlugListTests(unittest.TestCase):
    def test_env_list_and_fallback(self):
        self.assertEqual(
            parse_candidate_slugs(env={"PULSO_CANDIDATES": "axel-kicillof, pedro-sanchez"}),
            ["axel-kicillof", "pedro-sanchez"],
        )
        self.assertEqual(
            parse_candidate_slugs(env={"PULSO_CANDIDATE": "axel-kicillof"}),
            ["axel-kicillof"],
        )
        self.assertEqual(
            parse_candidate_slugs(
                env={"PULSO_CANDIDATES": "a,b", "PULSO_CANDIDATE": "ignored"},
            ),
            ["a", "b"],
        )
        self.assertEqual(
            parse_candidate_slugs(
                env={"PULSO_CANDIDATES": "a,b"},
                argv=["--days", "7", "--candidate", "solo"],
            ),
            ["solo"],
        )
        self.assertEqual(parse_candidate_slugs(env={}), [])
        self.assertEqual(args_for_slug(["--days", "7"], "pedro-sanchez"),
                         ["--candidate", "pedro-sanchez", "--days", "7"])
        self.assertEqual(args_for_slug(["--candidate", "old", "--days", "7"], "pedro-sanchez"),
                         ["--candidate", "pedro-sanchez", "--days", "7"])


class GoogleNewsLocaleTests(unittest.TestCase):
    def test_defaults_to_argentina(self):
        cfg = SourceConfig(candidate_id=uuid4(), source="google_news", enabled=True, interval_seconds=1200)
        self.assertEqual(google_news_locale(cfg, "axel-kicillof")["gl"], "AR")
        feeds = RSSSource(SourceName.NEWS, None).feeds(
            Candidate(id=uuid4(), slug="axel-kicillof", name="Axel Kicillof", keywords=["Kicillof"]),
            cfg,
        )
        self.assertIn("gl=AR", feeds[0])
        self.assertIn("hl=es-419", feeds[0])

    def test_spain_profile_and_settings_override(self):
        cfg = SourceConfig(candidate_id=uuid4(), source="google_news", enabled=True, interval_seconds=1200)
        locale = google_news_locale(cfg, "pedro-sanchez")
        self.assertEqual(locale, {"hl": "es", "gl": "ES", "ceid": "ES:es"})
        override = SourceConfig(
            candidate_id=cfg.candidate_id, source="google_news", enabled=True, interval_seconds=1200,
            settings={"hl": "es-ES", "gl": "ES", "ceid": "ES:es"},
        )
        self.assertEqual(google_news_locale(override, "pedro-sanchez")["hl"], "es-ES")
        feeds = RSSSource(SourceName.NEWS, None).feeds(
            Candidate(id=uuid4(), slug="pedro-sanchez", name="Pedro Sánchez", keywords=["Pedro Sánchez"]),
            override,
        )
        self.assertIn("gl=ES", feeds[0])
        self.assertIn("hl=es-ES", feeds[0])
        self.assertIn("Pedro", feeds[0])


class CitationsCountryTests(unittest.TestCase):
    def test_spain_keeps_spanish_media_and_drops_argentina(self):
        rows = annotate_citations([
            {"url": "https://elpais.com/espana/2026-11-24/sanchez.html"},
            {"url": "https://www.rtve.es/noticias/20261124/sanchez/"},
            {"url": "https://www.lanacion.com.ar/politica/nota"},
            {"url": "https://elpais.com/argentina/2026-11-16/milei-paso.html"},
        ], country="ES")
        by_url = {r["url"]: r for r in rows}
        self.assertTrue(by_url["https://elpais.com/espana/2026-11-24/sanchez.html"]["kept"])
        self.assertTrue(by_url["https://www.rtve.es/noticias/20261124/sanchez/"]["kept"])
        self.assertFalse(by_url["https://www.lanacion.com.ar/politica/nota"]["kept"])
        self.assertFalse(by_url["https://elpais.com/argentina/2026-11-16/milei-paso.html"]["kept"])


class SpainPromptsTests(unittest.TestCase):
    def test_ten_unique_questions(self):
        self.assertEqual(len(SPAIN_GOVERNMENT_PROMPTS), 10)
        self.assertEqual(prompts_for_slug("pedro-sanchez"), SPAIN_GOVERNMENT_PROMPTS)
        self.assertIsNone(prompts_for_slug("axel-kicillof"))
        rendered = render_prompts("Pedro Sánchez", SPAIN_GOVERNMENT_PROMPTS)
        self.assertTrue(any("29 de noviembre de 2026" in row["text"] for row in rendered))
        self.assertTrue(any("Feijóo" in row["text"] for row in rendered))
        self.assertFalse(any("Milei" in row["text"] for row in rendered))


class MetaQueryGuardTests(unittest.TestCase):
    def test_other_slug_does_not_get_kicillof_defaults(self):
        settings = MetaAdsSettings(dry_run=True)
        query, enabled, reason = resolve_meta_ads_query("pedro-sanchez", settings, None)
        self.assertIsNone(query)
        self.assertEqual(reason, "region_disabled")
        query, enabled, reason = resolve_meta_ads_query("otro-candidato", settings, None)
        self.assertIsNone(query)
        self.assertEqual(reason, "defaults_not_allowed")
        query, enabled, reason = resolve_meta_ads_query("axel-kicillof", settings, None)
        self.assertIsNotNone(query)
        self.assertIsNone(reason)
        self.assertEqual(tuple(query.search_terms), DEFAULT_SEARCH_TERMS)
        self.assertEqual(tuple(query.ad_reached_countries), DEFAULT_COUNTRIES)
        # Settings without terms/countries still don't inherit Kicillof for another slug.
        query, enabled, reason = resolve_meta_ads_query(
            "otro-candidato",
            settings,
            {"enabled": True, "search_terms": None, "ad_reached_countries": None},
        )
        self.assertIsNone(query)
        self.assertEqual(reason, "missing_query_settings")


if __name__ == "__main__":
    unittest.main()
