import { describe, expect, it } from "vitest";
import { mention } from "./helpers";
import { coveredPeriodChange, periodChangeTooltip, sourcesCoveredSince } from "@/lib/comparison-window";
import { computeTopicStats } from "@/lib/custom-topics";
import { buildRivalComparison, type SubjectPack } from "@/lib/rivals";
import type { Candidate, CustomTopic, MetaAd } from "@/lib/types";

const now = new Date("2026-11-25T16:00:00-03:00");
// Fechas reales de Kicillof (UTC).
const kStarts = {
  google_news: "2026-11-03T19:22:52Z",
  rss_media: "2026-11-03T19:22:52Z",
  x: "2026-11-18T14:39:01Z",
  youtube: "2026-11-17T21:22:21Z",
};
const mileiStarts = { google_news: "2026-11-25T02:24:27Z", rss_media: "2026-11-25T02:25:50Z" };

describe("variación vs semana anterior con cobertura", () => {
  it("tope superior: lo de esta semana no entra en la anterior (bug de 2N días)", () => {
    const rows = [
      mention({ source: "google_news", published_at: "2026-11-24T12:00:00Z" }),
      mention({ source: "google_news", published_at: "2026-11-24T13:00:00Z" }),
      mention({ source: "google_news", published_at: "2026-11-15T12:00:00Z" }),
    ];
    const c = coveredPeriodChange(rows, kStarts, { now, days: 7 });
    expect(c).toMatchObject({ comparable: true, current: 2, previous: 1, percent: 100 });
  });

  it("solo cuenta fuentes activas en los dos períodos (X y YouTube de Kicillof quedan afuera)", () => {
    const rows = [
      mention({ source: "google_news", published_at: "2026-11-24T12:00:00Z" }),
      mention({ source: "x", published_at: "2026-11-24T12:00:00Z" }),
      mention({ source: "youtube", published_at: "2026-11-24T12:00:00Z" }),
      mention({ source: "google_news", published_at: "2026-11-15T12:00:00Z" }),
      mention({ source: "google_news", published_at: "2026-11-15T12:00:00Z", account_relation: "own" }),
    ];
    const c = coveredPeriodChange(rows, kStarts, { now, days: 7 });
    expect(c.sources).toEqual(["google_news", "rss_media"]);
    expect(c.current).toBe(1);
    expect(c.previous).toBe(1);
    expect(c.percent).toBe(0);
    expect(periodChangeTooltip(c, kStarts, 7)).toBe(
      "La variación compara con la semana anterior usando solo las fuentes con datos en los dos períodos: Google News y Medios (RSS).",
    );
  });

  it("sin cobertura del período anterior (Milei, alta el 24/11) no hay variación", () => {
    const c = coveredPeriodChange([mention({ published_at: "2026-11-25T12:00:00Z" })], mileiStarts, { now, days: 7 });
    expect(c.comparable).toBe(false);
    expect(c.percent).toBeNull();
    expect(periodChangeTooltip(c, mileiStarts, 7)).toBeNull();
  });

  it("a 30 días Kicillof tampoco tiene período anterior cubierto", () => {
    expect(coveredPeriodChange([], kStarts, { now, days: 30 }).comparable).toBe(false);
    expect(sourcesCoveredSince(kStarts, now.getTime() - 14 * 86400000)).toEqual(["google_news", "rss_media"]);
  });

  it("si todas las fuentes cubren los dos períodos, no hace falta ⓘ", () => {
    const starts = { google_news: "2026-10-01T00:00:00Z" };
    const c = coveredPeriodChange([], starts, { now, days: 7 });
    expect(c.comparable).toBe(true);
    expect(c.percent).toBe(0);
    expect(periodChangeTooltip(c, starts, 7)).toBeNull();
  });
});

describe("temas a medida con cobertura", () => {
  const topic: CustomTopic = {
    id: "t1",
    candidate_id: "c1",
    name: "Salud",
    description: null,
    keywords: ["salud"],
    include_terms: [],
    exclude_terms: [],
    sources: null,
    enabled: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  } as unknown as CustomTopic;
  const rows = [
    mention({ source: "x", title: "salud x", published_at: "2026-11-24T12:00:00Z" }),
    mention({ source: "x", title: "salud x2", published_at: "2026-11-24T13:00:00Z" }),
    mention({ source: "google_news", title: "salud gn", published_at: "2026-11-24T12:00:00Z" }),
    mention({ source: "google_news", title: "salud gn prev", published_at: "2026-11-15T12:00:00Z" }),
  ];
  it("la tendencia ignora fuentes que no existían en el tramo anterior; el volumen sigue completo", () => {
    const base = computeTopicStats(topic, rows, { now, days: 7 });
    expect(base.trendPct).toBe(200);
    const s = computeTopicStats(topic, rows, { now, days: 7, coverage: kStarts });
    expect(s.volume).toBe(3);
    expect(s.previousVolume).toBe(1);
    expect(s.trendPct).toBe(0);
    expect(s.trendLabel).toBe("Sin cambio frente al tramo anterior");
  });
  it("sin cobertura del tramo anterior no hay tendencia ni pico", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      mention({ source: "google_news", title: `salud ${i}`, published_at: "2026-11-25T12:00:00Z" }),
    );
    expect(computeTopicStats(topic, many, { now, days: 7 }).spike).toBe(true);
    const s = computeTopicStats(topic, many, { now, days: 7, coverage: mileiStarts });
    expect(s.trendPct).toBeNull();
    expect(s.trendLabel).toBe("Sin tramo anterior para comparar");
    expect(s.spike).toBe(false);
  });
});

describe("anuncios de rivales sin pauta medida", () => {
  const a: Candidate = { id: "k", slug: "axel-kicillof", name: "Axel Kicillof" };
  const b: Candidate = { id: "m", slug: "milei", name: "Javier Milei" };
  const ad = { id: "a1", ad_id: "1", candidate_id: "k", page_name: "Ratio oficial", page_id: "p", ad_delivery_stop_time: null } as unknown as MetaAd;
  const pack = (c: Candidate, ads: MetaAd[], adsCollected?: boolean): SubjectPack => ({
    candidate: c,
    mentions: [],
    topics: [],
    ads,
    answers: [],
    suspicious: [],
    adsCollected,
  });
  it("no arma ranking frente a frente si el rival no tiene pauta medida", () => {
    const cmp = buildRivalComparison(pack(a, [ad]), pack(b, []), { days: 7, now, level: "comparativo" });
    expect(cmp.rival.adsCollected).toBe(false);
    expect(cmp.candidate.adsCollected).toBe(true);
    expect(cmp.adsRanking).toEqual([]);
  });
  it("si la pauta del rival se mide (aunque hoy tenga 0), sí compara", () => {
    const cmp = buildRivalComparison(pack(a, [ad]), pack(b, [], true), { days: 7, now, level: "comparativo" });
    expect(cmp.rival.adsCollected).toBe(true);
    expect(cmp.adsRanking.map((r) => r.page)).toEqual(["Ratio oficial"]);
  });
});
