"""Título del artículo en es.wikipedia, configurable por candidato en settings."""

DEFAULT_PROJECT = "es.wikipedia"

# Título en el idioma del wiki (guiones bajos, con tilde si corresponde).
DEFAULT_ARTICLES = {
    "axel-kicillof": "Axel_Kicillof",
    "milei": "Javier_Milei",
    "pedro-sanchez": "Pedro_Sánchez",
}


def article_for(slug: str | None, settings: dict | None = None) -> str:
    raw = (settings or {}).get("article") or (settings or {}).get("wikipedia_article")
    if raw and str(raw).strip():
        return normalize_title(str(raw))
    if slug and slug in DEFAULT_ARTICLES:
        return DEFAULT_ARTICLES[slug]
    raise ValueError("wikipedia_article_faltante")


def project_for(settings: dict | None = None) -> str:
    raw = (settings or {}).get("project") or (settings or {}).get("wikipedia_project")
    if raw and str(raw).strip():
        return str(raw).strip()
    return DEFAULT_PROJECT


def normalize_title(title: str) -> str:
    value = title.strip().replace(" ", "_")
    if value.startswith("https://") or value.startswith("http://"):
        # Acepta una URL de artículo y se queda con la última parte.
        value = value.rstrip("/").split("/")[-1]
    if not value:
        raise ValueError("wikipedia_article_vacio")
    return value


def article_url(project: str, title: str) -> str:
    host = project.replace("_", "-")
    from urllib.parse import quote
    return f"https://{host}.org/wiki/{quote(title, safe='_()')}"
