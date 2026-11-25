/** Comparación entre un candidato y rivales ya recolectados. Sin I/O. */

import { bucketFor, computeDashboard, type DashboardData, type DayVolume } from "./analytics";
import { computeAiDashboard } from "./ai-visibility";
import { aggregateSpend, isAdActive, stanceSplit } from "./meta-ads";
import { computeSuspiciousInsights } from "./suspicious-insights";
import { regionFor } from "./region";
import type { AiAnswer, Candidate, Mention, MetaAd, RivalLevel, SuspiciousAccount, Topic } from "./types";
import { computeXView } from "./x-posts";
import { mentionsInWindow, windowCalendarDays, type CommonWindow } from "./comparison-window";

export const MEDIA_SOURCES = new Set(["rss_media", "google_news", "google_alerts"]);

export function mentionsForLevel(mentions: Mention[], level: RivalLevel): Mention[] {
  if (level === "radar") return mentions.filter((m) => MEDIA_SOURCES.has(m.source));
  return mentions;
}

export interface SubjectPack {
  candidate: Candidate;
  mentions: Mention[];
  topics: Topic[];
  ads: MetaAd[];
  answers: AiAnswer[];
  suspicious: SuspiciousAccount[];
  /**
   * Si Pulso recolecta anuncios de este sujeto. Por defecto: hay anuncios
   * guardados. Un rival dado de alta solo con medios no tiene pauta medida:
   * comparar “0 anuncios” sería engañoso.
   */
  adsCollected?: boolean;
}

export interface SubjectSnapshot {
  candidate: Candidate;
  dashboard: DashboardData;
  mediaCount: number;
  xTotal: number | null;
  xBalance: number | null;
  aiBalance: number | null;
  aiAnswers: number;
  adsActive: number | null;
  adsAgainst: number | null;
  adsSpendHint: string | null;
  suspiciousCount: number | null;
  volume: DayVolume[];
  showMetaAds: boolean;
  adsCollected: boolean;
  showAi: boolean;
  showX: boolean;
  showSuspicious: boolean;
  mediaHighlights: Mention[];
}

type CompareOpts = { days: number; now: Date; level: RivalLevel; timeZone?: string; window?: CommonWindow | null };

function snapshot(pack: SubjectPack, rawOpts: CompareOpts): SubjectSnapshot {
  const win = rawOpts.window ?? null;
  // Con ventana común: mismas fuentes y mismo período para los dos sujetos.
  const opts = win ? { ...rawOpts, days: windowCalendarDays(win, rawOpts.timeZone) } : rawOpts;
  const level = opts.level;
  const leveled = mentionsForLevel(pack.mentions, level);
  const mentions = win ? mentionsInWindow(leveled, win) : leveled;
  const xCompared = !win || win.sources.includes("x");
  const region = regionFor(pack.candidate.slug);
  const dashboard = computeDashboard(mentions, pack.topics, {
    days: opts.days,
    now: opts.now,
    timeZone: opts.timeZone,
  });
  const media = mentions.filter((m) => MEDIA_SOURCES.has(m.source) && m.account_relation === "third_party");
  const x = level === "radar" || !xCompared ? null : computeXView(mentions, { days: opts.days, now: opts.now, timeZone: opts.timeZone });
  const ia = level === "completo" ? computeAiDashboard(pack.answers) : null;
  const showMetaAds = level !== "radar" && region.showMetaAds;
  const ads = showMetaAds ? stanceSplit(pack.ads, opts.now) : null;
  const adsActive = showMetaAds ? pack.ads.filter((ad) => isAdActive(ad, opts.now)).length : null;
  const spend = showMetaAds ? aggregateSpend(pack.ads) : [];
  const susp =
    level === "completo"
      ? computeSuspiciousInsights(mentions, pack.suspicious, pack.topics, { days: opts.days, now: opts.now })
      : null;
  const mediaHighlights = media
    .filter((m) => bucketFor(m) === "negativo")
    .slice()
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .slice(0, 5);

  return {
    candidate: pack.candidate,
    dashboard,
    mediaCount: media.length,
    xTotal: x ? x.total : null,
    xBalance: x ? x.balance : null,
    aiBalance: ia ? ia.latestBalance ?? ia.overallBalance : null,
    aiAnswers: ia ? ia.total : 0,
    adsActive,
    adsAgainst: ads ? (ads.rows.find((r) => r.stance === "en_contra")?.ads ?? 0) : null,
    adsSpendHint: spend.length ? spend.map((s) => `${s.currency} ${Math.round((s.lowerSum + s.upperSum) / 2).toLocaleString("es-AR")}`).join(" · ") : null,
    suspiciousCount: susp ? susp.flaggedAuthors : null,
    volume: dashboard.volume,
    showMetaAds,
    adsCollected: pack.adsCollected ?? pack.ads.length > 0,
    showAi: level === "completo",
    showX: level !== "radar" && xCompared,
    showSuspicious: level === "completo",
    mediaHighlights,
  };
}

export interface ComparisonDay {
  day: string;
  candidate: number;
  rival: number;
}

export interface AdsPageRank {
  page: string;
  candidate: number;
  rival: number;
}

export interface RivalComparison {
  level: RivalLevel;
  window: CommonWindow | null;
  candidate: SubjectSnapshot;
  rival: SubjectSnapshot;
  volumeVs: ComparisonDay[];
  adsRanking: AdsPageRank[];
}

export function buildRivalComparison(
  candidate: SubjectPack,
  rival: SubjectPack,
  opts: CompareOpts,
): RivalComparison {
  const left = snapshot(candidate, opts);
  const right = snapshot(rival, opts);
  const days = new Map<string, ComparisonDay>();
  for (const row of left.volume) days.set(row.day, { day: row.day, candidate: row.total, rival: 0 });
  for (const row of right.volume) {
    const cur = days.get(row.day) ?? { day: row.day, candidate: 0, rival: 0 };
    cur.rival = row.total;
    days.set(row.day, cur);
  }
  // El ranking frente a frente solo tiene sentido si se mide la pauta de los dos.
  const adsRanking =
    opts.level === "radar" || !left.adsCollected || !right.adsCollected ? [] : rankAds(candidate.ads, rival.ads, opts.now);
  return {
    level: opts.level,
    window: opts.window ?? null,
    candidate: left,
    rival: right,
    volumeVs: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    adsRanking,
  };
}

function rankAds(a: MetaAd[], b: MetaAd[], now: Date): AdsPageRank[] {
  const count = (rows: MetaAd[]) => {
    const map = new Map<string, number>();
    for (const ad of rows) {
      const active = !ad.ad_delivery_stop_time || new Date(ad.ad_delivery_stop_time).getTime() > now.getTime();
      if (!active && ad.ad_delivery_stop_time) {
        // incluir también inactivos recientes en el ranking de presencia
      }
      const key = (ad.page_name || ad.page_id || ad.ad_id || "Sin página").trim();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  };
  const left = count(a);
  const right = count(b);
  const keys = new Set([...left.keys(), ...right.keys()]);
  return [...keys]
    .map((page) => ({ page, candidate: left.get(page) ?? 0, rival: right.get(page) ?? 0 }))
    .sort((x, y) => y.candidate + y.rival - (x.candidate + x.rival))
    .slice(0, 8);
}
