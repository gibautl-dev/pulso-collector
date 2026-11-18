"""Señales baratas sobre menciones de X y comentarios de YouTube, sin LLM.

No denuncia cuentas ni llama a APIs de las redes. Solo arma un puntaje y
evidencia para que una persona revise y, si corresponde, denuncie a mano.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
import re
import unicodedata

PLATFORMS = {"x", "youtube"}
STATUSES = ("pending", "reviewed_suspicious", "discarded", "reported_manual")
MIN_TEXT_LEN = 24
MIN_COORD_TEXT_LEN = 40
NEAR_DUP_RATIO = 0.88
SELF_REPEAT_MIN = 3
SELF_REPEAT_LONG_MIN = 2
COORD_AUTHORS_MIN = 3
BURST_WINDOW = timedelta(hours=1)
BURST_MIN = 5
BURST_LONG_WINDOW = timedelta(hours=6)
BURST_LONG_MIN = 8
GROUP_BURST_WINDOW = timedelta(minutes=60)
GROUP_BURST_MIN = 5
NEW_DAYS_HIGH = 30
NEW_DAYS_MED = 90
FOLLOW_RATIO = 8
FOLLOW_RATIO_FOLLOWING = 150
LOW_FOLLOWERS = 80
DIGIT_MIN = 4
DIGIT_STRONG = 6
LOW_ENGAGEMENT_POSTS = 5
LOW_ENGAGEMENT_AVG = 1.0
MEDIA_FOLLOWERS = 10_000
SCORE_THRESHOLD = 20
EXCERPT_LEN = 180
MAX_EVIDENCE = 8

_URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
_MENTION_RE = re.compile(r"[@#]\w+")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9áéíóúüñ\s]+")
_DIGIT_RE = re.compile(r"\d")


def _as_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_time(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        published = value
    else:
        text = str(value).replace("Z", "+00:00")
        try:
            published = datetime.fromisoformat(text)
        except ValueError:
            return None
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    return published.astimezone(timezone.utc)


def normalize_text(text: str) -> str:
    raw = _URL_RE.sub(" ", text or "")
    raw = _MENTION_RE.sub(" ", raw)
    raw = unicodedata.normalize("NFKD", raw)
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = raw.lower()
    raw = _NON_ALNUM_RE.sub(" ", raw)
    return " ".join(raw.split())


def fingerprint(text: str) -> str:
    return normalize_text(text)


def is_youtube_comment(metrics: dict | None) -> bool:
    return bool((metrics or {}).get("video_id"))


def mention_kind(source: str, metrics: dict | None) -> str | None:
    if source == "x":
        return "post"
    if source == "youtube" and is_youtube_comment(metrics):
        return "comment"
    return None


def profile_url(source: str, handle: str | None, author: str | None = None) -> str | None:
    if source == "x" and handle:
        return f"https://x.com/{handle.lstrip('@')}"
    if source == "youtube":
        if author and str(author).startswith("@") and " " not in str(author).strip():
            return f"https://www.youtube.com/{str(author).strip()}"
        if handle:
            return f"https://www.youtube.com/channel/{handle}"
    return None


def digit_count(value: str | None) -> int:
    return len(_DIGIT_RE.findall(value or ""))


@dataclass
class MentionRecord:
    id: str
    candidate_id: str
    source: str
    url: str
    text: str
    author: str | None
    author_handle: str | None
    published_at: datetime
    metrics: dict = field(default_factory=dict)
    account_relation: str = "third_party"

    @property
    def kind(self) -> str | None:
        return mention_kind(self.source, self.metrics)

    @property
    def account_key(self) -> str | None:
        handle = (self.author_handle or "").strip()
        if handle:
            return handle.lstrip("@").lower() if self.source == "x" else handle
        name = (self.author or "").strip()
        return name.lower() if name else None

    @classmethod
    def from_row(cls, row: dict) -> "MentionRecord | None":
        source = row.get("source")
        if source not in PLATFORMS:
            return None
        if mention_kind(source, row.get("metrics") or {}) is None:
            return None
        published = _parse_time(row.get("published_at"))
        if not published:
            return None
        text = (row.get("content") or row.get("title") or "").strip()
        mid = str(row.get("id") or "")
        cid = str(row.get("candidate_id") or "")
        if not mid or not cid:
            return None
        return cls(
            id=mid,
            candidate_id=cid,
            source=source,
            url=row.get("url") or "",
            text=text,
            author=row.get("author"),
            author_handle=row.get("author_handle"),
            published_at=published,
            metrics=dict(row.get("metrics") or {}),
            account_relation=row.get("account_relation") or "third_party",
        )


@dataclass
class Evidence:
    mention_id: str
    url: str
    published_at: str
    excerpt: str
    fingerprint: str | None = None


@dataclass
class Signal:
    type: str
    weight: int
    summary: str
    evidence: list[Evidence] = field(default_factory=list)


@dataclass
class SuspiciousAccount:
    candidate_id: str
    platform: str
    account_key: str
    handle: str | None
    display_name: str | None
    profile_url: str | None
    score: int
    signals: list[Signal]
    first_seen_at: str
    last_seen_at: str
    account_created_at: str | None
    mention_count: int
    status: str = "pending"

    def to_dict(self) -> dict:
        payload = asdict(self)
        payload["signals"] = [
            {
                "type": sig.type,
                "weight": sig.weight,
                "summary": sig.summary,
                "evidence": [asdict(item) for item in sig.evidence],
            }
            for sig in self.signals
        ]
        return payload


def _excerpt(text: str) -> str:
    clean = " ".join((text or "").split())
    if len(clean) <= EXCERPT_LEN:
        return clean
    return clean[: EXCERPT_LEN - 1] + "…"


def _evidence(mentions: list[MentionRecord], fp: str | None = None) -> list[Evidence]:
    ranked = sorted(mentions, key=lambda m: m.published_at)
    out = []
    for mention in ranked[:MAX_EVIDENCE]:
        out.append(Evidence(
            mention_id=mention.id,
            url=mention.url,
            published_at=mention.published_at.isoformat(),
            excerpt=_excerpt(mention.text),
            fingerprint=fp,
        ))
    return out


def _is_media(metrics: dict) -> bool:
    followers = _as_int(metrics.get("author_followers")) or 0
    verified = metrics.get("author_verified_type") in {"business", "government"}
    return followers >= MEDIA_FOLLOWERS or bool(verified and followers >= 5_000)


class _Account:
    def __init__(self, mention: MentionRecord):
        self.candidate_id = mention.candidate_id
        self.platform = mention.source
        self.key = mention.account_key
        self.handle = mention.author_handle
        self.display_name = mention.author
        self.mentions: list[MentionRecord] = []
        self.signals: list[Signal] = []

    def add(self, mention: MentionRecord) -> None:
        self.mentions.append(mention)
        if mention.author_handle:
            self.handle = mention.author_handle
        if mention.author:
            self.display_name = mention.author

    @property
    def metrics(self) -> dict:
        for mention in reversed(self.mentions):
            if mention.metrics:
                return mention.metrics
        return {}

    def created_at(self) -> datetime | None:
        return _parse_time(self.metrics.get("author_created_at"))


def _bucket_near_duplicates(items: list[tuple[str, MentionRecord]]) -> list[list[MentionRecord]]:
    """Agrupa por huella exacta y une textos casi iguales en el mismo prefijo."""
    exact: dict[str, list[MentionRecord]] = defaultdict(list)
    for fp, mention in items:
        exact[fp].append(mention)
    groups = list(exact.values())
    # Prefijo de 16 caracteres: compara pocos pares, no todo contra todo.
    prefixes: dict[str, list[str]] = defaultdict(list)
    for fp in exact:
        if len(fp) >= MIN_COORD_TEXT_LEN:
            prefixes[fp[:16]].append(fp)
    merged = {fp: fp for fp in exact}
    for fps in prefixes.values():
        for i, left in enumerate(fps):
            for right in fps[i + 1:]:
                if merged[left] == merged[right]:
                    continue
                if SequenceMatcher(None, left, right).ratio() >= NEAR_DUP_RATIO:
                    root, other = merged[left], merged[right]
                    for fp, value in list(merged.items()):
                        if value == other:
                            merged[fp] = root
    combined: dict[str, list[MentionRecord]] = defaultdict(list)
    for fp, root in merged.items():
        combined[root].extend(exact[fp])
    return list(combined.values())


def _self_repeat(account: _Account) -> Signal | None:
    usable = [(fingerprint(m.text), m) for m in account.mentions if len(fingerprint(m.text)) >= MIN_TEXT_LEN]
    if not usable:
        return None
    best = None
    for group in _bucket_near_duplicates(usable):
        fp = fingerprint(group[0].text)
        long_enough = len(fp) >= MIN_COORD_TEXT_LEN
        minimum = SELF_REPEAT_LONG_MIN if long_enough else SELF_REPEAT_MIN
        if len(group) < minimum:
            continue
        if best is None or len(group) > len(best):
            best = group
    if not best:
        return None
    weight = min(35, 15 + 5 * (len(best) - (SELF_REPEAT_LONG_MIN if len(fingerprint(best[0].text)) >= MIN_COORD_TEXT_LEN else SELF_REPEAT_MIN)))
    return Signal(
        type="self_repeat",
        weight=weight,
        summary=f"{len(best)} publicaciones con el mismo texto o uno casi idéntico",
        evidence=_evidence(best, fingerprint(best[0].text)),
    )


def _account_id(mention: MentionRecord) -> tuple[str, str, str] | None:
    if not mention.account_key:
        return None
    return (mention.candidate_id, mention.source, mention.account_key)


def _coordination(mentions: list[MentionRecord]) -> dict[tuple[str, str, str], Signal]:
    """Autores distintos, mismo candidato y plataforma, con el mismo texto (o casi)."""
    flags: dict[tuple[str, str, str], Signal] = {}
    by_scope: dict[tuple[str, str], list[MentionRecord]] = defaultdict(list)
    for mention in mentions:
        if len(fingerprint(mention.text)) >= MIN_COORD_TEXT_LEN:
            by_scope[(mention.candidate_id, mention.source)].append(mention)
    for scoped in by_scope.values():
        usable = [(fingerprint(m.text), m) for m in scoped]
        for group in _bucket_near_duplicates(usable):
            authors = { _account_id(m) for m in group if _account_id(m) }
            if len(authors) < COORD_AUTHORS_MIN:
                continue
            weight = min(50, 25 + 5 * (len(authors) - COORD_AUTHORS_MIN))
            summary = f"{len(authors)} cuentas publicaron el mismo texto o uno casi idéntico"
            for key in authors:
                own = [m for m in group if _account_id(m) == key]
                mixed = own + [m for m in group if _account_id(m) != key]
                flags[key] = Signal(
                    type="coordination",
                    weight=weight,
                    summary=summary,
                    evidence=_evidence(mixed, fingerprint(group[0].text)),
                )
    return flags


def _author_burst(account: _Account) -> Signal | None:
    times = sorted(m.published_at for m in account.mentions)
    if len(times) < BURST_MIN:
        return None

    def window_hit(span: timedelta, minimum: int) -> list[MentionRecord] | None:
        start = 0
        for end, moment in enumerate(times):
            while moment - times[start] > span:
                start += 1
            if end - start + 1 >= minimum:
                lo, hi = times[start], moment
                return [m for m in account.mentions if lo <= m.published_at <= hi]
        return None

    group = window_hit(BURST_WINDOW, BURST_MIN) or window_hit(BURST_LONG_WINDOW, BURST_LONG_MIN)
    if not group:
        return None
    hours = BURST_WINDOW if len(group) >= BURST_MIN and (max(m.published_at for m in group) - min(m.published_at for m in group)) <= BURST_WINDOW else BURST_LONG_WINDOW
    label = "1 hora" if hours == BURST_WINDOW else "6 horas"
    return Signal(
        type="author_burst",
        weight=20,
        summary=f"{len(group)} publicaciones en {label}",
        evidence=_evidence(group),
    )



def _public_digit_count(account: _Account) -> int:
    """En YouTube el handle es el channel id (siempre trae dígitos); se mira el @ visible."""
    if account.platform == "youtube":
        return digit_count(account.display_name)
    return max(digit_count(account.handle), digit_count(account.display_name))


def _cheap_quality(account: _Account, now: datetime) -> list[Signal]:
    if _is_media(account.metrics):
        return []
    signals = []
    created = account.created_at()
    if created:
        age = now - created
        if age <= timedelta(days=NEW_DAYS_HIGH):
            signals.append(Signal(
                type="new_account",
                weight=25,
                summary=f"Cuenta creada hace {max(0, age.days)} días",
                evidence=_evidence(account.mentions[:3]),
            ))
        elif age <= timedelta(days=NEW_DAYS_MED):
            signals.append(Signal(
                type="new_account",
                weight=15,
                summary=f"Cuenta creada hace {age.days} días",
                evidence=_evidence(account.mentions[:3]),
            ))
    followers = _as_int(account.metrics.get("author_followers"))
    following = _as_int(account.metrics.get("author_following"))
    if followers is not None and following is not None and followers < LOW_FOLLOWERS and following >= FOLLOW_RATIO_FOLLOWING:
        ratio = following / max(followers, 1)
        if ratio >= FOLLOW_RATIO:
            weight = 10
            if ratio >= 15:
                weight += 5
            if followers < 20:
                weight += 5
            signals.append(Signal(
                type="follow_ratio",
                weight=min(20, weight),
                summary=f"{following} seguidos y {followers} seguidores (relación {ratio:.1f} a 1)",
                evidence=_evidence(account.mentions[:2]),
            ))
    digits = _public_digit_count(account)
    if digits >= DIGIT_MIN:
        weight = 12 if digits >= DIGIT_STRONG else 10
        signals.append(Signal(
            type="digit_name",
            weight=weight,
            summary=f"El identificador incluye {digits} dígitos",
            evidence=_evidence(account.mentions[:2]),
        ))
    if len(account.mentions) >= LOW_ENGAGEMENT_POSTS:
        totals = []
        for mention in account.mentions:
            likes = _as_int(mention.metrics.get("like_count")) or 0
            reposts = _as_int(mention.metrics.get("repost_count")) or 0
            totals.append(likes + reposts)
        avg = sum(totals) / len(totals)
        if avg <= LOW_ENGAGEMENT_AVG:
            signals.append(Signal(
                type="low_engagement",
                weight=10,
                summary=f"{len(account.mentions)} publicaciones con un promedio de {avg:.1f} likes y reposts",
                evidence=_evidence(account.mentions[:MAX_EVIDENCE]),
            ))
    return signals


def _weak_account(account: _Account, now: datetime) -> bool:
    if _is_media(account.metrics):
        return False
    created = account.created_at()
    if created and now - created <= timedelta(days=NEW_DAYS_MED):
        return True
    followers = _as_int(account.metrics.get("author_followers"))
    following = _as_int(account.metrics.get("author_following"))
    if followers is not None and following is not None and followers < LOW_FOLLOWERS and following >= FOLLOW_RATIO_FOLLOWING:
        if following / max(followers, 1) >= FOLLOW_RATIO:
            return True
    return _public_digit_count(account) >= DIGIT_STRONG


def _group_bursts(accounts: dict[tuple[str, str, str], _Account], now: datetime) -> dict[tuple[str, str, str], Signal]:
    weak_mentions = []
    for account in accounts.values():
        if not _weak_account(account, now):
            continue
        weak_mentions.extend(account.mentions)
    if not weak_mentions:
        return {}
    by_scope: dict[tuple[str, str], list[MentionRecord]] = defaultdict(list)
    for mention in weak_mentions:
        by_scope[(mention.candidate_id, mention.source)].append(mention)
    flags: dict[tuple[str, str, str], Signal] = {}
    for scoped in by_scope.values():
        by_time = sorted(scoped, key=lambda m: m.published_at)
        start = 0
        for end, mention in enumerate(by_time):
            while mention.published_at - by_time[start].published_at > GROUP_BURST_WINDOW:
                start += 1
            window = by_time[start:end + 1]
            keys = {_account_id(m) for m in window if _account_id(m)}
            if len(keys) < GROUP_BURST_MIN:
                continue
            signal = Signal(
                type="group_burst",
                weight=15,
                summary=f"{len(keys)} cuentas con señales débiles publicaron en una hora",
                evidence=_evidence(window),
            )
            for key in keys:
                flags[key] = signal
    return flags


def detect(rows: list[dict] | list[MentionRecord], now: datetime | None = None) -> list[SuspiciousAccount]:
    now = now or datetime.now(timezone.utc)
    mentions: list[MentionRecord] = []
    for row in rows:
        mention = row if isinstance(row, MentionRecord) else MentionRecord.from_row(row)
        if mention is None or mention.account_relation in {"own", "reference"}:
            continue
        if not mention.account_key:
            continue
        mentions.append(mention)
    accounts: dict[tuple[str, str, str], _Account] = {}
    for mention in mentions:
        key = (mention.candidate_id, mention.source, mention.account_key)
        account = accounts.get(key)
        if account is None:
            account = _Account(mention)
            accounts[key] = account
        account.add(mention)
    coord = _coordination(mentions)
    groups = _group_bursts(accounts, now)
    found: list[SuspiciousAccount] = []
    for key, account in accounts.items():
        _cid, _platform, account_key = key
        signals: list[Signal] = []
        for maybe in (_self_repeat(account), _author_burst(account), coord.get(key), groups.get(key)):
            if maybe:
                signals.append(maybe)
        signals.extend(_cheap_quality(account, now))
        if not signals:
            continue
        # Evitar duplicar el mismo tipo con distinto peso.
        unique: dict[str, Signal] = {}
        for sig in signals:
            prev = unique.get(sig.type)
            if prev is None or sig.weight > prev.weight:
                unique[sig.type] = sig
        signals = list(unique.values())
        score = min(100, sum(sig.weight for sig in signals))
        if score < SCORE_THRESHOLD:
            continue
        times = [m.published_at for m in account.mentions]
        created = account.created_at()
        found.append(SuspiciousAccount(
            candidate_id=account.candidate_id,
            platform=account.platform,
            account_key=key,
            handle=account.handle,
            display_name=account.display_name,
            profile_url=profile_url(account.platform, account.handle, account.display_name),
            score=score,
            signals=sorted(signals, key=lambda s: s.weight, reverse=True),
            first_seen_at=min(times).isoformat(),
            last_seen_at=max(times).isoformat(),
            account_created_at=created.isoformat() if created else None,
            mention_count=len(account.mentions),
        ))
    found.sort(key=lambda a: (-a.score, a.account_key))
    return found


def summarize(accounts: list[SuspiciousAccount]) -> dict:
    by_signal: dict[str, int] = defaultdict(int)
    by_platform: dict[str, int] = defaultdict(int)
    for account in accounts:
        by_platform[account.platform] += 1
        for sig in account.signals:
            by_signal[sig.type] += 1
    return {
        "accounts_marked": len(accounts),
        "threshold": SCORE_THRESHOLD,
        "by_signal": dict(by_signal),
        "by_platform": dict(by_platform),
        "accounts": [a.to_dict() for a in accounts],
    }
