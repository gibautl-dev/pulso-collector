import { describe, expect, it } from "vitest";
import { computeHomeCards } from "@/lib/home-summaries";
import { META_ADS_EU_UNAVAILABLE, regionFor } from "@/lib/region";
import { clockFor, dayKey, formatDateTime } from "@/lib/time";

describe("regionFor", () => {
  it("deja Argentina como default y España para pedro-sanchez", () => {
    expect(regionFor("axel-kicillof").electionLabel).toBe("Elecciones 2027 · Argentina");
    expect(regionFor("axel-kicillof").showMetaAds).toBe(true);
    const es = regionFor("pedro-sanchez");
    expect(es.electionLabel).toBe("Elecciones generales 29N · España");
    expect(es.timezone).toBe("Europe/Madrid");
    expect(es.showMetaAds).toBe(false);
    expect(es.showGoogleAds).toBe(true);
    expect(regionFor("axel-kicillof").showGoogleAds).toBe(true);
    expect(clockFor("pedro-sanchez").tzLabel).toBe("hora de España");
    expect(regionFor("diego-santilli", "AR").country).toBe("AR");
    expect(regionFor("nuevo-es", "ES").countryName).toBe("España");
    expect(regionFor("nuevo-es", "ES").showMetaAds).toBe(false);
    expect(regionFor("pedro-sanchez", "ES").timezone).toBe("Europe/Madrid");
  });

  it("formatea un instante en hora de Madrid", () => {
    const clock = clockFor("pedro-sanchez");
    // 15:00 UTC del 24/11/2026 es 16:00 en Madrid (CET).
    expect(formatDateTime("2026-11-24T15:00:00Z", clock)).toMatch(/24\/11\/2026/);
    expect(formatDateTime("2026-11-24T15:00:00Z", clock)).toMatch(/16:00/);
    expect(dayKey("2026-11-24T23:30:00Z", clock.timeZone)).toBe("2026-11-25");
  });
});

describe("computeHomeCards sin Meta", () => {
  it("explica que los anuncios no están disponibles en la UE", () => {
    const cards = computeHomeCards({
      slug: "pedro-sanchez",
      days: 7,
      now: new Date("2026-11-24T16:00:00+01:00"),
      mentions: [],
      topics: [],
      ads: [],
      answers: [],
      suspicious: [],
      showMetaAds: false,
    });
    const ads = cards.find((c) => c.title === "Anuncios");
    expect(ads?.insufficient).toBe(true);
    expect(ads?.emptyLabel).toBe(META_ADS_EU_UNAVAILABLE);
    expect(ads?.stats).toEqual([]);
  });
});
