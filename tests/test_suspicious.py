import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock
from uuid import uuid4

from pulso import deploy_run
from pulso.suspicious.detect import (
    SCORE_THRESHOLD,
    detect,
    fingerprint,
    mention_kind,
    normalize_text,
    profile_url,
    summarize,
)
from pulso.suspicious.__main__ import main as suspicious_main

CANDIDATE = str(uuid4())
NOW = datetime(2026, 11, 18, 15, 0, tzinfo=timezone.utc)
LONG = "Este es un texto de coordinación lo suficientemente largo como para no ser una consigna corta"


def _row(**overrides):
    row = {
        "id": str(uuid4()),
        "candidate_id": CANDIDATE,
        "source": "x",
        "url": "https://x.com/user/status/1",
        "content": "Mención puntual sobre el candidato",
        "author": "Usuario",
        "author_handle": "usuario",
        "published_at": NOW.isoformat(),
        "metrics": {},
        "account_relation": "third_party",
    }
    row.update(overrides)
    return row


def _x_metrics(*, created_days=400, followers=200, following=100, likes=2, verified=None):
    created = (NOW - timedelta(days=created_days)).isoformat()
    metrics = {
        "author_created_at": created,
        "author_followers": followers,
        "author_following": following,
        "like_count": likes,
        "repost_count": 0,
        "reply_count": 0,
    }
    if verified:
        metrics["author_verified_type"] = verified
    return metrics


class NormalizeTests(unittest.TestCase):
    def test_normalize_strips_urls_mentions_and_accents(self):
        text = "¡Hola @Kicillofok! Mirá https://ejemplo.com/nota  Áxel"
        self.assertEqual(normalize_text(text), "hola mira axel")
        self.assertEqual(fingerprint("Hola,  hola"), fingerprint("hola hola"))

    def test_profile_urls(self):
        self.assertEqual(profile_url("x", "LidiaLo86871765"), "https://x.com/LidiaLo86871765")
        self.assertEqual(profile_url("youtube", "UCabc123"), "https://www.youtube.com/channel/UCabc123")
        self.assertEqual(
            profile_url("youtube", "UCabc123", "@sarapera9140"),
            "https://www.youtube.com/@sarapera9140",
        )


