"""Configuración del job de anuncios de Google. Apagado por defecto."""
from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_SLUG = "axel-kicillof"

# Anunciantes de coalición en la provincia. No hay un anunciante "Kicillof"
# en el reporte oficial del 24/11/2026; no se incluye el UP nacional de 2023
# salvo que se agregue en settings.
DEFAULT_KICILLOF_ADVERTISER_IDS = (
    "AR03608428782462959617",  # FUERZA PATRIA PBA A. P. - ALIANZA
    "AR09160339148358287361",  # Partido Frente Grande Buenos Aires - Fuerza Patria PBA
    "AR09174036795497644033",  # FUERZA PATRIA
    "AR03749993292540936193",  # Unión por la Patria de la Provincia de Buenos Aires
    "AR08762597809217077249",  # Unión por la Patria de la Provincia de Buenos Aires, Argentina
    "AR12743114125521977345",  # Unión por la Patria La Plata
)
DEFAULT_KICILLOF_NAME_PATTERNS = (
    "fuerza patria pba",
    "frente grande buenos aires",
    "unión por la patria de la provincia de buenos aires",
    "union por la patria de la provincia de buenos aires",
    "unión por la patria la plata",
    "union por la patria la plata",
)
DEFAULT_SANCHEZ_NAME_PATTERNS = (
    "psoe",
    "pedro sánchez",
    "pedro sanchez",
    "partido socialista obrero",
)

# Tope propuesto para un query de BigQuery, a confirmar con dry-run cuando
# exista el proyecto. 50 GiB es un techo conservador, no un dato oficial.
DEFAULT_MAX_BYTES = 50 * 1024 ** 3


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    return int(raw)


def env_explicitly_disabled() -> bool:
    """True solo si PULSO_GOOGLE_ADS_ENABLED está en false. Si no está, manda la fila en la base."""
    raw = os.environ.get("PULSO_GOOGLE_ADS_ENABLED")
    if raw is None:
        return False
    return raw.strip().lower() in {"0", "false", "no", "off"}


@dataclass(frozen=True)
class GoogleAdsSettings:
    enabled: bool
    dry_run: bool
    max_bytes: int
    gcp_project: str | None
    # El ATC (España) queda apagado hasta que haya proyecto GCP aprobado.
    atc_enabled: bool = False

    @classmethod
    def from_env(cls, *, dry_run: bool | None = None) -> "GoogleAdsSettings":
        return cls(
            enabled=not env_explicitly_disabled(),
            dry_run=bool(dry_run) if dry_run is not None else _flag("PULSO_GOOGLE_ADS_DRY_RUN", False),
            max_bytes=_int_env("PULSO_GOOGLE_ADS_MAX_BYTES", DEFAULT_MAX_BYTES),
            gcp_project=(os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCLOUD_PROJECT") or "").strip() or None,
            atc_enabled=_flag("PULSO_GOOGLE_ADS_ATC_ENABLED", False),
        )


def defaults_for_slug(slug: str) -> dict:
    if slug == "pedro-sanchez":
        return {
            "source": "ads_transparency_center",
            "region": "ES",
            "advertiser_ids": [],
            "advertiser_name_patterns": list(DEFAULT_SANCHEZ_NAME_PATTERNS),
        }
    return {
        "source": "political_report",
        "region": "AR",
        "advertiser_ids": list(DEFAULT_KICILLOF_ADVERTISER_IDS),
        "advertiser_name_patterns": list(DEFAULT_KICILLOF_NAME_PATTERNS),
    }
