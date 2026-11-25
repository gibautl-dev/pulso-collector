import { bucketFor, dayRange, type DayVolume } from "./analytics";
import { NEGATIVE_TONES, TONES } from "./labels";
import { dayKey } from "./time";
import type { Mention, Tone } from "./types";
import { metricNumber } from "./youtube";

const HANDLE_RE = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)\/status\//i;

/** Usuario de X, sin @. Usa author_handle o, si falta, lo saca de la URL del post. */
export function xHandle(m: Pick<Mention, "author_handle" | "url">): string | null {
  const raw = (m.author_handle ?? "").trim().replace(/^@/, "");
  if (raw) return raw;
  const handle = (m.url ?? "").match(HANDLE_RE)?.[1];
  if (!handle || handle.toLowerCase() === "i") return null;
  return handle;
}

export function xProfileUrl(handle: string): string {
  return `https://x.com/${handle.replace(/^@/, "")}`;
}

export function xPostText(m: Pick<Mention, "title" | "content">): string {
  const content = (m.content ?? "").trim();
  if (content) return content;
  return (m.title ?? "").trim() || "(sin texto)";
}

export interface XEngagement {
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  quotes: number | null;
  bookmarks: number | null;
  impressions: number | null;
  /** Suma de likes, reposts, respuestas, citas y guardados. */
  score: number;
}

export function xEngagement(m: Pick<Mention, "metrics">): XEngagement {
  const likes = metricNumber(m.metrics, "like_count");
  const reposts = metricNumber(m.metrics, "repost_count");
  const replies = metricNumber(m.metrics, "reply_count");
  const quotes = metricNumber(m.metrics, "quote_count");
  const bookmarks = metricNumber(m.metrics, "bookmark_count");
  const impressions = metricNumber(m.metrics, "impression_count");
  const score = (likes ?? 0) + (reposts ?? 0) + (replies ?? 0) + (quotes ?? 0) + (bookmarks ?? 0);
  return { likes, reposts, replies, quotes, bookmarks, impressions, score };
}

export function xFlag(m: Pick<Mention, "metrics">, key: "is_quote" | "is_reply" | "is_retweet"): boolean {
  return m.metrics?.[key] === true;
}

export { balanceCaption, balanceTone } from "./balance";

export function formatBalance(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

export interface XAuthorRow {
  key: string;
  handle: string | null;
  name: string;
  posts: number;
  engagement: number;
  followers: number | null;
  profileUrl: string | null;
}

export interface XViewData {
  periodDays: number;
  total: number;
  last24h: number;
  authors: number;
  aboutCandidate: number;
  pending: number;
  classifiedAboutCandidate: number;
  positiveAboutCandidate: number;
  negativeAboutCandidate: number;
  /** (a favor − críticas/acusaciones/insultos) sobre menciones clasificadas del candidato, −100 a +100. */
  balance: number | null;
  toneAboutCandidate: { tone: Tone; count: number }[];
  volume: DayVolume[];
  topAuthors: XAuthorRow[];
  mostEngaged: Mention[];
  recent: Mention[];
}

function authorKey(m: Mention): string {
  return (xHandle(m) ?? m.author ?? m.id).toLowerCase();
}

export function computeXView(
  all: Mention[],
  opts: { days: number; now?: Date; authorLimit?: number; engagedLimit?: number; recentLimit?: number; timeZone?: string },
): XViewData {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone;
  const since = new Date(now.getTime() - opts.days * 86400000);
  const mentions = all.filter(
    (m) => m.source === "x" && m.account_relation === "third_party" && new Date(m.published_at) >= since,
  );

  const days = dayRange(opts.days, now, timeZone);
  const volMap = new Map<string, DayVolume>(
    days.map((d) => [d, { day: d, total: 0, positivo: 0, neutral: 0, negativo: 0, pendiente: 0 }]),
  );
  const toneCount = new Map<Tone, number>(TONES.map((t) => [t, 0]));
  const authorMap = new Map<string, XAuthorRow>();

  let last24h = 0;
  let aboutCandidate = 0;
  let pending = 0;

  for (const m of mentions) {
    const b = bucketFor(m);
    const v = volMap.get(dayKey(m.published_at, timeZone));
    if (v) {
      v.total++;
      v[b]++;
    }
    if (now.getTime() - new Date(m.published_at).getTime() <= 86400000) last24h++;
    if (!m.tone) pending++;
    if (m.target === "candidate") {
      aboutCandidate++;
      if (m.tone) toneCount.set(m.tone, (toneCount.get(m.tone) ?? 0) + 1);
    }

    const key = authorKey(m);
    const handle = xHandle(m);
    const engagement = xEngagement(m).score;
    const followers = metricNumber(m.metrics, "author_followers");
    const row = authorMap.get(key) ?? {
      key,
      handle,
      name: (m.author ?? "").trim() || (handle ? `@${handle}` : "Cuenta sin nombre"),
      posts: 0,
      engagement: 0,
      followers,
      profileUrl: handle ? xProfileUrl(handle) : null,
    };
    row.posts++;
    row.engagement += engagement;
    if (row.followers == null && followers != null) row.followers = followers;
    if (!row.handle && handle) {
      row.handle = handle;
      row.profileUrl = xProfileUrl(handle);
    }
    authorMap.set(key, row);
  }

  const toneAboutCandidate = TONES.map((tone) => ({ tone, count: toneCount.get(tone) ?? 0 }));
  const negativeAboutCandidate = toneAboutCandidate
    .filter((t) => NEGATIVE_TONES.includes(t.tone))
    .reduce((s, t) => s + t.count, 0);
  const positiveAboutCandidate = toneCount.get("a_favor") ?? 0;
  const classifiedAboutCandidate = toneAboutCandidate.reduce((s, t) => s + t.count, 0);
  const balance =
    classifiedAboutCandidate > 0
      ? Math.round(((positiveAboutCandidate - negativeAboutCandidate) / classifiedAboutCandidate) * 100)
      : null;

  const mostEngaged = [...mentions].sort((a, b) => {
    const diff = xEngagement(b).score - xEngagement(a).score;
    return diff !== 0 ? diff : b.published_at.localeCompare(a.published_at);
  }).slice(0, opts.engagedLimit ?? 8);

  const recent = [...mentions]
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .slice(0, opts.recentLimit ?? 25);

  const topAuthors = [...authorMap.values()].sort(
    (a, b) => b.posts - a.posts || b.engagement - a.engagement || a.name.localeCompare(b.name, "es"),
  ).slice(0, opts.authorLimit ?? 10);

  return {
    periodDays: opts.days,
    total: mentions.length,
    last24h,
    authors: authorMap.size,
    aboutCandidate,
    pending,
    classifiedAboutCandidate,
    positiveAboutCandidate,
    negativeAboutCandidate,
    balance,
    toneAboutCandidate,
    volume: days.map((d) => volMap.get(d)!),
    topAuthors,
    mostEngaged,
    recent,
  };
}

