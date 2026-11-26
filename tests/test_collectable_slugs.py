import contextlib
import io
import os
import sys
import unittest
from unittest import mock

from pulso import deploy_run
from pulso.region import merge_collectable_slugs


class MergeCollectableSlugsTests(unittest.TestCase):
    def test_keeps_env_order_and_appends_db_extras(self):
        self.assertEqual(
            merge_collectable_slugs(
                ["axel-kicillof", "pedro-sanchez"],
                ["milei", "axel-kicillof", "  "],
            ),
            ["axel-kicillof", "pedro-sanchez", "milei"],
        )
        self.assertEqual(merge_collectable_slugs(["axel-kicillof"], None), ["axel-kicillof"])
        self.assertEqual(merge_collectable_slugs([], ["milei"]), ["milei"])

    def test_invalid_database_url_does_not_raise(self):
        self.assertEqual(deploy_run.list_media_enabled_slugs(""), [])
        self.assertEqual(deploy_run.list_media_enabled_slugs("d"), [])
        self.assertEqual(
            deploy_run.discover_collectable_slugs(["axel-kicillof"], database_url="d"),
            ["axel-kicillof"],
        )


class CronDiscoversDbRivalsTests(unittest.TestCase):
    def test_collects_db_rival_but_skips_ai_and_meta(self):
        calls = []

        def fake(command, timeout, env=None, prefix="cron"):
            calls.append((command, prefix))
            return 0

        env = {
            "DATABASE_URL": "postgresql://pulso@localhost/postgres",
            "PULSO_CANDIDATES": "axel-kicillof,pedro-sanchez",
            "PULSO_CLASSIFY_ENABLED": "true",
            "PULSO_AI_VISIBILITY_ENABLED": "true",
            "PULSO_META_ADS_ENABLED": "true",
            "PULSO_SUSPICIOUS_ENABLED": "true",
            "PULSO_CRISIS_AGENT_ENABLED": "true",
            "PULSO_WIKIPEDIA_ENABLED": "true",
        }
        out = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(deploy_run, "list_media_enabled_slugs", return_value=["axel-kicillof", "milei", "pedro-sanchez"]), \
             mock.patch.object(deploy_run, "list_collection_states", return_value={}), \
             mock.patch.object(deploy_run, "run_command", side_effect=fake), \
             mock.patch.object(sys, "argv", ["x"]), \
             contextlib.redirect_stdout(out):
            code = deploy_run.main()
        self.assertEqual(code, 0)
        collected = [
            cmd[cmd.index("--candidate") + 1]
            for cmd, prefix in calls
            if prefix == "cron" and "--candidate" in cmd
        ]
        self.assertEqual(collected, ["axel-kicillof", "pedro-sanchez", "milei"])
        modules = [" ".join(cmd) for cmd, _prefix in calls]

        def count_for(slug, module):
            return sum(1 for cmd, _p in calls if module in " ".join(cmd) and slug in cmd)

        self.assertEqual(count_for("milei", "pulso.collect_rss"), 1)
        self.assertEqual(count_for("milei", "pulso.ai.classify"), 1)
        self.assertEqual(count_for("milei", "pulso.ai_visibility"), 0)
        self.assertEqual(count_for("milei", "pulso.meta_ads"), 0)
        self.assertEqual(count_for("milei", "pulso.suspicious"), 0)
        self.assertEqual(count_for("milei", "pulso.crisis"), 0)
        self.assertEqual(count_for("milei", "pulso.google_ads"), 0)
        self.assertEqual(count_for("milei", "pulso.wikipedia"), 1)
        self.assertGreaterEqual(count_for("axel-kicillof", "pulso.wikipedia"), 1)
        self.assertGreaterEqual(count_for("axel-kicillof", "pulso.google_ads"), 1)
        self.assertGreaterEqual(count_for("axel-kicillof", "pulso.ai_visibility"), 1)
        self.assertIn("cron_post_steps_skipped", out.getvalue())
        self.assertIn("db_rival_media_only", out.getvalue())
        self.assertIn("milei", "\n".join(modules))


