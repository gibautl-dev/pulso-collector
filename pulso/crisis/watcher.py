"""Vigilante: umbrales sobre menciones reales, sin LLM."""

from __future__ import annotations

import math
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

NEGATIVE_TONES = frozenset({"critica", "acusacion", "insulto"})
MEDIA_SOURCES = frozenset({"rss_media", "google_news"})
STOPWORDS = frozenset(
    """
    el la los las de del un una unas unos y o u en por para con que se su sus al a
    es son fue ser como mas más ya no ni si sí lo le leles ha han hay este esta
    esto estos estas un el hoy ayer también tambien muy sobre entre desde hasta
    pero cual cuales quien quienes cuando donde porque porque porque qué
    the of and to in for on with at from by as is was are were be been
    kicillof axel kicillofok gobernador gob gobierno provincia provincial buenos aires pba
    video videos https http www com ar status tweet thread post
    sanchez sánchez pedro
    """.split()
)
WORD_RE = re.compile(r"[a-záéíóúüñ0-9]{3,}", re.IGNORECASE)
# Normalización liviana para no partir un mismo relato en varios clusters.
STEMS = {
    "laborales": "laboral", "laboral": "laboral",
    "sueldos": "sueldo", "sueldo": "sueldo", "salarios": "sueldo", "salario": "sueldo",
    "jornadas": "jornada", "jornada": "jornada", "horarios": "horario", "horario": "horario",
    "tramites": "tramite", "trámites": "tramite", "tramite": "tramite", "trámite": "tramite",
    "informar": "informar", "informara": "informar", "informará": "informar",
    "informacion": "informar", "información": "informar",
    "burocracia": "burocracia", "burocratico": "burocracia", "burocrático": "burocracia",
    "pymes": "pyme", "pyme": "pyme",
    "reelecciones": "reeleccion", "reelección": "reeleccion", "reeleccion": "reeleccion",
}

# Umbrales calibrados el 2026-11-24 sobre datos reales de Kicillof.
Z_SPIKE = 2.0
SPIKE_FLOOR_NOTABLES = 8
SPIKE_FLOOR_MEDIA = 3
SOURCE_STABLE_DAYS = 3
BASELINE_DAYS = 7
RISING_WINDOW_HOURS = 48
RISING_BASELINE_MAX_MEAN = 1.0
RISING_MEDIA_MIN = 3
RISING_NOTABLES_MIN = 5
RISING_IMPRESSIONS_MIN = 1000
SUSPICIOUS_ACCOUNTS_MIN = 5
ATTACK_ADS_NEW_48H = 8
ATTACK_ADS_Z = 2.0
ATTACK_ADS_FLOOR = 8
AI_SHIFT_AVG = -15.0
AI_SHIFT_ONE = -20.0
AI_SHIFT_DAYS = 2
AI_SHIFT_MIN_SNAPSHOTS = 7


def _as_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def local_date(value: Any, tz: ZoneInfo) -> date | None:
    dt = _as_dt(value)
    if dt is None:
        return None
    return dt.astimezone(tz).date()


def metric_int(metrics: Any, *keys: str) -> int:
    if not isinstance(metrics, dict):
        return 0
    for key in keys:
        raw = metrics.get(key)
        if raw is None:
            continue
        try:
            return int(float(raw))
        except (TypeError, ValueError):
            continue
    return 0


def is_notable(mention: dict[str, Any]) -> bool:
    source = mention.get("source") or ""
    if source in MEDIA_SOURCES:
        return True
    metrics = mention.get("metrics") or {}
    if source == "x":
        impressions = metric_int(metrics, "impression_count", "impressions", "view_count")
        likes = metric_int(metrics, "like_count", "likes")
        followers = metric_int(metrics, "followers_count", "followers", "author_followers")
        return impressions >= 80 or likes >= 5 or followers >= 8000
    if source == "youtube":
        return metric_int(metrics, "view_count", "views") >= 200
    return False


def is_third_party(mention: dict[str, Any]) -> bool:
    return (mention.get("account_relation") or "third_party") == "third_party"


def is_negative_about_candidate(mention: dict[str, Any]) -> bool:
    return (
        is_third_party(mention)
        and mention.get("target") == "candidate"
        and (mention.get("tone") or "") in NEGATIVE_TONES
    )


