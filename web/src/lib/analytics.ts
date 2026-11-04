import { NEGATIVE_TONES, TONES } from "./labels";
import type { Mention, Relevance, Tone, Topic } from "./types";
import { dayKey } from "./time";

export type ToneBucket = "positivo" | "neutral" | "negativo" | "pendiente";

export interface DayVolume {
  day: string; // YYYY-MM-DD ART
  total: number;
  positivo: number;
  neutral: number;
  negativo: number;
  pendiente: number;
}

export interface DashboardData {
  periodDays: number;
  total: number;
  last24h: number;
  aboutCandidate: number;
  aboutOthers: number;
  unclear: number;
  pending: number;
  negativeAboutCandidate: number;
  positiveAboutCandidate: number;
  /** Desglose de tono SOLO de menciones con target=candidate. */
  toneAboutCandidate: { tone: Tone; count: number }[];
  /** Críticas que el candidato (o su entorno) hace a terceros: no cuentan en contra. */
  criticismOfOthers: number;
  volume: DayVolume[];
  topTopics: { topicId: string | null; label: string; count: number; negative: number }[];
  topOutlets: { outlet: string; count: number; negative: number }[];
  highlights: Mention[];
}

export function bucketFor(m: Pick<Mention, "tone" | "target">): ToneBucket {
  if (!m.tone) return "pendiente";
  // Solo es negativo/positivo "para el candidato" si el objetivo es él.
  if (m.target === "candidate" && NEGATIVE_TONES.includes(m.tone)) return "negativo";
  if (m.target === "candidate" && m.tone === "a_favor") return "positivo";
  return "neutral";
}

const RELEVANCE_RANK: Record<Relevance, number> = { alta: 0, media: 1, baja: 2 };

export function isHighlight(m: Mention): boolean {
  return m.target === "candidate" && m.tone !== null && NEGATIVE_TONES.includes(m.tone);
}

/** Lista de días (ART) desde hoy-(n-1) hasta hoy, para mostrar ceros también. */
export function dayRange(days: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(dayKey(new Date(now.getTime() - i * 86400000)));
  }
  return Array.from(new Set(out));
}

export function computeDashboard(
  all: Mention[],
  topics: Topic[],
  opts: { days: number; now?: Date; highlightLimit?: number },
): DashboardData {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * 86400000);
  // Por diseño, solo third_party entra al radar de reputación.
  const mentions = all.filter(
    (m) => m.account_relation === "third_party" && new Date(m.published_at) >= since,
  );
  const topicLabel = new Map(topics.map((t) => [t.id, t.label]));

  const days = dayRange(opts.days, now);
  const volMap = new Map<string, DayVolume>(
    days.map((d) => [d, { day: d, total: 0, positivo: 0, neutral: 0, negativo: 0, pendiente: 0 }]),
  );
  const toneCount = new Map<Tone, number>(TONES.map((t) => [t, 0]));
  const topicMap = new Map<string, { topicId: string | null; label: string; count: number; negative: number }>();
  const outletMap = new Map<string, { outlet: string; count: number; negative: number }>();

  let last24h = 0;
  let aboutCandidate = 0;
  let aboutOthers = 0;
  let unclear = 0;
  let pending = 0;
  let criticismOfOthers = 0;

  for (const m of mentions) {
    const b = bucketFor(m);
    const v = volMap.get(dayKey(m.published_at));
    if (v) {
      v.total++;
      v[b]++;
    }
    if (now.getTime() - new Date(m.published_at).getTime() <= 86400000) last24h++;
    if (!m.tone) pending++;
    if (m.target === "candidate") {
      aboutCandidate++;
      if (m.tone) toneCount.set(m.tone, (toneCount.get(m.tone) ?? 0) + 1);
    } else if (m.target === "other") {
      aboutOthers++;
      if (m.tone && NEGATIVE_TONES.includes(m.tone)) criticismOfOthers++;
    } else if (m.target === "unclear") {
      unclear++;
    }

    if (m.tone) {
      const key = m.topic_id ?? "none";
      const t = topicMap.get(key) ?? {
        topicId: m.topic_id,
        label: m.topic_id ? (topicLabel.get(m.topic_id) ?? "Tema") : "Sin tema",
        count: 0,
        negative: 0,
      };
      t.count++;
      if (b === "negativo") t.negative++;
      topicMap.set(key, t);
    }

    const outlet = (m.outlet ?? "").trim() || "Sin medio";
    const o = outletMap.get(outlet) ?? { outlet, count: 0, negative: 0 };
    o.count++;
    if (b === "negativo") o.negative++;
    outletMap.set(outlet, o);
  }

  const highlights = mentions
    .filter(isHighlight)
    .sort((a, b) => {
      const ra = RELEVANCE_RANK[a.relevance ?? "baja"];
      const rb = RELEVANCE_RANK[b.relevance ?? "baja"];
      return ra !== rb ? ra - rb : b.published_at.localeCompare(a.published_at);
    })
    .slice(0, opts.highlightLimit ?? 8);

  const toneAboutCandidate = TONES.map((tone) => ({ tone, count: toneCount.get(tone) ?? 0 }));
  const negativeAboutCandidate = toneAboutCandidate
    .filter((t) => NEGATIVE_TONES.includes(t.tone))
    .reduce((s, t) => s + t.count, 0);

  return {
    periodDays: opts.days,
    total: mentions.length,
    last24h,
    aboutCandidate,
    aboutOthers,
    unclear,
    pending,
    negativeAboutCandidate,
    positiveAboutCandidate: toneCount.get("a_favor") ?? 0,
    toneAboutCandidate,
    criticismOfOthers,
    volume: days.map((d) => volMap.get(d)!),
    topTopics: [...topicMap.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    topOutlets: [...outletMap.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    highlights,
  };
}

export interface SourceHealth {
  source: string;
  lastRun?: { status: string; started_at: string; finished_at: string | null; error: string | null };
  runs24h: number;
  ok24h: number;
  partial24h: number;
  error24h: number;
  new24h: number;
}

export function computeSourceHealth(
  runs: { source: string; status: string; started_at: string; finished_at: string | null; error: string | null; items_new: number }[],
  now = new Date(),
): SourceHealth[] {
  const map = new Map<string, SourceHealth>();
  const sorted = [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at));
  for (const r of sorted) {
    const h = map.get(r.source) ?? { source: r.source, runs24h: 0, ok24h: 0, partial24h: 0, error24h: 0, new24h: 0 };
    if (!h.lastRun) h.lastRun = { status: r.status, started_at: r.started_at, finished_at: r.finished_at, error: r.error };
    if (now.getTime() - new Date(r.started_at).getTime() <= 86400000) {
      h.runs24h++;
      if (r.status === "ok") h.ok24h++;
      if (r.status === "partial") h.partial24h++;
      if (r.status === "error") h.error24h++;
      h.new24h += r.items_new;
    }
    map.set(r.source, h);
  }
  return [...map.values()].sort((a, b) => a.source.localeCompare(b.source));
}
