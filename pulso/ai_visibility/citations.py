"""Normaliza citas: dominio y filtro de fuentes ajenas a Argentina o fuera de tema.

El filtro es conservador: solo descarta cuando el origen o el tema son evidentes.
No inventa URLs. Un modelo puede marcar citas adicionales como fuera de tema,
pero no reincorpora las que este filtro ya descartó.
"""
from __future__ import annotations

from urllib.parse import urlparse

# Medios o sitios argentinos cuyo host no termina en .ar.
AR_HOSTS = {
    "clarin.com",
    "infobae.com",
    "chequeado.com",
    "ambito.com",
    "cronista.com",
    "perfil.com",
    "eldestapeweb.com",
    "a24.com",
    "c5n.com",
    "minutouno.com",
    "iprofesional.com",
    "ellitoral.com",
    "lavoz.com.ar",  # por si llega sin el sufijo completo en netloc normalizado
    "pagina12.com.ar",
    "lanacion.com.ar",
    "tn.com.ar",
    "letrap.com.ar",
    "datospba.com",
    "eldiarioar.com",
    "tiempoar.com.ar",
    "oficialista.com",
}

# Orígenes claramente no argentinos (entretenimiento o prensa de otro país).
FOREIGN_HOSTS = {
    "los40.com",
    "huffingtonpost.es",
    "cadenaser.com",
    "rtve.es",
    "eldiario.es",
    "elmundo.es",
    "abc.es",
    "lavanguardia.com",
    "20minutos.es",
    "newtral.es",
    "theguardian.com",
    "nytimes.com",
    "bbc.com",
    "bbc.co.uk",
    "cnn.com",
    "reuters.com",
}

# Rutas que delatan una nota de otro país o un tema ajeno, aun en un host mixto.
OFFTOPIC_PATH_MARKERS = (
    "/espana/",
    "/espana",
    "/espanya/",
    "/mexico/",
    "/colombia/",
    "/chile/",
    "/peru/",
    "/valencia/",
    "/andalucia/",
    "/catalunya/",
    "/alicante/",
    "yolanda-diaz",
    "yolanda_diaz",
    "radio-sevilla",
    "radio-alicante",
    "debate-parlamentario",
    "direccion-general-de-la-oit",
    "/oit/",
)

# Hosts mixtos: se aceptan solo en secciones argentinas.
MIXED_HOSTS = {
    "elpais.com": ("/argentina/", "/argentina"),
    "bbc.com": ("/mundo/", "/mundo"),
    "cnnespanol.cnn.com": ("/argentina/",),
}


def registrable_host(url: str) -> str | None:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    if ":" in host:
        host = host.split(":", 1)[0]
    return host or None


def is_argentine_host(host: str) -> bool:
    if host.endswith(".ar") or host.endswith(".gob.ar") or host.endswith(".gov.ar"):
        return True
    if host in AR_HOSTS:
        return True
    # Coincide sufijo de un host conocido (p. ej. www ya recortado).
    return any(host == item or host.endswith("." + item) for item in AR_HOSTS)


def is_foreign_host(host: str) -> bool:
    return any(host == item or host.endswith("." + item) for item in FOREIGN_HOSTS)


def path_and_host(url: str) -> tuple[str, str]:
    parsed = urlparse(url)
    host = registrable_host(url) or ""
    path = (parsed.path or "") + ("?" + parsed.query if parsed.query else "")
    return host, path.lower()


def annotate_citation(citation: dict) -> dict:
    url = (citation.get("url") or "").strip()
    host = registrable_host(url)
    title = citation.get("title")
    source = citation.get("source") or "annotation"
    out = {
        "url": url,
        "title": title,
        "source": source,
        "domain": host,
        "kept": False,
        "filter_reason": None,
    }
    if not host:
        out["filter_reason"] = "url_invalida"
        return out
    host, path = path_and_host(url)
    if any(marker in path or marker in (title or "").casefold() for marker in OFFTOPIC_PATH_MARKERS):
        # Excepción: elpais.com/argentina/... no se toca por el marcador genérico.
        if not (host.endswith("elpais.com") and "/argentina/" in path):
            out["filter_reason"] = "fuera_de_tema"
            return out
    if is_foreign_host(host):
        out["filter_reason"] = "fuera_de_argentina"
        return out
    for mixed, prefixes in MIXED_HOSTS.items():
        if host == mixed or host.endswith("." + mixed):
            if any(path.startswith(p) or p in path for p in prefixes):
                out["kept"] = True
                return out
            out["filter_reason"] = "fuera_de_argentina"
            return out
    if is_argentine_host(host) or host in {"es.wikipedia.org", "wikipedia.org"}:
        out["kept"] = True
        return out
    # Host no clasificado: se conserva y el análisis puede descartarlo si es obvio.
    out["kept"] = True
    out["filter_reason"] = None
    return out


def annotate_citations(citations: list[dict] | None) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for item in citations or []:
        if not isinstance(item, dict):
            continue
        annotated = annotate_citation(item)
        url = annotated.get("url")
        if not url or url in seen:
            continue
        seen.add(url)
        out.append(annotated)
    return out


def apply_model_drops(citations: list[dict], drop_urls: list[str] | None) -> list[dict]:
    drops = {url.strip() for url in (drop_urls or []) if isinstance(url, str) and url.strip()}
    updated = []
    for item in citations:
        row = dict(item)
        if row.get("kept") and row.get("url") in drops:
            row["kept"] = False
            row["filter_reason"] = row.get("filter_reason") or "fuera_de_tema"
        updated.append(row)
    return updated