def impressions_of(mention: dict[str, Any]) -> int:
    return metric_int(mention.get("metrics") or {}, "impression_count", "impressions", "view_count")


def tokens(text: str, extra_stop: Iterable[str] = ()) -> set[str]:
    stop = STOPWORDS | {s.lower() for s in extra_stop}
    found = set()
    for match in WORD_RE.findall(text or ""):
        word = match.lower()
        if word in stop or word.isdigit():
            continue
        found.add(STEMS.get(word, word))
    return found


def mention_tokens(mention: dict[str, Any], extra_stop: Iterable[str] = ()) -> set[str]:
    parts = [mention.get("title") or "", mention.get("outlet") or ""]
    content = mention.get("content") or ""
    parts.append(content[:400])
    return tokens(" ".join(parts), extra_stop)


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / len(a | b)


def similar(a: set[str], b: set[str]) -> bool:
    if not a or not b:
        return False
    inter = a & b
    return len(inter) >= 4 or (len(inter) >= 3 and jaccard(a, b) >= 0.28)


def slug_key(words: Iterable[str], prefix: str, limit: int = 6) -> str:
    picked = [re.sub(r"[^a-záéíóúüñ0-9-]", "", w.lower()) for w in words]
    picked = [w for w in picked if w][:limit]
    body = "-".join(picked) or "cluster"
    return f"{prefix}:{body}"[:180]


def zscore(value: float, series: list[float]) -> float | None:
    if len(series) < 3:
        return None
    mean = statistics.mean(series)
    if len(series) == 1:
        return None
    sd = statistics.pstdev(series)
    if sd == 0:
        return math.inf if value > mean else 0.0
    return (value - mean) / sd


@dataclass
class DetectedAlert:
    trigger_type: str
    trigger_key: str
    cluster_label: str
    topic_id: str | None
    window_start: datetime
    window_end: datetime
    severity: str
    metrics: dict[str, Any]
    mention_ids: list[str] = field(default_factory=list)
    evidence_account_ids: list[str] = field(default_factory=list)


def _severity(notables: int, media: int, impressions: int, z: float | None) -> str:
    if media >= 10 or notables >= 25 or impressions >= 20000 or (z is not None and z >= 4):
        return "alto"
    if media >= 6 or notables >= 12 or impressions >= 5000 or (z is not None and z >= 3):
        return "medio_alto"
    if media >= 3 or notables >= 8 or impressions >= 1000 or (z is not None and z >= 2):
        return "medio"
    return "bajo"


class UnionFind:
    def __init__(self, n: int) -> None:
        self.p = list(range(n))

    def find(self, i: int) -> int:
        while self.p[i] != i:
            self.p[i] = self.p[self.p[i]]
            i = self.p[i]
        return i

    def union(self, i: int, j: int) -> None:
        a, b = self.find(i), self.find(j)
        if a != b:
            self.p[b] = a


def _cluster_mentions(items: list[dict[str, Any]], extra_stop: Iterable[str]) -> list[list[dict[str, Any]]]:
    if not items:
        return []
    tok = [mention_tokens(m, extra_stop) for m in items]
    uf = UnionFind(len(items))
    for i in range(len(items)):
        if not tok[i]:
            continue
        for j in range(i + 1, len(items)):
            if similar(tok[i], tok[j]):
                uf.union(i, j)
    groups: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for i, mention in enumerate(items):
        groups[uf.find(i)].append(mention)
    return list(groups.values())


def _label_for(mentions: list[dict[str, Any]], extra_stop: Iterable[str]) -> tuple[str, list[str]]:
    counts: Counter[str] = Counter()
    for mention in mentions:
        counts.update(mention_tokens(mention, extra_stop))
    top = [w for w, _ in counts.most_common(8)]
    # Preferir un titular de medio si hay.
    media = [m for m in mentions if (m.get("source") or "") in MEDIA_SOURCES and (m.get("title") or "").strip()]
    if media:
        media.sort(key=lambda m: ((m.get("outlet") or ""), m.get("published_at") or ""))
        title = (media[0].get("title") or "").strip()
        if len(title) > 90:
            title = title[:87] + "…"
        return title, top
    return " ".join(top[:5]) or "Tema emergente", top