class DetectionTests(unittest.TestCase):
    def test_ignores_youtube_videos_and_keeps_comments(self):
        video = _row(source="youtube", metrics={"view_count": 10}, author_handle="UCabc")
        comments = [
            _row(source="youtube", metrics={"video_id": f"vid{i}"}, author_handle="UCabc",
                 content=LONG + " uno", published_at=(NOW - timedelta(minutes=i)).isoformat())
            for i in range(1, 4)
        ]
        self.assertIsNone(mention_kind("youtube", {"view_count": 1}))
        self.assertEqual(mention_kind("youtube", {"video_id": "x"}), "comment")
        accounts = detect([video, *comments], now=NOW)
        self.assertEqual(len(accounts), 1)
        self.assertEqual(accounts[0].platform, "youtube")
        self.assertTrue(any(s.type == "self_repeat" for s in accounts[0].signals))

    def test_excludes_own_and_reference_accounts(self):
        rows = [
            _row(author_handle=f"bot{i}", content=LONG, account_relation=rel,
                 metrics=_x_metrics(), published_at=(NOW - timedelta(minutes=i)).isoformat())
            for i, rel in enumerate(("own", "reference", "own"))
        ]
        self.assertEqual(detect(rows, now=NOW), [])

    def test_self_repeat_same_author(self):
        rows = [
            _row(author_handle="repetidor", content=LONG, metrics=_x_metrics(),
                 published_at=(NOW - timedelta(minutes=i * 10)).isoformat())
            for i in range(3)
        ]
        accounts = detect(rows, now=NOW)
        self.assertEqual(len(accounts), 1)
        self.assertIn("self_repeat", {s.type for s in accounts[0].signals})
        self.assertGreaterEqual(accounts[0].score, SCORE_THRESHOLD)
        ev = accounts[0].signals[0].evidence
        self.assertTrue(ev and ev[0].mention_id and ev[0].url)

    def test_near_identical_counts_as_repeat(self):
        variants = [LONG, LONG.replace("consigna corta", "consigna brevisima"), LONG + " !"]
        rows = [
            _row(author_handle="casiigual", content=text, metrics=_x_metrics(),
                 published_at=(NOW - timedelta(minutes=i * 5)).isoformat())
            for i, text in enumerate(variants)
        ]
        accounts = detect(rows, now=NOW)
        self.assertTrue(accounts)
        self.assertTrue(any(s.type == "self_repeat" for s in accounts[0].signals))

    def test_coordination_several_authors_same_text(self):
        rows = [
            _row(author_handle=handle, author=handle, content=LONG, metrics=_x_metrics(),
                 url=f"https://x.com/{handle}/status/{i}",
                 published_at=(NOW - timedelta(minutes=i)).isoformat())
            for i, handle in enumerate(("alfa", "beta", "gamma"))
        ]
        accounts = detect(rows, now=NOW)
        self.assertEqual({a.handle for a in accounts}, {"alfa", "beta", "gamma"})
        for account in accounts:
            self.assertTrue(any(s.type == "coordination" for s in account.signals))
            self.assertGreaterEqual(account.score, 25)

    def test_short_slogan_is_not_coordination(self):
        rows = [
            _row(author_handle=handle, content="Es con Kicillof", metrics=_x_metrics(),
                 published_at=(NOW - timedelta(minutes=i)).isoformat())
            for i, handle in enumerate(("a1", "a2", "a3", "a4"))
        ]
        accounts = detect(rows, now=NOW)
        self.assertTrue(all("coordination" not in {s.type for s in a.signals} for a in accounts))

    def test_author_burst(self):
        rows = [
            _row(author_handle="rafaga", content=f"Publicación distinta número {i} sobre el tema",
                 metrics=_x_metrics(), published_at=(NOW - timedelta(minutes=i * 8)).isoformat())
            for i in range(5)
        ]
        accounts = detect(rows, now=NOW)
        self.assertTrue(accounts)
        self.assertTrue(any(s.type == "author_burst" for s in accounts[0].signals))

    def test_new_account_under_30_days(self):
        rows = [_row(author_handle="nueva", metrics=_x_metrics(created_days=10, followers=12, following=20))]
        accounts = detect(rows, now=NOW)
        self.assertEqual(len(accounts), 1)
        self.assertGreaterEqual(accounts[0].score, 25)
        self.assertTrue(any(s.type == "new_account" and s.weight == 25 for s in accounts[0].signals))

    def test_new_account_between_30_and_90_needs_another_signal(self):
        rows = [_row(author_handle="casi_nueva", metrics=_x_metrics(created_days=60, followers=40, following=40))]
        self.assertEqual(detect(rows, now=NOW), [])
        rows = [_row(author_handle="casi_nueva", author="User 1234",
                     metrics=_x_metrics(created_days=60, followers=40, following=40))]
        accounts = detect(rows, now=NOW)
        types = {s.type for s in accounts[0].signals}
        self.assertIn("new_account", types)
        self.assertIn("digit_name", types)

    def test_follow_ratio_and_digit_handle(self):
        rows = [_row(author_handle="LidiaLo86871765", author="Lidia Lopez",
                     metrics=_x_metrics(followers=5, following=400))]
        accounts = detect(rows, now=NOW)
        types = {s.type for s in accounts[0].signals}
        self.assertIn("follow_ratio", types)
        self.assertIn("digit_name", types)
        self.assertGreaterEqual(accounts[0].score, SCORE_THRESHOLD)

    def test_media_account_is_not_flagged_for_cheap_signals(self):
        rows = [_row(author_handle="clarincom", author="Clarín",
                     metrics=_x_metrics(created_days=6000, followers=3_300_000, following=400, likes=80))]
        self.assertEqual(detect(rows, now=NOW), [])

    def test_low_engagement_volume(self):
        distinct = [
            "Hoy hablé con vecinos sobre el transporte en el conurbano",
            "La discusión de fondo es el presupuesto de educación",
            "No coincido con el recorte de la obra pública en el distrito",
            "En seguridad hay que coordinar mejor con los municipios",
            "El debate de anoche dejó más preguntas que respuestas",
        ]
        rows = [
            _row(author_handle="bajoeng", content=text,
                 metrics=_x_metrics(likes=0, followers=30, following=40),
                 published_at=(NOW - timedelta(hours=i * 8)).isoformat())
            for i, text in enumerate(distinct)
        ]
        self.assertEqual(detect(rows, now=NOW), [])
        rows = [
            _row(author_handle="bajoeng9999", content=text,
                 metrics=_x_metrics(likes=0, followers=30, following=40),
                 published_at=(NOW - timedelta(hours=i * 8)).isoformat())
            for i, text in enumerate(distinct)
        ]
        accounts = detect(rows, now=NOW)
        types = {s.type for s in accounts[0].signals}
        self.assertIn("low_engagement", types)
        self.assertIn("digit_name", types)

    def test_group_burst_of_weak_accounts(self):
        rows = []
        for i, handle in enumerate(("w1aaaaaa", "w2bbbbbb", "w3cccccc", "w4dddddd", "w5eeeeee")):
            rows.append(_row(
                author_handle=handle,
                content=f"Comentario distinto {i} sin repeticion larga",
                metrics=_x_metrics(created_days=20, followers=10, following=20),
                published_at=(NOW - timedelta(minutes=i * 4)).isoformat(),
            ))
        accounts = detect(rows, now=NOW)
        self.assertEqual(len(accounts), 5)
        self.assertTrue(all(any(s.type == "group_burst" for s in a.signals) for a in accounts))
        self.assertTrue(all(any(s.type == "new_account" for s in a.signals) for a in accounts))


    def test_youtube_digit_name_uses_visible_handle_not_channel_id(self):
        # Channel ids like UC… always contain digits and must not score by themselves.
        plain = _row(source="youtube", author="@carol-d1q", author_handle="UCBEU_ksQbEqv8_9-XPbBpYw",
                     metrics={"video_id": "vid", "like_count": 3})
        self.assertEqual(detect([plain], now=NOW), [])
        numbered = _row(source="youtube", author="@sarapera9140", author_handle="UCBAZ7ieQgUszY2xgFJA4x2Q",
                        metrics={"video_id": "vid", "like_count": 5},
                        content="Un comentario distinto sobre el candidato")
        # One weak signal stays below the threshold.
        self.assertEqual(detect([numbered], now=NOW), [])
        from pulso.suspicious.detect import _Account, MentionRecord, _public_digit_count
        acc_plain = _Account(MentionRecord.from_row(plain)); acc_plain.add(MentionRecord.from_row(plain))
        acc_num = _Account(MentionRecord.from_row(numbered)); acc_num.add(MentionRecord.from_row(numbered))
        self.assertLess(_public_digit_count(acc_plain), 4)
        self.assertGreaterEqual(_public_digit_count(acc_num), 4)

    def test_single_weak_digit_signal_stays_below_threshold(self):
        rows = [_row(author_handle="user1234", metrics=_x_metrics(followers=200, following=100))]
        self.assertEqual(detect(rows, now=NOW), [])

    def test_summarize_counts_signals(self):
        rows = [
            _row(author_handle=handle, content=LONG, metrics=_x_metrics(),
                 published_at=(NOW - timedelta(minutes=i)).isoformat())
            for i, handle in enumerate(("alfa", "beta", "gamma"))
        ]
        summary = summarize(detect(rows, now=NOW))
        self.assertEqual(summary["accounts_marked"], 3)
        self.assertEqual(summary["by_signal"]["coordination"], 3)
        self.assertEqual(summary["by_platform"]["x"], 3)