class CollectionPlanTests(unittest.TestCase):
    def _run(self, env_slugs, db_slugs, states, extra_env=None):
        calls = []

        def fake(command, timeout, env=None, prefix="cron"):
            calls.append((command, prefix))
            return 0

        env = {
            "DATABASE_URL": "postgresql://pulso@localhost/postgres",
            "PULSO_CANDIDATES": ",".join(env_slugs),
            "PULSO_CLASSIFY_ENABLED": "true",
            "PULSO_AI_VISIBILITY_ENABLED": "true",
            "PULSO_META_ADS_ENABLED": "true",
            "PULSO_SUSPICIOUS_ENABLED": "true",
            "PULSO_CRISIS_AGENT_ENABLED": "true",
            "PULSO_WIKIPEDIA_ENABLED": "true",
            "PULSO_GOOGLE_ADS_ENABLED": "true",
            "PULSO_DAILY_BRIEF_ENABLED": "true",
            "PULSO_INCONSISTENCY_ENABLED": "true",
        }
        if extra_env:
            env.update(extra_env)
        out = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(deploy_run, "list_media_enabled_slugs", return_value=db_slugs), \
             mock.patch.object(deploy_run, "list_collection_states", return_value=states), \
             mock.patch.object(deploy_run, "run_command", side_effect=fake), \
             mock.patch.object(sys, "argv", ["x"]), \
             contextlib.redirect_stdout(out):
            code = deploy_run.main()
        return code, calls, out.getvalue()

    @staticmethod
    def _count(calls, slug, module):
        return sum(1 for cmd, _p in calls if module in " ".join(cmd) and slug in cmd)

    def test_paused_env_slug_is_skipped_entirely(self):
        code, calls, out = self._run(
            ["axel-kicillof", "milei", "pedro-sanchez"],
            ["axel-kicillof", "milei", "pedro-sanchez"],
            {
                "axel-kicillof": {"country": "AR", "collection_mode": "full", "collection_paused": True},
                "milei": {"country": "AR", "collection_mode": "media_only", "collection_paused": True},
                "pedro-sanchez": {"country": "ES", "collection_mode": "full", "collection_paused": True},
            },
        )
        self.assertEqual(code, 0)
        self.assertEqual(self._count(calls, "axel-kicillof", "pulso.collect_rss"), 0)
        self.assertEqual(self._count(calls, "milei", "pulso.collect_rss"), 0)
        self.assertEqual(self._count(calls, "pedro-sanchez", "pulso.ai_visibility"), 0)
        self.assertIn("cron_candidate_paused", out)

    def test_full_mode_runs_post_steps_without_being_in_env(self):
        code, calls, out = self._run(
            ["axel-kicillof"],
            ["axel-kicillof", "diego-santilli"],
            {
                "axel-kicillof": {"country": "AR", "collection_mode": "full", "collection_paused": False},
                "diego-santilli": {"country": "AR", "collection_mode": "full", "collection_paused": False},
            },
        )
        self.assertEqual(code, 0)
        self.assertEqual(self._count(calls, "diego-santilli", "pulso.collect_rss"), 1)
        self.assertEqual(self._count(calls, "diego-santilli", "pulso.ai.classify"), 1)
        self.assertEqual(self._count(calls, "diego-santilli", "pulso.ai_visibility"), 1)
        self.assertEqual(self._count(calls, "diego-santilli", "pulso.meta_ads"), 1)
        self.assertEqual(self._count(calls, "diego-santilli", "pulso.suspicious"), 1)
        self.assertEqual(self._count(calls, "diego-santilli", "pulso.crisis"), 1)
        self.assertNotIn("db_rival_media_only", out)

    def test_media_only_in_env_skips_expensive_post_steps(self):
        code, calls, out = self._run(
            ["axel-kicillof", "milei"],
            ["axel-kicillof", "milei"],
            {
                "axel-kicillof": {"country": "AR", "collection_mode": "full", "collection_paused": False},
                "milei": {"country": "AR", "collection_mode": "media_only", "collection_paused": False},
            },
        )
        self.assertEqual(code, 0)
        self.assertEqual(self._count(calls, "milei", "pulso.collect_rss"), 1)
        self.assertEqual(self._count(calls, "milei", "pulso.ai.classify"), 1)
        self.assertEqual(self._count(calls, "milei", "pulso.wikipedia"), 1)
        self.assertEqual(self._count(calls, "milei", "pulso.ai_visibility"), 0)
        self.assertEqual(self._count(calls, "milei", "pulso.meta_ads"), 0)
        self.assertEqual(self._count(calls, "milei", "pulso.suspicious"), 0)
        self.assertEqual(self._count(calls, "milei", "pulso.crisis"), 0)
        self.assertIn("media_only", out)

    def test_spain_full_skips_meta_ads_by_country(self):
        code, calls, out = self._run(
            ["pedro-sanchez"],
            ["pedro-sanchez"],
            {
                "pedro-sanchez": {"country": "ES", "collection_mode": "full", "collection_paused": False},
            },
        )
        self.assertEqual(code, 0)
        self.assertEqual(self._count(calls, "pedro-sanchez", "pulso.collect_rss"), 1)
        self.assertEqual(self._count(calls, "pedro-sanchez", "pulso.ai_visibility"), 1)
        self.assertEqual(self._count(calls, "pedro-sanchez", "pulso.meta_ads"), 0)
        self.assertIn("region_disabled", out)


class CollectionHelperTests(unittest.TestCase):
    def test_effective_mode_and_pause(self):
        from pulso.collection import (
            CandidateRunPlan,
            effective_collection_mode,
            is_collection_paused,
        )
        self.assertTrue(is_collection_paused({"collection_paused": True}))
        self.assertFalse(is_collection_paused({"collection_paused": False}))
        self.assertFalse(is_collection_paused({}))
        env = ["axel-kicillof"]
        self.assertEqual(
            effective_collection_mode(CandidateRunPlan("diego-santilli", collection_mode="full"), env),
            "full",
        )
        self.assertEqual(
            effective_collection_mode(CandidateRunPlan("milei", collection_mode="media_only"), env + ["milei"]),
            "media_only",
        )
        # Sin modo en la DB se conserva el recorte de rivales descubiertos.
        self.assertEqual(
            effective_collection_mode(CandidateRunPlan("milei"), env),
            "media_only",
        )
        self.assertEqual(
            effective_collection_mode(CandidateRunPlan("axel-kicillof"), env),
            "full",
        )



if __name__ == "__main__":
    unittest.main()