def _fold_small_clusters(clusters, extra_stop):
    """Si un cluster chico comparte el relato de uno más grande, lo une."""
    if len(clusters) <= 1:
        return clusters
    def title_bag(group):
        bag: set[str] = set()
        for mention in group:
            if (mention.get("source") or "") in MEDIA_SOURCES:
                bag |= tokens((mention.get("title") or ""), extra_stop)
        if not bag:
            for mention in group:
                bag |= mention_tokens(mention, extra_stop)
        return bag
    bags = [title_bag(g) for g in clusters]
    order = sorted(range(len(clusters)), key=lambda i: len(clusters[i]), reverse=True)
    parent = list(range(len(clusters)))
    for i in order:
        if parent[i] != i:
            continue
        for j in order:
            if i == j or parent[j] != j:
                continue
            # solo plegar el más chico hacia el más grande
            if len(clusters[j]) >= len(clusters[i]):
                continue
            inter = bags[i] & bags[j]
            if len(inter) >= 2:
                parent[j] = i
                bags[i] |= bags[j]
    merged = {}
    for i, group in enumerate(clusters):
        root = i
        while parent[root] != root:
            root = parent[root]
        merged.setdefault(root, []).extend(group)
    return list(merged.values())


def _merge_media_clusters(
    clusters: list[list[dict]],
    extra_stop,
) -> list[list[dict]]:
    """Une relatos del mismo tema usando solo titulares de medios, no posts de X."""
    if len(clusters) <= 1:
        return clusters
    bags = []
    for group in clusters:
        bag: set[str] = set()
        for mention in group:
            if (mention.get("source") or "") in MEDIA_SOURCES:
                bag |= tokens((mention.get("title") or "") + " " + (mention.get("outlet") or ""), extra_stop)
        bags.append(bag)
    uf = UnionFind(len(clusters))
    for i in range(len(clusters)):
        if not bags[i]:
            continue
        for j in range(i + 1, len(clusters)):
            if not bags[j]:
                continue
            inter = bags[i] & bags[j]
            if len(inter) >= 3 or (len(inter) >= 2 and jaccard(bags[i], bags[j]) >= 0.35):
                uf.union(i, j)
    merged: dict[int, list] = {}
    for i, group in enumerate(clusters):
        merged.setdefault(uf.find(i), []).extend(group)
    return list(merged.values())


def _assign_to_clusters(
    clusters: list[list[dict[str, Any]]],
    extras: list[dict[str, Any]],
    extra_stop: Iterable[str],
) -> list[list[dict[str, Any]]]:
    cluster_tokens = []
    for group in clusters:
        bag: set[str] = set()
        for mention in group:
            bag |= mention_tokens(mention, extra_stop)
        cluster_tokens.append(bag)
    remaining = list(extras)
    for mention in remaining:
        tok = mention_tokens(mention, extra_stop)
        best_i, best = -1, 0.0
        for i, bag in enumerate(cluster_tokens):
            score = jaccard(tok, bag)
            if (len(tok & bag) >= 3 or score >= 0.22) and score >= best:
                best, best_i = score, i
        if best_i >= 0:
            clusters[best_i].append(mention)
            cluster_tokens[best_i] |= tok
    return clusters


