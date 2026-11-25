import json
import os
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path
from unittest.mock import patch

from pulso.google_ads.atc import ads_from_atc_rows, atc_skip_reason, estimated_bytes_ok
from pulso.google_ads.parse import matches_advertiser, parse_atc_row, parse_bucket, parse_political_row
from pulso.google_ads.political_csv import ads_from_csv_path, ads_from_zip
from pulso.google_ads.run import resolve_query, resolve_run, run_google_ads
from pulso.google_ads.settings import GoogleAdsSettings, defaults_for_slug
from pulso.google_ads.__main__ import main as google_main

ROOT = Path(__file__).resolve().parent
CSV = ROOT / "fixtures" / "google_political_ads_creatives.csv"
ATC = ROOT / "fixtures" / "google_atc_example.json"
SNAP = ROOT / "fixtures" / "google_political_ads_snapshot.json"


class ParseTests(unittest.TestCase):
    def test_impression_buckets(self):
        self.assertEqual(parse_bucket("1000000-1250000")[:2], (1_000_000, 1_250_000))
        self.assertEqual(parse_bucket("80000-90000")[:2], (80_000, 90_000))
        self.assertEqual(parse_bucket("≥10000000")[:2], (10_000_000, None))
        self.assertEqual(parse_bucket("<=10k")[:2], (None, 10_000))
        self.assertEqual(parse_bucket("<1000")[:2], (None, 999))
        self.assertEqual(parse_bucket(">1M")[:2], (1_000_001, None))

    def test_official_csv_fuerza_patria_pba(self):
        ads = ads_from_csv_path(
            CSV,
            region="AR",
            advertiser_ids=["AR03608428782462959617"],
            name_patterns=[],
        )
        self.assertGreaterEqual(len(ads), 1)
        video = next(ad for ad in ads if ad.ad_id == "CR04352157551505178625")
        self.assertEqual(video.advertiser_name, "FUERZA PATRIA PBA A. P. - ALIANZA")
        self.assertEqual(video.ad_type, "VIDEO")
        self.assertEqual(video.impressions_lower, 1_000_000)
        self.assertEqual(video.impressions_upper, 1_250_000)
        self.assertEqual(video.spend_currency, "ARS")
        self.assertEqual(video.spend_lower, 2_000_000)
        self.assertEqual(video.spend_upper, 2_500_000)
        self.assertEqual(video.date_range_start, "2025-10-20")
        self.assertEqual(video.last_served_at, "2025-10-31T10:57")
        self.assertTrue(video.ad_url.startswith("https://adstransparency.google.com/"))
        self.assertEqual(video.source, "political_report")

    def test_region_filter_excludes_other_countries(self):
        ads = ads_from_csv_path(
            CSV, region="ES", advertiser_ids=[], name_patterns=["fuerza patria"],
        )
        self.assertEqual(ads, [])

    def test_name_pattern_and_id_match(self):
        self.assertTrue(matches_advertiser(
            "FUERZA PATRIA PBA A. P. - ALIANZA", "AR03608428782462959617",
            advertiser_ids=["AR03608428782462959617"], name_patterns=[],
        ))
        self.assertTrue(matches_advertiser(
            "Partido Frente Grande Buenos Aires - Fuerza Patria PBA", "x",
            advertiser_ids=[], name_patterns=["frente grande buenos aires"],
        ))
        self.assertFalse(matches_advertiser(
            "LA LIBERTAD AVANZA", "AR1",
            advertiser_ids=["AR2"], name_patterns=["fuerza patria"],
        ))

    def test_atc_example_is_labeled_and_parses_spain_region(self):
        payload = json.loads(ATC.read_text())
        self.assertIn("EJEMPLO", payload["note"])
        ad = parse_atc_row(payload["rows"][0], region="ES")
        self.assertIsNotNone(ad)
        self.assertEqual(ad.source, "ads_transparency_center")
        self.assertEqual(ad.advertiser_name, "Ejemplo Anunciante ES")
        self.assertEqual(ad.impressions_lower, 10_000)
        self.assertEqual(ad.date_range_end, "2025-06-15")
        self.assertIsNone(parse_atc_row(payload["rows"][0], region="AR"))

    def test_snapshot_file_is_official(self):
        snap = json.loads(SNAP.read_text())
        self.assertIn("political-csv", snap["source"])
        self.assertEqual(snap["report_data_updated_time_pt"], "2026-11-24 16:04:21")
        pba = next(a for a in snap["advertisers"] if a["advertiser_id"] == "AR03608428782462959617")
        self.assertEqual(pba["creative_count_in_report"], 409)


