"""Cifras del resumen diario. Todo sale de las menciones; sin LLM.

Ventanas en la zona horaria del candidato:
- día: la fecha del resumen (por defecto, ayer completo);
- día anterior;
- base de 7 días: los 7 días completos previos a la fecha.

Una fuente cuenta como "estable" si trajo menciones en al menos 3 de los 7
días de base. Las comparaciones (variaciones) se calculan solo con fuentes
estables, para que el encendido de una fuente nueva no parezca un pico.
"""

from __future__ import annotations

import html
import re
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from pulso.crisis.watcher import MEDIA_SOURCES, is_notable, metric_int

NEGATIVE_TONES = frozenset({"critica", "acusacion", "insulto"})
POSITIVE_TONES = frozenset({"a_favor"})
NEUTRAL_TONES = frozenset({"informativo", "pregunta"})
BASELINE_DAYS = 7
STABLE_MIN_DAYS = 3
RELIABLE_MIN_BASE_DAYS = 5
RELIABLE_MIN_BASE_AVG = 5.0
# Si el día multiplica la base por más que esto, lo más probable es que se haya
# ampliado la recolección (fuente o candidato recién activados), no solo la conversación.
RELIABLE_MAX_RATIO = 6.0

WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MONTHS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

SOURCE_LABEL = {
    "rss_media": "medios (RSS)",
    "google_news": "Google News",
    "google_alerts": "Google Alerts",
    "x": "X",
    "youtube": "YouTube",
}


def spanish_date(d: date) -> str:
    return f"{WEEKDAYS[d.weekday()]} {d.day} de {MONTHS[d.month - 1]}"


def _dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None
        if len(text) == 10:
            text += "T00:00:00+00:00"
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def local_date(value: Any, tz: ZoneInfo) -> date | None:
    dt = _dt(value)
    return dt.astimezone(tz).date() if dt else None