class CliTests(unittest.TestCase):
    def test_cli_from_json_is_read_only(self):
        payload = [
            _row(author_handle="LidiaLo86871765", author="Lidia Lopez",
                 metrics=_x_metrics(followers=5, following=400))
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = f"{tmp}/mentions.json"
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(payload, fh)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = suspicious_main(["--from-json", path, "--dry-run"])
        text = out.getvalue()
        self.assertEqual(code, 0)
        self.assertIn("suspicious_scan", text)
        self.assertIn("suspicious_dry_run", text)
        self.assertIn("LidiaLo86871765", text)
        self.assertNotIn("suspicious_saved", text)


class SuspiciousCronIsolationTests(unittest.TestCase):
    def _main(self, env, codes):
        calls = []

        def fake(command, timeout, env=None, prefix="cron"):
            calls.append((command, env, prefix))
            return codes.pop(0)

        out = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(deploy_run, "run_command", side_effect=fake), \
             mock.patch.object(sys, "argv", ["x", "--days", "7"]), contextlib.redirect_stdout(out):
            code = deploy_run.main()
        return code, calls, out.getvalue()

    def test_disabled_by_default(self):
        code, calls, out = self._main({"DATABASE_URL": "d"}, [0])
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 1)
        self.assertIn("suspicious_skipped", out)

    def test_runs_after_classifier_and_does_not_change_exit_code(self):
        env = {"DATABASE_URL": "d", "PGPASSWORD": "p", "LLM_API_KEY": "k",
               "CLASSIFIER_DATABASE_URL": "c", "PULSO_CLASSIFY_ENABLED": "true",
               "PULSO_SUSPICIOUS_ENABLED": "true"}
        code, calls, _ = self._main(env, [1, 0, 1])
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 3)
        self.assertIn("pulso.ai.classify", calls[1][0])
        self.assertIn("pulso.suspicious", calls[2][0])
        self.assertEqual(calls[2][2], "suspicious")
        suspicious_env = calls[2][1]
        self.assertIn("DATABASE_URL", suspicious_env)
        self.assertNotIn("LLM_API_KEY", suspicious_env)
        self.assertNotIn("CLASSIFIER_DATABASE_URL", suspicious_env)

    def test_skipped_after_timeout(self):
        code, calls, out = self._main({"PULSO_SUSPICIOUS_ENABLED": "true"}, [124])
        self.assertEqual(code, 124)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("pulso.suspicious", str(calls))


if __name__ == "__main__":
    unittest.main()
