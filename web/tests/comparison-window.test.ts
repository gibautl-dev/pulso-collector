import { describe, expect, it } from "vitest";
import { mention } from "./helpers";
import {
  commonWindow,
  countThirdPartyInWindow,
  countThirdPartyPrevious,
  coverageStarts,
  formatWindowRange,
  mentionsInWindow,
  sourcesNeedingFirstCollected,
  windowCalendarDays,
  windowTooltip,
  MENTION_SOURCE_CATALOG,
} from "@/lib/comparison-window";
import { comparisonSpotlight } from "@/lib/home-spotlights";
import { buildRivalComparison, MEDIA_SOURCES, type SubjectPack } from "@/lib/rivals";
import { DEFAULT_CLOCK } from "@/lib/time";
import type { Candidate, CandidateSource } from "@/lib/types";

const now = new Date("2026-11-25T11:26:00-03:00");

function src(source: string, enabled: boolean, started: string | null): CandidateSource {
  return {
    candidate_id: "x",
    source,
    enabled,
    interval_seconds: 1200,
    last_attempt_at: null,
    last_success_at: null,
    collection_started_at: started,
    earliest_observed_at: null,
    latest_observed_at: null,
    coverage_status: "partial",
  };
}

// Fechas reales de pulso-demo (collection_started_at, UTC).
const kicillof = {
  id: "k",
  starts: coverageStarts([
    src("google_news", true, "2026-11-03T19:22:52Z"),
    src("rss_media", true, "2026-11-03T19:22:52Z"),
    src("x", true, "2026-11-18T14:39:01Z"),
    src("youtube", true, "2026-11-17T21:22:21Z"),
    src("gdelt", false, null),
  ]),
};
const milei = {
  id: "m",
  starts: coverageStarts([
    src("google_news", true, "2026-11-25T02:24:27Z"),
    src("rss_media", true, "2026-11-25T02:25:50Z"),
    src("x", false, null),
    src("youtube", false, null),
  ]),
};

describe("cobertura por fuente", () => {
  it("con filas legibles usa collection_started_at y descarta fuentes apagadas", () => {
    expect(Object.keys(kicillof.starts).sort()).toEqual(["google_news", "rss_media", "x", "youtube"]);
    expect(Object.keys(milei.starts).sort()).toEqual(["google_news", "rss_media"]);
  });

  it("sin filas (RLS del rival) usa el primer collected_at de las menciones", () => {
    expect(sourcesNeedingFirstCollected([], MENTION_SOURCE_CATALOG)).toEqual([...MENTION_SOURCE_CATALOG]);
    const starts = coverageStarts([], { google_news: "2026-11-25T02:24:30Z", rss_media: null, x: undefined });
    expect(starts).toEqual({ google_news: "2026-11-25T02:24:30Z" });
  });

  it("una fuente activa sin fecha cae al primer collected_at", () => {
    const rows = [src("google_news", true, null), src("x", true, "2026-11-10T00:00:00Z")];
    expect(sourcesNeedingFirstCollected(rows, MENTION_SOURCE_CATALOG)).toEqual(["google_news"]);
    expect(coverageStarts(rows, { google_news: "2026-11-09T00:00:00Z" })).toEqual({
      google_news: "2026-11-09T00:00:00Z",
      x: "2026-11-10T00:00:00Z",
    });
  });
});

