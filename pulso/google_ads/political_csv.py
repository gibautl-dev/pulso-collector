"""Descarga y filtra el ZIP oficial del Political Ads Transparency Report."""
from __future__ import annotations

import csv
import io
import sys
import tempfile
import zipfile
from collections.abc import Iterable, Iterator
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from pulso.google_ads.parse import GoogleAd, matches_advertiser, parse_political_row

OFFICIAL_ZIP_URL = (
    "https://storage.googleapis.com/political-csv/google-political-ads-transparency-bundle.zip"
)
CREATIVE_STATS_NAME = "google-political-ads-creative-stats.csv"
UPDATED_NAME = "google-political-ads-updated.csv"

csv.field_size_limit(sys.maxsize)


class GoogleAdsSourceError(RuntimeError):
    """Error al leer una fuente oficial de anuncios de Google."""


PT = ZoneInfo("America/Los_Angeles")


def parse_report_updated_at(raw: str) -> datetime | None:
    """El CSV oficial declara la hora en PT, sin offset. Devuelve naive."""
    text = (raw or "").strip()
    if not text or text.lower().startswith("report_data_updated"):
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def report_stamp_to_timestamptz(raw: str | None) -> datetime | None:
    """Interpreta el sello oficial en America/Los_Angeles (PT/PST/PDT) y lo pasa a UTC."""
    if not raw:
        return None
    naive = parse_report_updated_at(raw)
    if naive is None:
        return None
    return naive.replace(tzinfo=PT).astimezone(timezone.utc)


def official_zip_cache_path(today: date) -> Path:
    return Path(tempfile.gettempdir()) / f"pulso-google-political-ads-{today.isoformat()}.zip"


def iter_political_csv(
    handle,
    *,
    region: str,
    advertiser_ids: list[str],
    name_patterns: list[str],
) -> Iterator[GoogleAd]:
    reader = csv.DictReader(handle)
    for row in reader:
        ad = parse_political_row(row, region=region)
        if ad is None:
            continue
        if not matches_advertiser(
            ad.advertiser_name,
            ad.advertiser_id,
            advertiser_ids=advertiser_ids,
            name_patterns=name_patterns,
        ):
            continue
        yield ad


def ads_from_csv_path(
    path: Path,
    *,
    region: str,
    advertiser_ids: list[str],
    name_patterns: list[str],
) -> list[GoogleAd]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(iter_political_csv(
            handle, region=region, advertiser_ids=advertiser_ids, name_patterns=name_patterns,
        ))


def ads_from_zip(
    path: Path,
    *,
    region: str,
    advertiser_ids: list[str],
    name_patterns: list[str],
) -> tuple[list[GoogleAd], str | None]:
    updated = None
    ads: list[GoogleAd] = []
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        if UPDATED_NAME in names:
            text = zf.read(UPDATED_NAME).decode("utf-8")
            lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            if len(lines) >= 2:
                updated = lines[1]
        if CREATIVE_STATS_NAME not in names:
            raise GoogleAdsSourceError("el ZIP oficial no trae google-political-ads-creative-stats.csv")
        with zf.open(CREATIVE_STATS_NAME) as raw:
            handle = io.TextIOWrapper(raw, encoding="utf-8", newline="")
            ads = list(iter_political_csv(
                handle, region=region, advertiser_ids=advertiser_ids, name_patterns=name_patterns,
            ))
    return ads, updated


def download_official_zip(dest: Path, *, url: str = OFFICIAL_ZIP_URL, timeout: int = 300) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    req = Request(url, headers={"User-Agent": "PulsoCollector/0.3 (official political ads dataset)"})
    with urlopen(req, timeout=timeout) as resp, part.open("wb") as out:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
    part.replace(dest)
    return dest
