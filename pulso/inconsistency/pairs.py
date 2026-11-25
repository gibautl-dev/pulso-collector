"""Pares a revisar: declaración nueva contra declaraciones previas del mismo tema.

Determinista y barato: solo pasan al modelo pares con el mismo tema y palabras
clave en común, separados por al menos `min_gap_days`. Para cada nota que
señala una contradicción se adjuntan las piezas previas más parecidas (si las hay).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from pulso.inconsistency.statements import Piece

GENERIC_TOPICS = {"otros", "agenda institucional"}


@dataclass
class Pair:
    earlier: Piece
    later: Piece
    shared: list[str]
    score: float


@dataclass
class FlagContext:
    flag: Piece
    earlier: list[Piece] = field(default_factory=list)


def salient_filter(pieces: list[Piece], max_share: float = 0.08) -> set[str]:
    """Palabras demasiado frecuentes en el conjunto (p. ej. "inversión", "millones")
    no alcanzan para decir que dos piezas hablan de lo mismo."""
    df: dict[str, int] = {}
    for p in pieces:
        for t in p.tokens:
            df[t] = df.get(t, 0) + 1
    limit = max(3, int(len(pieces) * max_share))
    return {t for t, n in df.items() if n > limit}


def _overlap(a: Piece, b: Piece, common: set[str] | None = None) -> tuple[list[str], float]:
    common = common or set()
    ta, tb = a.tokens - common, b.tokens - common
    shared = sorted(ta & tb)
    if not shared:
        return [], 0.0
    union = len(ta | tb) or 1
    return shared, len(shared) / union


def _same_topic(a: Piece, b: Piece) -> bool:
    return bool(a.topic_id and a.topic_id == b.topic_id)


NEGATIONS = {"no", "nunca", "jamas", "ni", "tampoco", "sin"}


def _restates(a: Piece, b: Piece) -> bool:
    """Misma frase repetida (≥70% de palabras en común y misma polaridad): no hay nada que comparar."""
    import re
    from pulso.inconsistency.statements import fold, tokens

    # Si los dos tienen cita textual, se compara la cita (el resto del titular cambia por medio).
    ta, tb = (tokens(a.quote), tokens(b.quote)) if a.quote and b.quote else (a.tokens, b.tokens)
    if len(ta) < 3 or len(tb) < 3:
        return False
    jac = len(ta & tb) / len(ta | tb)
    if jac < 0.7:
        return False
    neg = lambda t: sum(1 for w in re.findall(r"[a-z]+", fold(t)) if w in NEGATIONS)  # noqa: E731
    qa, qb = (a.quote, b.quote) if a.quote and b.quote else (a.text, b.text)
    return neg(qa) == neg(qb)


def candidate_pairs(statements: list[Piece], *, now: datetime, new_since: datetime,
                    min_gap_days: int = 2, max_pairs: int = 12, min_shared: int = 2) -> list[Pair]:
    """Cada declaración nueva (desde `new_since`) contra las previas del mismo tema."""
    new = [s for s in statements if s.published_at >= new_since]
    common = salient_filter(statements)
    pairs: list[Pair] = []
    seen: set[tuple[str, str]] = set()
    for later in new:
        for earlier in statements:
            if earlier is later or earlier.published_at >= later.published_at:
                continue
            if later.published_at - earlier.published_at < timedelta(days=min_gap_days):
                continue
            if _restates(earlier, later):
                continue
            shared, score = _overlap(earlier, later, common)
            same = _same_topic(earlier, later)
            generic = (later.topic or "").lower() in GENERIC_TOPICS
            need = (min_shared - 1) if (same and not generic) else min_shared
            if len(shared) < need:
                continue
            key = (earlier.id, later.id)
            if key in seen:
                continue
            seen.add(key)
            pairs.append(Pair(earlier=earlier, later=later, shared=shared,
                              score=score + (0.15 if same else 0.0)))
    pairs.sort(key=lambda p: (p.score, p.later.published_at), reverse=True)
    # Como mucho 3 pares por declaración nueva, para no gastar en el mismo tema.
    out: list[Pair] = []
    per_later: dict[str, int] = {}
    for p in pairs:
        if per_later.get(p.later.id, 0) >= 3:
            continue
        per_later[p.later.id] = per_later.get(p.later.id, 0) + 1
        out.append(p)
        if len(out) >= max_pairs:
            break
    return out


def flag_contexts(flags: list[Piece], previous: list[Piece], *, new_since: datetime,
                  max_flags: int = 6, per_flag: int = 3) -> list[FlagContext]:
    """Notas nuevas que señalan una contradicción, con hasta `per_flag` piezas previas parecidas."""
    out = []
    common = salient_filter(previous + flags)
    fresh = sorted((f for f in flags if f.published_at >= new_since), key=lambda f: (f.copies, f.published_at), reverse=True)
    # Varias notas sobre la misma historia (mismo tema, palabras en común, 72 h) cuentan como un solo señalamiento.
    leaders: list[Piece] = []
    for f in fresh:
        lead = next((l for l in leaders if abs((l.published_at - f.published_at).total_seconds()) <= 72 * 3600
                     and (len(_overlap(l, f, common)[0]) >= 3
                          or ((_same_topic(l, f) or not (l.topic_id and f.topic_id))
                              and len(_overlap(l, f, common)[0]) >= 2))), None)
        if lead is None:
            leaders.append(f)
        else:
            lead.copies += f.copies
            lead.mention_ids += [m for m in f.mention_ids if m not in lead.mention_ids]
            lead.outlets += [o for o in f.outlets if o not in lead.outlets]
    for f in sorted(leaders, key=lambda f: f.published_at, reverse=True):
        ranked = []
        for p in previous:
            if p.published_at >= f.published_at or p.id == f.id:
                continue
            shared, score = _overlap(p, f, common)
            if len(shared) >= 2 or (len(shared) >= 1 and _same_topic(p, f)):
                ranked.append((score + (0.15 if _same_topic(p, f) else 0), p))
        ranked.sort(key=lambda x: x[0], reverse=True)
        out.append(FlagContext(flag=f, earlier=[p for _s, p in ranked[:per_flag]]))
        if len(out) >= max_flags:
            break
    return out


def as_debug(pairs: list[Pair]) -> list[dict[str, Any]]:
    return [
        {"earlier": p.earlier.text[:120], "later": p.later.text[:120], "shared": p.shared, "score": round(p.score, 3)}
        for p in pairs
    ]