def day_bounds(d: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime.combine(d, time.min, tzinfo=tz)
    end = datetime.combine(d + timedelta(days=1), time.min, tzinfo=tz)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def window_since(d: date, tz: ZoneInfo) -> datetime:
    return day_bounds(d - timedelta(days=BASELINE_DAYS), tz)[0]


def pct(value: float, base: float) -> int | None:
    if base is None or base <= 0:
        return None
    return int(round((value - base) / base * 100))


def is_third_party(m: dict[str, Any]) -> bool:
    return (m.get("account_relation") or "third_party") == "third_party"


def tone_counts(mentions: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Tono sobre el candidato (target = candidate). Balance −100..+100 como en la web."""
    neg = pos = neu = pending = total = 0
    for m in mentions:
        if m.get("target") != "candidate":
            continue
        total += 1
        tone = m.get("tone")
        if tone in NEGATIVE_TONES:
            neg += 1
        elif tone in POSITIVE_TONES:
            pos += 1
        elif tone in NEUTRAL_TONES:
            neu += 1
        else:
            pending += 1
    classified = neg + pos + neu
    balance = int(round((pos - neg) / classified * 100)) if classified else None
    return {
        "total": total,
        "criticas": neg,
        "a_favor": pos,
        "neutras": neu,
        "sin_clasificar": pending,
        "balance": balance,
    }


def engagement(m: dict[str, Any]) -> int:
    metrics = m.get("metrics") or {}
    return (
        metric_int(metrics, "impression_count", "impressions")
        + metric_int(metrics, "view_count", "views")
        + 20 * metric_int(metrics, "like_count", "likes")
        + 40 * metric_int(metrics, "repost_count", "retweet_count")
    )


def _clean(text: str | None, limit: int) -> str:
    text = re.sub(r"https?://\S+", "", html.unescape(text or ""))
    text = re.sub(r"\b\d{1,2}:\d{2}(?::\d{2})?\b", " ", text)  # marcas de capítulos
    text = re.sub(r"[|•\u00b7]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        text = text[: limit - 1].rsplit(" ", 1)[0] + "…"
    return text


def _norm_title(m: dict[str, Any]) -> str:
    base = (m.get("title") or m.get("content") or "").lower()
    base = re.sub(r"\s+[-–|]\s+[^-–|]{2,40}$", "", base)  # " - Medio"
    return re.sub(r"[^a-z0-9áéíóúñü ]", "", base)[:80].strip()


def compute_metrics(
    *,
    candidate: dict[str, Any],
    mentions: list[dict[str, Any]],
    topics: list[dict[str, Any]],
    brief_date: date,
    tz: ZoneInfo,
    ads: list[dict[str, Any]] | None = None,
    ad_classifications: list[dict[str, Any]] | None = None,
    alerts: list[dict[str, Any]] | None = None,
    show_ads: bool = True,
    min_mentions: int = 15,
) -> dict[str, Any]:
    prev_date = brief_date - timedelta(days=1)
    base_dates = [brief_date - timedelta(days=i) for i in range(1, BASELINE_DAYS + 1)]
    base_set = set(base_dates)
    by_day: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for m in mentions:
        if not is_third_party(m):
            continue
        d = local_date(m.get("published_at"), tz)
        if d is None:
            continue
        if d == brief_date or d in base_set:
            by_day[d].append(m)
    today = by_day.get(brief_date, [])
    prev = by_day.get(prev_date, [])
    base_all = [m for d in base_dates for m in by_day.get(d, [])]

    source_days: dict[str, set[date]] = defaultdict(set)
    for d in base_dates:
        for m in by_day.get(d, []):
            source_days[m.get("source") or "?"].add(d)
    stable = sorted(s for s, ds in source_days.items() if len(ds) >= STABLE_MIN_DAYS)
    today_sources = Counter(m.get("source") or "?" for m in today)
    new_sources = sorted(s for s in today_sources if s not in stable)
    base_days_with_data = sum(1 for d in base_dates if by_day.get(d))

    def stable_only(ms):
        return [m for m in ms if (m.get("source") or "?") in stable]

    today_c, prev_c = stable_only(today), stable_only(prev)
    base_c = stable_only(base_all)
    base_avg_c = round(len(base_c) / BASELINE_DAYS, 1)
    reliable = True
    reason = None
    if base_days_with_data < RELIABLE_MIN_BASE_DAYS:
        reliable = False
        reason = f"La base de comparación es corta: hay datos en {base_days_with_data} de los 7 días previos."
    elif not stable or base_avg_c < RELIABLE_MIN_BASE_AVG:
        reliable = False
        reason = "Los 7 días previos tienen muy pocas menciones para comparar."
    elif len(today_c) > RELIABLE_MAX_RATIO * base_avg_c:
        reliable = False
        reason = (
            "El volumen del día supera varias veces al de los 7 días previos; "
            "la comparación no es fiable porque la cobertura de fuentes se amplió en esos días."
        )

    tone_today = tone_counts(today)
    tone_prev = tone_counts(prev)
    tone_today_c = tone_counts(today_c)
    tone_base_c = tone_counts(base_c)
    tone_prev_c = tone_counts(prev_c)
    crit_base_avg = round(tone_base_c["criticas"] / BASELINE_DAYS, 1)
    fav_base_avg = round(tone_base_c["a_favor"] / BASELINE_DAYS, 1)

    # Temas (todas las fuentes del día; base con todas las fuentes).
    topic_label = {str(t.get("id")): t.get("label") for t in topics if t.get("label")}
    topic_today = Counter(str(m.get("topic_id")) for m in today if m.get("topic_id"))
    topic_neg_today = Counter(
        str(m.get("topic_id"))
        for m in today
        if m.get("topic_id") and m.get("target") == "candidate" and m.get("tone") in NEGATIVE_TONES
    )
    topic_base = Counter(str(m.get("topic_id")) for m in base_all if m.get("topic_id"))
    topic_rows = []
    for tid, n in topic_today.items():
        label = topic_label.get(tid)
        if not label:
            continue
        avg = round(topic_base.get(tid, 0) / BASELINE_DAYS, 1)
        topic_rows.append(
            {
                "tema": label,
                "topic_id": tid,
                "dia": n,
                "promedio_7d": avg,
                "criticas_dia": topic_neg_today.get(tid, 0),
                "var_pct": pct(n, avg),
                "nuevo": topic_base.get(tid, 0) == 0,
            }
        )
    topic_rows.sort(key=lambda r: (-r["dia"], r["tema"]))
    rising = [] if not reliable else [
        r for r in topic_rows
        if r["dia"] >= 3 and r["dia"] - r["promedio_7d"] >= 3 and (r["nuevo"] or r["dia"] >= 2 * r["promedio_7d"])
    ]
    rising.sort(key=lambda r: (-(r["dia"] - r["promedio_7d"]), r["tema"]))

    outlets: dict[str, dict[str, int]] = defaultdict(lambda: {"menciones": 0, "criticas": 0})
    for m in today:
        if (m.get("source") or "") in MEDIA_SOURCES and m.get("outlet"):
            row = outlets[m["outlet"]]
            row["menciones"] += 1
            if m.get("target") == "candidate" and m.get("tone") in NEGATIVE_TONES:
                row["criticas"] += 1
    top_outlets = sorted(
        ({"medio": k, **v} for k, v in outlets.items()), key=lambda r: (-r["menciones"], r["medio"])
    )[:5]

    ads_block = None
    if show_ads and ads is not None:
        stance_by = {}
        for c in ad_classifications or []:
            if c.get("meta_ad_id"):
                stance_by[str(c["meta_ad_id"])] = c.get("stance")
            if c.get("ad_id"):
                stance_by.setdefault(str(c["ad_id"]), c.get("stance"))
        new_today: Counter = Counter()
        new_base = 0
        for ad in ads:
            start = ad.get("ad_delivery_start_time") or ad.get("ad_creation_time")
            d = local_date(start, tz) if start and len(str(start)) > 10 else (
                date.fromisoformat(str(start)[:10]) if start else None
            )
            if d is None:
                continue
            stance = stance_by.get(str(ad.get("id"))) or stance_by.get(str(ad.get("ad_id"))) or "sin_clasificar"
            if d == brief_date:
                new_today[stance] += 1
            elif d in base_set:
                new_base += 1
        ads_block = {
            "nuevos_dia": sum(new_today.values()),
            "en_contra": new_today.get("en_contra", 0),
            "a_favor": new_today.get("a_favor", 0),
            "otros": new_today.get("neutral_otro", 0) + new_today.get("sin_clasificar", 0),
            "promedio_7d": round(new_base / BASELINE_DAYS, 1),
        }

    open_alerts = []
    seen_relatos: set[str] = set()
    start_utc, end_utc = day_bounds(brief_date, tz)
    for a in alerts or []:
        if a.get("status") not in {"new", "in_review"}:
            continue
        ws, we = _dt(a.get("window_start")), _dt(a.get("window_end")) or _dt(a.get("last_detected_at"))
        if ws and we and (we < start_utc or ws >= end_utc):
            continue
        relato = (a.get("cluster_label") or a.get("trigger_type") or "").strip()
        if relato.lower() in seen_relatos:
            continue
        seen_relatos.add(relato.lower())
        open_alerts.append(
            {"relato": a.get("cluster_label") or a.get("trigger_type"), "severidad": a.get("severity"),
             "tipo": a.get("trigger_type")}
        )
    sev_rank = {"alto": 0, "medio_alto": 1, "medio": 2, "bajo": 3}
    open_alerts.sort(key=lambda a: sev_rank.get(a.get("severidad") or "", 9))

    sufficient = len(today) >= min_mentions and (tone_today["total"] - tone_today["sin_clasificar"]) >= 5
    insufficient_reason = None
    if not sufficient:
        insufficient_reason = (
            f"Hubo {len(today)} menciones de terceros"
            + (f" y {tone_today['total'] - tone_today['sin_clasificar']} con tono clasificado sobre el candidato"
               if len(today) >= min_mentions else "")
            + "; no alcanza para sacar conclusiones del día."
        )

    comparison = {
        "fiable": reliable,
        "motivo": reason,
        "fuentes_estables": stable,
        "fuentes_nuevas": new_sources,
        "dias_base_con_datos": base_days_with_data,
        "dia": len(today_c),
        "dia_anterior": len(prev_c),
        "promedio_7d": base_avg_c,
        "var_vs_promedio_pct": pct(len(today_c), base_avg_c),
        "var_vs_anterior_pct": pct(len(today_c), len(prev_c)),
        "criticas_dia": tone_today_c["criticas"],
        "criticas_promedio_7d": crit_base_avg,
        "criticas_var_pct": pct(tone_today_c["criticas"], crit_base_avg),
        "a_favor_dia": tone_today_c["a_favor"],
        "a_favor_promedio_7d": fav_base_avg,
        "balance_dia": tone_today_c["balance"],
        "balance_dia_anterior": tone_prev_c["balance"],
        "balance_7d": tone_base_c["balance"],
    }
    if not reliable:
        # Sin base fiable no se informan variaciones: evita "+3000%" por una fuente recién activada.
        for key in ("var_vs_promedio_pct", "var_vs_anterior_pct", "criticas_var_pct", "dia_anterior",
                    "promedio_7d", "criticas_promedio_7d", "a_favor_promedio_7d", "balance_dia_anterior",
                    "balance_7d"):
            comparison[key] = None
        for r in topic_rows:
            r["var_pct"] = None
            r["promedio_7d"] = None
            r["nuevo"] = False

    return {
        "fecha": brief_date.isoformat(),
        "fecha_texto": spanish_date(brief_date),
        "dia_anterior": prev_date.isoformat(),
        "menciones": {
            "dia": len(today),
            "dia_anterior": len(prev) if reliable else None,
            "promedio_7d": round(len(base_all) / BASELINE_DAYS, 1) if reliable else None,
            "por_fuente": dict(sorted(today_sources.items(), key=lambda kv: -kv[1])),
        },
        "comparacion": comparison,
        "sobre_candidato": {"dia": tone_today, "dia_anterior": tone_prev if reliable else None},
        "temas": topic_rows[:8],
        "temas_en_suba": rising[:3],
        "medios": top_outlets,
        "anuncios": ads_block,
        "alertas_abiertas": open_alerts[:5],
        "suficiente": sufficient,
        "motivo_insuficiente": insufficient_reason,
    }


def select_pieces(
    mentions: list[dict[str, Any]],
    *,
    brief_date: date,
    tz: ZoneInfo,
    topics: list[dict[str, Any]],
    rising_topic_ids: list[str],
    limit: int = 36,
) -> list[dict[str, Any]]:
    """Menciones del día para el modelo: críticas con más alcance, apoyos, temas en suba y medios."""
    topic_label = {str(t.get("id")): t.get("label") for t in topics}
    pool = [
        m for m in mentions
        if is_third_party(m) and local_date(m.get("published_at"), tz) == brief_date and m.get("url")
    ]
    seen_titles: set[str] = set()
    unique = []
    for m in sorted(pool, key=lambda m: (-(m.get("source") in MEDIA_SOURCES), -engagement(m), str(m.get("id")))):
        key = _norm_title(m)
        if key and key in seen_titles:
            continue
        if key:
            seen_titles.add(key)
        unique.append(m)

    def rank(ms):
        return sorted(ms, key=lambda m: (-int(is_notable(m)), -engagement(m), str(m.get("id"))))

    about = [m for m in unique if m.get("target") == "candidate"]
    buckets = [
        (rank([m for m in about if m.get("tone") in NEGATIVE_TONES]), 10),
        (rank([m for m in about if m.get("tone") in POSITIVE_TONES]), 6),
    ]
    for tid in rising_topic_ids[:3]:
        buckets.append((rank([m for m in unique if str(m.get("topic_id")) == tid]), 4))
    buckets.append((rank([m for m in unique if m.get("source") in MEDIA_SOURCES]), limit))
    buckets.append((rank(unique), limit))
    chosen: list[dict[str, Any]] = []
    ids: set[str] = set()
    for items, cap in buckets:
        taken = 0
        for m in items:
            if len(chosen) >= limit or taken >= cap:
                break
            mid = str(m.get("id"))
            if mid in ids:
                continue
            ids.add(mid)
            chosen.append(m)
            taken += 1
    out = []
    for i, m in enumerate(chosen, start=1):
        metrics = m.get("metrics") or {}
        local = _dt(m.get("published_at")).astimezone(tz)
        piece = {
            "ref": f"m{i}",
            "id": str(m.get("id")),
            "fuente": m.get("source"),
            "medio_o_autor": (
                f"@{str(m['author_handle']).lstrip('@')}"
                if m.get("source") == "x" and m.get("author_handle")
                else m.get("outlet") or m.get("author")
            ),
            "hora": local.strftime("%H:%M"),
            "titulo": _clean(m.get("title"), 160),
            "extracto": _clean(m.get("content"), 260),
            "tono": m.get("tone"),
            "sobre": "candidato" if m.get("target") == "candidate" else (m.get("target") or "sin_dato"),
            "tema": topic_label.get(str(m.get("topic_id"))),
            "url": m.get("url"),
        }
        nums = {
            "impresiones": metric_int(metrics, "impression_count", "impressions"),
            "likes": metric_int(metrics, "like_count", "likes"),
            "reposts": metric_int(metrics, "repost_count", "retweet_count"),
            "vistas": metric_int(metrics, "view_count", "views"),
        }
        piece["metricas"] = {k: v for k, v in nums.items() if v}
        out.append(piece)
    return out


def highlight_options(metrics: dict[str, Any], candidate_name: str) -> list[dict[str, Any]]:
    """Datos destacados posibles, todos calculados. El modelo elige uno por clave."""
    comp = metrics["comparacion"]
    tone = metrics["sobre_candidato"]["dia"]
    reliable = comp["fiable"]
    opts = []

    def delta(v):
        return None if v is None or not reliable else f"{v:+d}% vs. promedio de 7 días"

    opts.append({
        "key": "volumen",
        "value": f"{metrics['menciones']['dia']:,}".replace(",", "."),
        "label": "menciones de terceros en el día",
        "delta": delta(comp["var_vs_promedio_pct"]),
        "tone": "neutral",
    })
    if tone["total"]:
        opts.append({
            "key": "criticas",
            "value": str(tone["criticas"]),
            "label": f"críticas sobre {candidate_name}",
            "delta": delta(comp["criticas_var_pct"]),
            "tone": "negative" if (comp["criticas_var_pct"] or 0) > 0 else "neutral",
        })
    if tone["balance"] is not None:
        bal_delta = None
        if reliable and comp["balance_dia"] is not None and comp["balance_7d"] is not None:
            bal_delta = f"{comp['balance_dia'] - comp['balance_7d']:+d} pts vs. 7 días"
        opts.append({
            "key": "balance",
            "value": f"{tone['balance']:+d}",
            "label": "balance del tono (−100 a +100)",
            "delta": bal_delta,
            "tone": "negative" if tone["balance"] < -5 else ("positive" if tone["balance"] > 5 else "neutral"),
        })
    for i, r in enumerate(metrics.get("temas_en_suba") or []):
        opts.append({
            "key": f"tema_{i + 1}",
            "value": str(r["dia"]),
            "label": f"menciones de «{r['tema']}»",
            "delta": "tema nuevo en la conversación" if r["nuevo"] else (
                f"{r['var_pct']:+d}% vs. su promedio de 7 días" if r["var_pct"] is not None else None
            ),
            "tone": "negative" if r["criticas_dia"] * 2 >= r["dia"] else "neutral",
        })
    ads = metrics.get("anuncios")
    if ads and ads["nuevos_dia"]:
        opts.append({
            "key": "anuncios",
            "value": str(ads["nuevos_dia"]),
            "label": "anuncios nuevos en Meta",
            "delta": f"{ads['en_contra']} en contra · {ads['a_favor']} a favor",
            "tone": "negative" if ads["en_contra"] > ads["a_favor"] else "neutral",
        })
    return opts


def default_highlight(options: list[dict[str, Any]], metrics: dict[str, Any]) -> dict[str, Any]:
    by = {o["key"]: o for o in options}
    if "tema_1" in by:
        return by["tema_1"]
    comp = metrics["comparacion"]
    if comp["fiable"] and abs(comp["criticas_var_pct"] or 0) >= 30 and "criticas" in by:
        return by["criticas"]
    return by.get("balance") or by["volumen"]
