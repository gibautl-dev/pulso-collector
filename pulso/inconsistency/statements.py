"""Declaraciones del candidato y notas que señalan contradicciones. Sin LLM.

Tres tipos de pieza:
- own: publicado por una cuenta propia del candidato (X, YouTube, dominio propio),
  según account_relation = 'own' que ya marca el recolector.
- attributed: titular de un medio que le atribuye una frase al candidato
  ("Kicillof: «…»", "Kicillof dijo que…"). Si el candidato es el destinatario
  ("Intendentes a Kicillof: …") o habla otro de su entorno ("un ministro de
  Kicillof dijo…"), no cuenta.
- flag: nota de terceros que dice que el candidato se contradijo, dio marcha
  atrás o incumplió algo que había anunciado.
Las copias del mismo titular en varios medios se agrupan en una sola pieza.
"""

from __future__ import annotations

import html
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable

MEDIA_SOURCES = {"google_news", "rss_media", "google_alerts"}

VERBS = (
    "dijo|afirmo|aseguro|sostuvo|declaro|prometio|anuncio|nego|admitio|reconocio|advirtio|"
    "cuestiono|critico|apunto|defendio|pidio|rechazo|ratifico|insistio|denuncio|acuso|propuso|"
    "planteo|reclamo|exigio|respondio|considero|califico|garantizo|descarto|confirmo|minimizo|"
    "celebro|senalo|remarco|destaco|explico|anticipo|adelanto|repitio|volvio a decir|se comprometio|"
    "dice|asegura|afirma|advierte|avisa|promete|anuncia|responde|replica|defiende|niega|admite|reconoce|"
    "critica|pide|rechaza|insiste|sostiene|apela|garantiza|descarta"
)
SPEECH_IN_SPEAKER = re.compile(r"(?<!\w)(?:" + VERBS + r"|sobre|tras|ante|contra|desde)(?!\w)")

# Señales de contradicción en notas de terceros (texto ya sin tildes y en minúsculas).
FLAG_CUES = re.compile(
    r"marcha atras|se desdij|desdecir|se arrepinti|cambi[oa] de postura|cambio de postura|"
    r"giro de 180|doble discurso|contradic|incoherenc|volantazo|vuelve sobre sus pasos|"
    r"recul[oa]|lo que (antes )?decia|antes decia|ahora dice|hace (un|unos|dos|tres|\d+) "
    r"(dias|meses|anos) (decia|dijo|prometio)|se habian comprometido a no|se habia comprometido a no|"
    r"anuncio como medida estrella|promesa incumplida|incumpli|hemeroteca|"
    r"juego de memoria|olvido lo que|da un paso atras|dio un paso atras"
)

STOP = set(
    """
    sobre entre desde hasta contra para porque cuando donde como pero sino aunque mientras
    tambien todos todas todo toda este esta estos estas aquel aquella ellos ellas nuestro
    nuestra nuestros nuestras tiene tienen hacer hace hacen puede pueden seria serian sera
    haber habia habian estan estar estamos somos eran fueron siendo luego antes ahora despues
    nunca siempre mucho mucha muchos muchas otros otras otro otra mismo misma cada solo solos
    gobierno gobernador presidente provincia nacional noticias diario radio online digital
    aseguro afirmo sostuvo declaro dijo anuncio pidio critico apunto rechazo defendio
    argentina argentinos espana espanoles bonaerense bonaerenses buenos aires millones millon
    anuncia anuncio anunciaron inversion inversiones
    """.split()
)


def fold(text: str | None) -> str:
    text = html.unescape(text or "")
    return "".join(
        c for c in unicodedata.normalize("NFD", text.casefold()) if not unicodedata.combining(c)
    )


def _dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00").replace(" ", "T", 1))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def clean_title(title: str | None, outlet: str | None = None) -> str:
    """Titular sin el ' - Medio' final que agrega Google News."""
    t = re.sub(r"\s+", " ", html.unescape(title or "")).strip()
    if outlet:
        for sep in (" - ", " – ", " | "):
            suffix = f"{sep}{outlet}"
            if t.endswith(suffix):
                return t[: -len(suffix)].strip()
    m = re.match(r"^(.*\S)\s+[-–|]\s+([^-–|]{2,45})$", t)
    if m and len(m.group(1)) > 25:
        return m.group(1).strip()
    return t