def detect_rising_topics(
    mentions: list[dict[str, Any]],
    *,
    tz: ZoneInfo,
    now: datetime,
    extra_stop: Iterable[str] = (),
) -> list[DetectedAlert]:
    window_end = now
    window_start = now - timedelta(hours=RISING_WINDOW_HOURS)
    baseline_end = window_start
    baseline_start = baseline_end - timedelta(days=BASELINE_DAYS)
    recent, earlier = [], []
    for mention in mentions:
        if not is_third_party(mention):
            continue
        published = _as_dt(mention.get("published_at"))
        if published is None:
            continue
        if window_start <= published <= window_end:
            recent.append(mention)
        elif baseline_start <= published < baseline_end:
            earlier.append(mention)
    media_recent = [m for m in recent if (m.get("source") or "") in MEDIA_SOURCES]
    other_recent = [m for m in recent if (m.get("source") or "") not in MEDIA_SOURCES]
    clusters = _cluster_mentions(media_recent, extra_stop)
    # Si casi no hay medios, agrupar también negativas notables de X/YT.
    if len(media_recent) < 2:
        seed = media_recent + [m for m in other_recent if is_notable(m) and is_negative_about_candidate(m)]
        clusters = _cluster_mentions(seed, extra_stop)
        used = {id(m) for g in clusters for m in g}
        other_recent = [m for m in other_recent if id(m) not in used]
    clusters = _assign_to_clusters(clusters, other_recent, extra_stop)
    alerts: list[DetectedAlert] = []
    for group in clusters:
        media_n = sum(1 for m in group if (m.get("source") or "") in MEDIA_SOURCES)
        notables = [m for m in group if is_notable(m)]
        impressions = sum(impressions_of(m) for m in group if (m.get("source") or "") == "x")
        negatives = [m for m in group if is_negative_about_candidate(m)]
        if len(negatives) < 2:
            continue
        if media_n < RISING_MEDIA_MIN and not (
            len(notables) >= RISING_NOTABLES_MIN and impressions >= RISING_IMPRESSIONS_MIN
        ):
            continue
        label, top = _label_for(group, extra_stop)
        key_toks = top[:6]
        if len(key_toks) < 2:
            continue
        # Baseline: menciones anteriores del mismo cluster.
        bag = set(key_toks)
        earlier_hits = [
            m
            for m in earlier
            if len(mention_tokens(m, extra_stop) & bag) >= 3
        ]
        days = defaultdict(int)
        for mention in earlier_hits:
            day = local_date(mention.get("published_at"), tz)
            if day:
                days[day] += 1
        # Completar días vacíos del baseline.
        cursor = baseline_start.astimezone(tz).date()
        end_day = (baseline_end.astimezone(tz).date())
        series = []
        while cursor < end_day:
            series.append(float(days.get(cursor, 0)))
            cursor += timedelta(days=1)
        mean = statistics.mean(series) if series else 0.0
        if mean >= RISING_BASELINE_MAX_MEAN:
            continue
        outlets = sorted({(m.get("outlet") or m.get("source") or "") for m in group if (m.get("source") or "") in MEDIA_SOURCES})
        severity = _severity(len(notables), media_n, impressions, None)
        # Si hay pocos negativos y muchos informativos, no subir de medio.
        if len(negatives) < 5 and severity == "alto":
            severity = "medio_alto"
        alerts.append(
            DetectedAlert(
                trigger_type="rising_topic",
                trigger_key=slug_key(key_toks, "rising_topic"),
                cluster_label=label,
                topic_id=None,
                window_start=window_start,
                window_end=window_end,
                severity=severity,
                metrics={
                    "mention_count": len(group),
                    "notable_count": len(notables),
                    "media_count": media_n,
                    "negative_count": len(negatives),
                    "x_impressions": impressions,
                    "baseline_daily_mean": round(mean, 3),
                    "baseline_days": len(series),
                    "outlets": outlets,
                    "top_tokens": key_toks,
                    "window_hours": RISING_WINDOW_HOURS,
                },
                mention_ids=[str(m["id"]) for m in group if m.get("id")],
            )
        )
    alerts.sort(key=lambda a: (a.metrics.get("media_count") or 0, a.metrics.get("x_impressions") or 0), reverse=True)
    kept: list[DetectedAlert] = []
    for alert in alerts:
        toks = set(alert.metrics.get("top_tokens") or [])
        if toks and any(len(toks & set(prev.metrics.get("top_tokens") or [])) >= 3 for prev in kept):
            continue
        kept.append(alert)
    return kept


def _complete_days_before(now: datetime, tz: ZoneInfo, n: int) -> list[date]:
    today = now.astimezone(tz).date()
    return [today - timedelta(days=i) for i in range(1, n + 1)]


def _source_stable(mentions: list[dict[str, Any]], source: str, tz: ZoneInfo, now: datetime) -> bool:
    days = set()
    start = now - timedelta(days=BASELINE_DAYS + 3)
    for mention in mentions:
        if mention.get("source") != source:
            continue
        published = _as_dt(mention.get("published_at"))
        if published is None or published < start:
            continue
        day = local_date(published, tz)
        if day and day < now.astimezone(tz).date():
            days.add(day)
    return len(days) >= SOURCE_STABLE_DAYS


