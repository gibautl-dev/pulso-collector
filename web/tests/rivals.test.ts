import { describe, expect, it } from "vitest";
import { mention } from "./helpers";
import { buildRivalComparison, mentionsForLevel, type SubjectPack } from "@/lib/rivals";
import type { Candidate } from "@/lib/types";

const a: Candidate = { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" };
const b: Candidate = { id: "c2", slug: "pedro-sanchez", name: "Pedro Sánchez" };
const now = new Date("2026-11-24T20:00:00-03:00");

function pack(candidate: Candidate, mentions: ReturnType<typeof mention>[]): SubjectPack {
  return { candidate, mentions, topics: [], ads: [], answers: [], suspicious: [] };
}

describe("mentionsForLevel", () => {
  const rows = [
    mention({ source: "google_news", title: "medio" }),
    mention({ source: "x", title: "post" }),
  ];
  it("en radar deja solo medios", () => {
    expect(mentionsForLevel(rows, "radar").map((m) => m.source)).toEqual(["google_news"]);
  });
  it("en comparativo y completo deja todas", () => {
    expect(mentionsForLevel(rows, "comparativo")).toHaveLength(2);
    expect(mentionsForLevel(rows, "completo")).toHaveLength(2);
  });
});

describe("buildRivalComparison", () => {
  it("arma curvas frente a frente, genérico para cualquier par", () => {
    const left = pack(a, [
      mention({
        candidate_id: "c1",
        source: "google_news",
        published_at: "2026-11-23T12:00:00-03:00",
        tone: "critica",
        target: "candidate",
      }),
      mention({
        candidate_id: "c1",
        source: "x",
        published_at: "2026-11-23T13:00:00-03:00",
        tone: "a_favor",
        target: "candidate",
      }),
    ]);
    const right = pack(b, [
      mention({
        candidate_id: "c2",
        source: "google_news",
        published_at: "2026-11-23T12:00:00-03:00",
        tone: "informativo",
        target: "candidate",
      }),
    ]);
    const radar = buildRivalComparison(left, right, { days: 7, now, level: "radar" });
    expect(radar.candidate.candidate.slug).toBe("axel-kicillof");
    expect(radar.rival.candidate.slug).toBe("pedro-sanchez");
    expect(radar.candidate.showX).toBe(false);
    expect(radar.candidate.showAi).toBe(false);
    expect(radar.candidate.dashboard.total).toBe(1);
    expect(radar.rival.dashboard.total).toBe(1);
    const day = radar.volumeVs.find((d) => d.day.endsWith("23") || d.candidate || d.rival);
    expect(day).toBeTruthy();
    expect(radar.volumeVs.some((d) => d.candidate === 1 && d.rival === 1)).toBe(true);

    const full = buildRivalComparison(left, right, { days: 7, now, level: "completo" });
    expect(full.candidate.showX).toBe(true);
    expect(full.candidate.dashboard.total).toBe(2);
    expect(full.candidate.showMetaAds).toBe(true);
    expect(full.rival.showMetaAds).toBe(false);
  });
});