def aliases_for(candidate: dict[str, Any]) -> list[str]:
    """Nombre completo, apellido y alias extra. El apellido solo vale al inicio del hablante."""
    name = (candidate.get("name") or "").strip()
    out = []
    if name:
        out.append(name)
        parts = name.split()
        if len(parts) > 1:
            out.append(parts[-1])
    for a in candidate.get("aliases") or []:
        if str(a).strip():
            out.append(str(a).strip())
    seen = []
    for a in out:
        f = fold(a)
        if f and f not in seen:
            seen.append(f)
    return sorted(seen, key=len, reverse=True)


QUOTE_CHARS = "\"'“”«»‘’″"


def _starts_with_alias(segment_folded: str, aliases: list[str]) -> bool:
    seg = segment_folded.strip().lstrip(QUOTE_CHARS + "¡¿ ")
    seg = re.sub(r"^(el |la )?(gobernador|presidente|jefe del gobierno|lider del psoe)\s+", "", seg)
    for a in aliases:
        if seg == a or re.match(re.escape(a) + r"(?=[\s,;.]|$)", seg):
            return True
    return False


def _extract_quote(text: str) -> str:
    m = re.search(r"[\"“«‘']([^\"”»’']{6,})[\"”»’']?", text)
    return m.group(1).strip(" .,") if m else ""


def attributed_statement(title: str, aliases: list[str]) -> dict[str, str] | None:
    """Devuelve {'text', 'quote', 'pattern'} si el titular le atribuye una frase al candidato."""
    if not title:
        return None
    folded = fold(title)
    colon = re.match(r"^(?P<speaker>[^:\"“«]{2,110}?):\s*(?P<rest>\S.{4,})$", title)
    if colon:
        speaker = fold(colon.group("speaker"))
        rest = colon.group("rest").strip()
        if not _starts_with_alias(speaker, aliases):
            return None
        starts_quoted = rest[:1] in QUOTE_CHARS
        has_quote = any(ch in rest for ch in QUOTE_CHARS)
        alias_only = any(speaker.strip() == a for a in aliases)
        tail = speaker
        for a in aliases:
            if tail.startswith(a):
                tail = tail[len(a):]
                break
        if starts_quoted or (has_quote and (alias_only or SPEECH_IN_SPEAKER.search(tail))):
            quote = _extract_quote(rest) or rest.strip(QUOTE_CHARS + " ")
            return {"text": title, "quote": quote, "pattern": "colon"}
        return None
    for a in aliases:
        m = re.search(r"(?:^|,\s*)(?:axel |javier |pedro |el gobernador |el presidente )?" + re.escape(a) + r"\s+(?:" + VERBS + r")\b", folded)
        if m:
            before = folded[: m.start()].rstrip()
            if before.endswith((" de", " a", " del")):
                continue
            return {"text": title, "quote": _extract_quote(title), "pattern": "verb"}
    return None


def is_flag(text: str, aliases: list[str]) -> bool:
    folded = fold(text)
    for cue in FLAG_CUES.finditer(folded):
        lo, hi = max(0, cue.start() - 90), cue.end() + 90
        window = folded[lo:hi]
        if any(re.search(r"(?<!\w)" + re.escape(a) + r"(?!\w)", window) for a in aliases):
            return True
    return False


VERB_STEMS = {v[:6] for v in VERBS.split("|") if len(v) >= 5} | {
    "cuesti", "destac", "critic", "respon", "apunto", "anunci", "aposto", "cruzo", "alerto",
}


def tokens(text: str, aliases: Iterable[str] = ()) -> set[str]:
    alias_words = {w for a in aliases for w in a.split()}
    out = set()
    for w in re.findall(r"[a-zñ]{5,}", fold(text)):
        if w in STOP or w in alias_words or w[:6] in VERB_STEMS:
            continue
        out.add(w[:6])
    return out