def detect_negative_spikes(
    mentions: list[dict[str, Any]],
    *,
    tz: ZoneInfo,
    now: datetime,
) -> list[DetectedAlert]:
    if not _source_stable(mentions, "x", tz, now) and not _source_stable(mentions, "rss_media", tz, now):
        return []
    baseline_days = _complete_days_before(now, tz, BASELINE_DAYS)
    today = now.astimezone(tz).date()
    by_day: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for mention in mentions:
        if not is_negative_about_candidate(mention) or not is_notable(mention):
            continue
        day = local_date(mention.get("published_at"), tz)
        if day is None:
            continue
        by_day[day].append(mention)
    series = [float(len(by_day.get(d, []))) for d in reversed(baseline_days)]
    # Evaluar el último día completo y, si ya hay volumen, también hoy.
    candidates_days = list(baseline_days[:1])  # ayer
    if len(by_day.get(today, [])) >= SPIKE_FLOOR_NOTABLES:
        candidates_days.append(today)
    alerts = []
    for day in candidates_days:
        group = by_day.get(day, [])
        n = len(group)
        media_n = sum(1 for m in group if (m.get("source") or "") in MEDIA_SOURCES)
        if n < SPIKE_FLOOR_NOTABLES and media_n < SPIKE_FLOOR_MEDIA:
            continue
        compare = series if day == today else [float(len(by_day.get(d, []))) for d in reversed(baseline_days) if d != day]
        # Si evaluamos ayer, la serie ya es los 7 días que terminan ayer; z contra los 6 previos + ? 
        # Usamos los 7 días completos anteriores a `day`.
        prior = [float(len(by_day.get(day - timedelta(days=i), []))) for i in range(1, BASELINE_DAYS + 1)]
        z = zscore(float(n), prior)
        if z is None or z < Z_SPIKE:
            continue
        impressions = sum(impressions_of(m) for m in group if (m.get("source") or "") == "x")
        start = datetime(day.year, day.month, day.day, tzinfo=tz)
        alerts.append(
            DetectedAlert(
                trigger_type="negative_spike",
                trigger_key=f"negative_spike:{day.isoformat()}",
                cluster_label=f"Pico de menciones negativas el {day.isoformat()}",
                topic_id=None,
                window_start=start,
                window_end=start + timedelta(days=1),
                severity=_severity(n, media_n, impressions, z),
                metrics={
                    "mention_count": n,
                    "notable_count": n,
                    "media_count": media_n,
                    "negative_count": n,
                    "x_impressions": impressions,
                    "z_score": None if z is math.inf else round(z, 2),
                    "baseline_daily_mean": round(statistics.mean(prior), 3) if prior else 0,
                    "baseline_days": prior,
                    "day": day.isoformat(),
                },
                mention_ids=[str(m["id"]) for m in group if m.get("id")],
            )
        )
    return alerts


def detect_suspicious_campaigns(
    accounts: list[dict[str, Any]],
    *,
    now: datetime,
) -> list[DetectedAlert]:
    """Campaña coordinada: ≥5 cuentas con coordination/group_burst en 24h, sin sindicación de medios."""
    window_start = now - timedelta(hours=24)
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for account in accounts:
        detected = _as_dt(account.get("detected_at") or account.get("last_seen_at"))
        if detected is None or detected < window_start:
            continue
        signals = account.get("signals") or {}
        kinds = set()
        if isinstance(signals, dict):
            raw = signals.get("kinds") or signals.get("signal_kinds") or []
            if isinstance(raw, list):
                kinds = {str(x) for x in raw}
            # flags booleanos
            for key, val in signals.items():
                if val is True:
                    kinds.add(str(key))
        text = " ".join(kinds).lower()
        if "coordination" not in text and "group_burst" not in text and "coordin" not in text:
            # También aceptar evidence.fingerprint
            if not (isinstance(signals, dict) and (signals.get("fingerprint") or signals.get("text_fingerprint"))):
                continue
        # Excluir origen medio / sindicación de titular.
        handle = (account.get("handle") or "").lower()
        display = (account.get("display_name") or "").lower()
        if any(tag in handle or tag in display for tag in ("lanacion", "infobae", "clarin", "tncomar", "ambito", "pagina12")):
            continue
        note = str(signals)
        if "syndication" in note.lower() or "sindicaci" in note.lower():
            continue
        fp = ""
        if isinstance(signals, dict):
            fp = str(signals.get("fingerprint") or signals.get("text_fingerprint") or signals.get("cluster") or "unspecified")
        grouped[fp].append(account)
    alerts = []
    for fp, group in grouped.items():
        if len(group) < SUSPICIOUS_ACCOUNTS_MIN:
            continue
        alerts.append(
            DetectedAlert(
                trigger_type="suspicious_campaign",
                trigger_key=slug_key([fp[:40]], "suspicious_campaign", limit=2),
                cluster_label=f"Posible campaña coordinada ({len(group)} cuentas)",
                topic_id=None,
                window_start=window_start,
                window_end=now,
                severity="medio_alto" if len(group) >= 10 else "medio",
                metrics={
                    "account_count": len(group),
                    "fingerprint": fp[:120],
                    "handles": [a.get("handle") for a in group[:20] if a.get("handle")],
                },
                evidence_account_ids=[str(a["id"]) for a in group if a.get("id")],
            )
        )
    return alerts


