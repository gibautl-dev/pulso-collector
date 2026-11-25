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
        }
        out = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(deploy_run, "list_media_enabled_slugs", return_value=["axel-kicillof", "milei", "pedro-sanchez"]), \
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
        self.assertGreaterEqual(count_for("axel-kicillof", "pulso.google_ads"), 1)
        self.assertGreaterEqual(count_for("axel-kicillof", "pulso.ai_visibility"), 1)
        self.assertIn("cron_post_steps_skipped", out.getvalue())
        self.assertIn("db_rival_media_only", out.getvalue())
        self.assertIn("milei", "\n".join(modules))


if __name__ == "__main__":
    unittest.main()