@dataclass
class Piece:
    id: str
    kind: str  # own | attributed | flag | context (nota de terceros, solo para dar contexto a un señalamiento)
    text: str
    quote: str
    published_at: datetime
    source: str
    outlet: str | None
    url: str
    topic_id: str | None
    topic: str | None
    tone: str | None
    copies: int = 1
    outlets: list[str] = field(default_factory=list)
    mention_ids: list[str] = field(default_factory=list)
    tokens: set[str] = field(default_factory=set)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "text": self.text,
            "quote": self.quote,
            "published_at": self.published_at.isoformat(),
            "source": self.source,
            "outlet": self.outlet,
            "url": self.url,
            "topic_id": self.topic_id,
            "topic": self.topic,
            "tone": self.tone,
            "copies": self.copies,
            "outlets": self.outlets[:8],
        }


def _dedupe_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", fold(text))[:90]


def _near_duplicate(existing: Iterable[Piece], kind: str, toks: set[str], at: datetime) -> str | None:
    """Mismo titular reescrito por otro medio (≥60% de palabras en común, dentro de 72 h)."""
    if len(toks) < 4:
        return None
    for p in existing:
        if p.kind != kind or abs((at - p.published_at).total_seconds()) > 72 * 3600 or len(p.tokens) < 4:
            continue
        inter = len(toks & p.tokens)
        if inter / len(toks | p.tokens) >= 0.6:
            return f"{p.kind}:{_dedupe_key(p.text)}"
    return None


def extract_pieces(candidate: dict[str, Any], mentions: Iterable[dict[str, Any]],
                   topics: Iterable[dict[str, Any]] = ()) -> dict[str, list[Piece]]:
    """Clasifica menciones en declaraciones propias, atribuidas y notas que señalan contradicciones."""
    aliases = aliases_for(candidate)
    labels = {str(t["id"]): t.get("label") for t in topics or []}
    groups: dict[str, Piece] = {}
    order = sorted(
        (m for m in mentions if _dt(m.get("published_at")) is not None),
        key=lambda m: _dt(m.get("published_at")),
    )
    for m in order:
        rel = m.get("account_relation") or "third_party"
        source = m.get("source") or ""
        title = clean_title(m.get("title"), m.get("outlet"))
        kind = None
        quote = ""
        text = title
        if rel == "own":
            kind = "own"
            text = re.sub(r"\s+", " ", html.unescape(m.get("content") or m.get("title") or "")).strip()[:400]
            quote = text
        elif rel == "third_party" and source in MEDIA_SOURCES:
            st = attributed_statement(title, aliases)
            if st:
                kind, quote = "attributed", st["quote"]
            elif is_flag(title + " " + (m.get("content") or "")[:300], aliases):
                kind = "flag"
            else:
                kind = "context"
        if not kind or not text:
            continue
        key = f"{kind}:{_dedupe_key(text)}"
        topic_id = str(m["topic_id"]) if m.get("topic_id") else None
        if key not in groups and kind != "context":
            near = _near_duplicate(groups.values(), kind, tokens(text, aliases), _dt(m["published_at"]))
            if near is not None:
                key = near
        if key in groups:
            g = groups[key]
            g.copies += 1
            g.mention_ids.append(str(m["id"]))
            if m.get("outlet") and m["outlet"] not in g.outlets:
                g.outlets.append(m["outlet"])
            continue
        groups[key] = Piece(
            id=str(m["id"]),
            kind=kind,
            text=text,
            quote=quote,
            published_at=_dt(m["published_at"]),
            source=source,
            outlet=m.get("outlet") or m.get("author"),
            url=m.get("url") or "",
            topic_id=topic_id,
            topic=labels.get(topic_id) if topic_id else None,
            tone=m.get("tone"),
            outlets=[m["outlet"]] if m.get("outlet") else [],
            mention_ids=[str(m["id"])],
            tokens=tokens(text, aliases),
        )
    out: dict[str, list[Piece]] = {"own": [], "attributed": [], "flag": [], "context": []}
    for p in groups.values():
        out[p.kind].append(p)
    return out