class ZipAndRunTests(unittest.TestCase):
    def test_ads_from_zip_reads_updated_stamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bundle.zip"
            with zipfile.ZipFile(path, "w") as zf:
                zf.writestr(
                    "google-political-ads-updated.csv",
                    "Report_Data_Updated_Time (PT)\n2026-11-24 16:04:21\n",
                )
                zf.write(CSV, "google-political-ads-creative-stats.csv")
            ads, updated = ads_from_zip(
                path,
                region="AR",
                advertiser_ids=["AR03608428782462959617"],
                name_patterns=[],
            )
            self.assertEqual(updated, "2026-11-24 16:04:21")
            self.assertGreaterEqual(len(ads), 1)

    def test_defaults_split_by_candidate(self):
        ar = defaults_for_slug("axel-kicillof")
        es = defaults_for_slug("pedro-sanchez")
        self.assertEqual(ar["source"], "political_report")
        self.assertEqual(ar["region"], "AR")
        self.assertIn("AR03608428782462959617", ar["advertiser_ids"])
        self.assertEqual(es["source"], "ads_transparency_center")
        self.assertEqual(es["region"], "ES")

    def test_run_political_dry_run_from_csv(self):
        settings = GoogleAdsSettings(enabled=True, dry_run=True, max_bytes=1, gcp_project=None)
        query = resolve_query("axel-kicillof")
        result = run_google_ads(
            query=query, settings=settings, csv_path=CSV, today=date(2026, 11, 24),
        )
        self.assertEqual(result["source"], "political_report")
        self.assertGreaterEqual(result["items_found"], 1)
        self.assertTrue(all(ad.source == "political_report" for ad in result["ads"]))

    def test_atc_skips_without_gcp_project(self):
        self.assertIsNotNone(atc_skip_reason(gcp_project=None))
        self.assertIsNone(atc_skip_reason(gcp_project="pulso-demo"))
        settings = GoogleAdsSettings(enabled=True, dry_run=False, max_bytes=1, gcp_project=None)
        query, reason = resolve_run("pedro-sanchez", settings)
        self.assertEqual(query.source, "ads_transparency_center")
        self.assertIn("proyecto de Google Cloud", reason or "")

    def test_atc_example_rows_via_run(self):
        settings = GoogleAdsSettings(enabled=True, dry_run=True, max_bytes=1, gcp_project=None)
        query = resolve_query("pedro-sanchez")
        # El ejemplo no coincide con los patrones de PSOE: 0 resultados, no se inventa un match.
        rows = json.loads(ATC.read_text())["rows"]
        result = run_google_ads(query=query, settings=settings, atc_rows=rows)
        self.assertEqual(result["items_found"], 0)
        # Sin filtro de nombre, el parser acepta el ejemplo (solo tests de forma).
        parsed = ads_from_atc_rows(rows, region="ES", advertiser_ids=[], name_patterns=[])
        self.assertEqual(len(parsed), 1)

    def test_bytes_cap(self):
        ok, err = estimated_bytes_ok(10, 50)
        self.assertTrue(ok)
        ok, err = estimated_bytes_ok(100, 50)
        self.assertFalse(ok)
        self.assertIn("tope", err or "")
        ok, err = estimated_bytes_ok(None, 50)
        self.assertFalse(ok)

    def test_cli_dry_run_from_csv(self):
        with patch.dict(os.environ, {"PULSO_GOOGLE_ADS_ENABLED": "true"}):
            code = google_main(["--dry-run", "--from-csv", str(CSV), "--candidate", "axel-kicillof"])
        self.assertEqual(code, 0)

    def test_cli_sanchez_skips_without_project(self):
        env = {"PULSO_GOOGLE_ADS_ENABLED": "true"}
        env.pop("GOOGLE_CLOUD_PROJECT", None)
        with patch.dict(os.environ, env, clear=False):
            os.environ.pop("GOOGLE_CLOUD_PROJECT", None)
            os.environ.pop("GCLOUD_PROJECT", None)
            code = google_main(["--candidate", "pedro-sanchez"])
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