describe("ventana común", () => {
  it("Kicillof vs Milei a 7 días: recorta al inicio de Milei, solo fuentes de ambos, sin semana anterior", () => {
    const w = commonWindow([kicillof, milei], { now, days: 7 })!;
    expect(w.sources).toEqual(["google_news", "rss_media"]);
    expect(w.start).toBe("2026-11-25T02:25:50.000Z");
    expect(w.coveredSince).toBe("2026-11-25T02:25:50.000Z");
    expect(w.clipped).toBe(true);
    expect(w.previousComparable).toBe(false);
    expect(w.previousStart).toBeNull();
    expect(formatWindowRange(w, DEFAULT_CLOCK)).toBe("24–25 nov");
    const tip = windowTooltip(w, DEFAULT_CLOCK);
    expect(tip).toContain("Comparado del 24 al 25 nov (desde las 23:25, hora de Argentina), período con datos de ambos.");
    expect(tip).toContain("Google News y Medios (RSS)");
    expect(tip).toContain("Todavía no hay un período anterior completo");
  });

  it("si los dos cubren dos ventanas completas, no recorta y habilita la variación", () => {
    const old = { id: "r", starts: { google_news: "2026-11-01T00:00:00Z", rss_media: "2026-11-01T00:00:00Z" } };
    const w = commonWindow([kicillof, old], { now, days: 7 })!;
    expect(w.clipped).toBe(false);
    expect(w.start).toBe(w.requestedStart);
    expect(w.previousComparable).toBe(true);
    expect(w.previousEnd).toBe(w.requestedStart);
    // A 30 días ya no alcanza: Kicillof empezó el 3/11.
    const w30 = commonWindow([kicillof, old], { now, days: 30 })!;
    expect(w30.clipped).toBe(true);
    expect(w30.previousComparable).toBe(false);
  });

  it("cubre la semana actual pero no la anterior: compara la semana, oculta la variación", () => {
    const r = { id: "r", starts: { google_news: "2026-11-15T00:00:00Z" } };
    const w = commonWindow([kicillof, r], { now, days: 7 })!;
    expect(w.clipped).toBe(false);
    expect(w.previousComparable).toBe(false);
  });

  it("sin fuentes compartidas o sin cobertura todavía, no hay ventana", () => {
    expect(commonWindow([kicillof, { id: "r", starts: { facebook: "2026-11-01T00:00:00Z" } }], { now, days: 7 })).toBeNull();
    expect(commonWindow([kicillof, { id: "r", starts: { google_news: "2026-11-26T00:00:00Z" } }], { now, days: 7 })).toBeNull();
    expect(commonWindow([], { now, days: 7 })).toBeNull();
  });

  it("radar limita a fuentes de medios", () => {
    const r = { id: "r", starts: { google_news: "2026-11-01T00:00:00Z", x: "2026-11-01T00:00:00Z" } };
    const w = commonWindow([kicillof, r], { now, days: 7, allowedSources: MEDIA_SOURCES })!;
    expect(w.sources).toEqual(["google_news"]);
  });

  it("con varios rivales usa el inicio más tardío y lo dice", () => {
    const r2 = { id: "r2", starts: { google_news: "2026-11-20T00:00:00Z", rss_media: "2026-11-20T00:00:00Z" } };
    const w = commonWindow([kicillof, r2, milei], { now, days: 7 })!;
    expect(w.start).toBe("2026-11-25T02:25:50.000Z");
    expect(windowTooltip(w)).toContain("período con datos de todos");
  });

  it("cuenta solo terceros, fuentes compartidas y desde el inicio; la anterior solo si es comparable", () => {
    const w = commonWindow([kicillof, milei], { now, days: 7 })!;
    const rows = [
      mention({ source: "google_news", published_at: "2026-11-25T10:00:00Z" }),
      mention({ source: "rss_media", published_at: "2026-11-25T03:00:00Z" }),
      mention({ source: "x", published_at: "2026-11-25T10:00:00Z" }), // fuente que Milei no tiene
      mention({ source: "google_news", published_at: "2026-11-24T12:00:00Z" }), // antes del inicio común
      mention({ source: "google_news", published_at: "2026-11-25T10:00:00Z", account_relation: "own" }),
    ];
    expect(mentionsInWindow(rows, w)).toHaveLength(3);
    expect(countThirdPartyInWindow(rows, w)).toBe(2);
    expect(countThirdPartyPrevious(rows, w)).toBeNull();

    const full = commonWindow([kicillof, { id: "r", starts: { google_news: "2026-11-01T00:00:00Z" } }], { now, days: 7 })!;
    const prev = [
      mention({ source: "google_news", published_at: "2026-11-15T12:00:00Z" }),
      mention({ source: "google_news", published_at: "2026-11-20T12:00:00Z" }),
    ];
    expect(countThirdPartyPrevious(prev, full)).toBe(1);
    expect(countThirdPartyInWindow(prev, full)).toBe(1);
  });

  it("días calendario de la ventana en la zona del candidato", () => {
    const w = commonWindow([kicillof, milei], { now, days: 7 })!;
    expect(windowCalendarDays(w, "America/Argentina/Buenos_Aires")).toBe(2);
    expect(formatWindowRange({ ...w, start: "2026-10-28T12:00:00Z", end: "2026-11-03T12:00:00Z" })).toBe("28 oct – 3 nov");
    expect(formatWindowRange({ ...w, start: "2026-11-25T12:00:00Z", end: "2026-11-25T14:00:00Z" })).toBe("25 nov");
  });
});