def detect_attack_ads(
    ads: list[dict[str, Any]],
    classifications: list[dict[str, Any]],
    *,
    tz: ZoneInfo,
    now: datetime,
) -> list[DetectedAlert]:
    by_ad = {str(c.get("ad_id") or c.get("id")): c for c in classifications}
    # classifications may key on meta_ads.id
    by_meta_id = {str(c.get("meta_ad_id") or c.get("ad_pk") or ""): c for c in classifications}
    window_start = now - timedelta(hours=48)
    recent = []
    daily: dict[date, int] = defaultdict(int)
    start_hist = now - timedelta(days=BASELINE_DAYS + 2)
    for ad in ads:
        stance = ""
        cid = str(ad.get("id") or "")
        aid = str(ad.get("ad_id") or "")
        clas = by_ad.get(aid) or by_ad.get(cid) or by_meta_id.get(cid) or {}
        stance = (clas.get("stance") or clas.get("position") or clas.get("label") or "").lower()
        if stance and stance not in {"en_contra", "contra", "against", "attack", "negativo"}:
            continue
        if not stance:
            continue
        created = _as_dt(ad.get("ad_delivery_start_time") or ad.get("ad_creation_time") or ad.get("fetched_at"))
        if created is None:
            continue
        if created >= start_hist:
            day = local_date(created, tz)
            if day:
                daily[day] += 1
        if created >= window_start:
            recent.append(ad)
    if not recent:
        return []
    today = now.astimezone(tz).date()
    prior = [float(daily.get(today - timedelta(days=i), 0)) for i in range(3, 3 + BASELINE_DAYS)]
    z = zscore(float(len(recent)), prior) if prior else None
    if len(recent) < ATTACK_ADS_NEW_48H and (z is None or z < ATTACK_ADS_Z or len(recent) < ATTACK_ADS_FLOOR):
        return []
    return [
        DetectedAlert(
            trigger_type="attack_ads",
            trigger_key=f"attack_ads:{now.astimezone(tz).date().isoformat()}",
            cluster_label=f"Ola de anuncios en contra ({len(recent)} en 48 h)",
            topic_id=None,
            window_start=window_start,
            window_end=now,
            severity=_severity(len(recent), 0, 0, z),
            metrics={
                "ad_count_48h": len(recent),
                "z_score": None if z is None or z is math.inf else round(z, 2),
                "baseline_daily_mean": round(statistics.mean(prior), 3) if prior else 0,
            },
            mention_ids=[],
        )
    ]


