"""Perfil regional por candidato, sin exigir un cambio de esquema.

El default es Argentina (el candidato demo original). Los overrides viven
acá y, cuando aplica, en settings JSON (p. ej. locale de Google News).
"""
from __future__ import annotations

from dataclasses import dataclass
from zoneinfo import ZoneInfo

DEFAULT_SLUG = "axel-kicillof"


@dataclass(frozen=True)
class RegionProfile:
    country: str
    country_name: str
    timezone: str
    locale: str
    tz_label: str
    election_label: str
    google_news_hl: str
    google_news_gl: str
    google_news_ceid: str
    user_location: dict[str, str]
    language_style: str
    show_meta_ads: bool
    citation_country: str

    @property
    def zone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


DEFAULT_PROFILE = RegionProfile(
    country="AR",
    country_name="Argentina",
    timezone="America/Argentina/Buenos_Aires",
    locale="es-AR",
    tz_label="hora de Argentina",
    election_label="Elecciones 2027 · Argentina",
    google_news_hl="es-419",
    google_news_gl="AR",
    google_news_ceid="AR:es-419",
    user_location={"country": "AR", "city": "Buenos Aires", "region": "Buenos Aires"},
    language_style="rioplatense",
    show_meta_ads=True,
    citation_country="AR",
)

SPAIN_PROFILE = RegionProfile(
    country="ES",
    country_name="España",
    timezone="Europe/Madrid",
    locale="es-ES",
    tz_label="hora de España",
    election_label="Elecciones generales 29N · España",
    google_news_hl="es",
    google_news_gl="ES",
    google_news_ceid="ES:es",
    user_location={"country": "ES", "city": "Madrid", "region": "Madrid"},
    language_style="spain",
    show_meta_ads=False,
    citation_country="ES",
)

PROFILES: dict[str, RegionProfile] = {
    "pedro-sanchez": SPAIN_PROFILE,
}


def profile_for(slug: str | None) -> RegionProfile:
    if slug and slug in PROFILES:
        return PROFILES[slug]
    return DEFAULT_PROFILE


def allows_meta_ads_defaults(slug: str | None) -> bool:
    """Solo el candidato demo original puede usar los defaults de Kicillof/AR."""
    return (slug or "") == DEFAULT_SLUG


def parse_candidate_slugs(*, env: dict | None = None, argv: list[str] | None = None) -> list[str]:
    """Lista de slugs: --candidate en el CLI gana; si no, PULSO_CANDIDATES o PULSO_CANDIDATE.

    PULSO_CANDIDATES es una lista separada por comas. Se ignoran vacíos y se
    conservan el orden y la primera aparición de cada slug.
    """
    import os

    environ = env if env is not None else os.environ
    args = list(argv or [])
    if "--candidate" in args:
        index = args.index("--candidate")
        if index + 1 < len(args) and not args[index + 1].startswith("-"):
            slug = args[index + 1].strip()
            return [slug] if slug else []
    raw = (environ.get("PULSO_CANDIDATES") or environ.get("PULSO_CANDIDATE") or "")
    slugs: list[str] = []
    seen: set[str] = set()
    for part in str(raw).split(","):
        slug = part.strip()
        if not slug or slug in seen:
            continue
        seen.add(slug)
        slugs.append(slug)
    return slugs