describe("tarjeta Comparación con rivales con ventana", () => {
  const candidate = { id: "k", name: "Axel Kicillof", slug: "axel-kicillof" };
  it("oculta la variación si el período anterior no está cubierto y muestra el período", () => {
    const w = commonWindow([kicillof, milei], { now, days: 7 })!;
    const spot = comparisonSpotlight({
      candidate,
      rivals: [{ id: "m", name: "Javier Milei", slug: "milei", mentions: 150, previousMentions: null }],
      candidateMentions: 50,
      candidatePreviousMentions: null,
      days: 7,
      window: w,
    });
    expect(spot.kind).toBe("ready");
    expect(spot.headline).toBe("25% vs 75%");
    expect(spot.deltaLabel).toBeNull();
    expect(spot.deltaPp).toBeNull();
    expect(spot.periodLabel).toBe("24–25 nov");
    expect(spot.periodTooltip).toContain("período con datos de ambos");
  });

  it("con las dos semanas cubiertas muestra la variación", () => {
    const old = { id: "r", starts: { google_news: "2026-11-01T00:00:00Z", rss_media: "2026-11-01T00:00:00Z" } };
    const w = commonWindow([kicillof, old], { now, days: 7 })!;
    const spot = comparisonSpotlight({
      candidate,
      rivals: [{ id: "r", name: "Rival", slug: "rival", mentions: 40, previousMentions: 50 }],
      candidateMentions: 60,
      candidatePreviousMentions: 50,
      days: 7,
      window: w,
    });
    expect(spot.deltaLabel).toBe("+10 pp vs semana anterior");
  });

  it("sin período común no compara", () => {
    const spot = comparisonSpotlight({
      candidate,
      rivals: [{ id: "m", name: "Javier Milei", slug: "milei", mentions: 0, previousMentions: null }],
      candidateMentions: 0,
      candidatePreviousMentions: null,
      days: 7,
      window: null,
    });
    expect(spot.kind).toBe("no_window");
    expect(spot.headline).toBe("—");
  });
});

describe("Rivales y anuncios con ventana", () => {
  const a: Candidate = { id: "k", slug: "axel-kicillof", name: "Axel Kicillof" };
  const b: Candidate = { id: "m", slug: "milei", name: "Javier Milei" };
  const pack = (c: Candidate, mentions: ReturnType<typeof mention>[]): SubjectPack => ({
    candidate: c,
    mentions,
    topics: [],
    ads: [],
    answers: [],
    suspicious: [],
  });
  it("compara las mismas fuentes y el mismo período y oculta X si no se mide para los dos", () => {
    const w = commonWindow([kicillof, milei], { now, days: 7 })!;
    const left = pack(a, [
      mention({ candidate_id: "k", source: "google_news", published_at: "2026-11-25T10:00:00Z" }),
      mention({ candidate_id: "k", source: "google_news", published_at: "2026-11-20T10:00:00Z" }),
      mention({ candidate_id: "k", source: "x", published_at: "2026-11-25T10:00:00Z" }),
    ]);
    const right = pack(b, [
      mention({ candidate_id: "m", source: "rss_media", published_at: "2026-11-25T12:00:00Z" }),
      mention({ candidate_id: "m", source: "rss_media", published_at: "2026-11-25T13:00:00Z" }),
    ]);
    const cmp = buildRivalComparison(left, right, {
      days: 7,
      now,
      level: "comparativo",
      timeZone: "America/Argentina/Buenos_Aires",
      window: w,
    });
    expect(cmp.window).toBe(w);
    expect(cmp.candidate.dashboard.total).toBe(1);
    expect(cmp.rival.dashboard.total).toBe(2);
    expect(cmp.candidate.showX).toBe(false);
    expect(cmp.candidate.xTotal).toBeNull();
    expect(cmp.volumeVs.map((d) => d.day)).toEqual(["2026-11-24", "2026-11-25"]);
  });
});