def detect_ai_shift(
    answers: list[dict[str, Any]],
    *,
    tz: ZoneInfo,
    now: datetime,
) -> list[DetectedAlert]:
    """Caída de score de visibilidad IA sostenida 2 días, con ≥7 snapshots diarios."""
    daily_by_prompt: dict[str, dict[date, list[float]]] = defaultdict(lambda: defaultdict(list))
    all_daily: dict[date, list[float]] = defaultdict(list)
    for row in answers:
        when = _as_dt(row.get("captured_at") or row.get("created_at") or row.get("fetched_at"))
        if when is None:
            continue
        day = local_date(when, tz)
        if day is None:
            continue
        score = row.get("score")
        if score is None:
            score = row.get("visibility_score") or row.get("mention_score")
        try:
            val = float(score)
        except (TypeError, ValueError):
            continue
        key = str(row.get("prompt_key") or row.get("prompt") or "all")
        daily_by_prompt[key][day].append(val)
        all_daily[day].append(val)
    today = now.astimezone(tz).date()
    # Pedimos ≥7 snapshots en cada uno de los dos días (o en total reciente).
    def day_mean(day: date) -> tuple[float | None, int]:
        vals = all_daily.get(day) or []
        if not vals:
            return None, 0
        return sum(vals) / len(vals), len(vals)

    alerts = []
    # Promedio general
    d1, n1 = day_mean(today - timedelta(days=1))
    d2, n2 = day_mean(today - timedelta(days=2))
    base_days = [today - timedelta(days=i) for i in range(3, 10)]
    base_vals = [day_mean(d)[0] for d in base_days if day_mean(d)[0] is not None]
    base = statistics.mean(base_vals) if base_vals else None
    if (
        d1 is not None
        and d2 is not None
        and base is not None
        and n1 + n2 >= AI_SHIFT_MIN_SNAPSHOTS
        and (d1 - base) <= AI_SHIFT_AVG
        and (d2 - base) <= AI_SHIFT_AVG
    ):
        alerts.append(
            DetectedAlert(
                trigger_type="ai_shift",
                trigger_key=f"ai_shift:avg:{(today - timedelta(days=1)).isoformat()}",
                cluster_label="Caída de visibilidad en respuestas de IA",
                topic_id=None,
                window_start=datetime((today - timedelta(days=2)).year, (today - timedelta(days=2)).month, (today - timedelta(days=2)).day, tzinfo=tz),
                window_end=now,
                severity="medio",
                metrics={
                    "mean_day_1": round(d1, 2),
                    "mean_day_2": round(d2, 2),
                    "baseline_mean": round(base, 2),
                    "delta_day_1": round(d1 - base, 2),
                    "snapshots": n1 + n2,
                },
            )
        )
    for key, days in daily_by_prompt.items():
        def km(day: date) -> float | None:
            vals = days.get(day) or []
            return (sum(vals) / len(vals)) if vals else None
        a, b = km(today - timedelta(days=1)), km(today - timedelta(days=2))
        base_vals = [km(d) for d in base_days if km(d) is not None]
        base = statistics.mean(base_vals) if base_vals else None
        if a is None or b is None or base is None:
            continue
        if (a - base) <= AI_SHIFT_ONE and (b - base) <= AI_SHIFT_ONE:
            alerts.append(
                DetectedAlert(
                    trigger_type="ai_shift",
                    trigger_key=f"ai_shift:{key[:(80)]}:{(today - timedelta(days=1)).isoformat()}",
                    cluster_label=f"Caída de visibilidad IA en «{key}»",
                    topic_id=None,
                    window_start=datetime((today - timedelta(days=2)).year, (today - timedelta(days=2)).month, (today - timedelta(days=2)).day, tzinfo=tz),
                    window_end=now,
                    severity="medio",
                    metrics={
                        "prompt_key": key,
                        "mean_day_1": round(a, 2),
                        "mean_day_2": round(b, 2),
                        "baseline_mean": round(base, 2),
                        "delta_day_1": round(a - base, 2),
                    },
                )
            )
    return alerts


def watch(
    *,
    mentions: list[dict[str, Any]],
    suspicious_accounts: list[dict[str, Any]] | None = None,
    ads: list[dict[str, Any]] | None = None,
    ad_classifications: list[dict[str, Any]] | None = None,
    ai_answers: list[dict[str, Any]] | None = None,
    tz: ZoneInfo,
    now: datetime,
    extra_stop: Iterable[str] = (),
) -> list[DetectedAlert]:
    alerts: list[DetectedAlert] = []
    alerts.extend(detect_rising_topics(mentions, tz=tz, now=now, extra_stop=extra_stop))
    alerts.extend(detect_negative_spikes(mentions, tz=tz, now=now))
    alerts.extend(detect_suspicious_campaigns(suspicious_accounts or [], now=now))
    alerts.extend(detect_attack_ads(ads or [], ad_classifications or [], tz=tz, now=now))
    alerts.extend(detect_ai_shift(ai_answers or [], tz=tz, now=now))
    return alerts
