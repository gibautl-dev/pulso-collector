import { describe, expect, it } from "vitest";
import { advertiserMatchesName, shareOfVoice, rivalMetaStats, googleToCreativeCard } from "@/lib/rival-ads";
import type { Candidate, GoogleAd, MetaAd } from "@/lib/types";

const rival: Candidate = {
  id: "r1",
  slug: "milei",
  name: "Javier Milei",
};

describe("shareOfVoice y atribución", () => {
  it("reparte el porcentaje sobre la suma real de menciones", () => {
    const rows = shareOfVoice([
      { id: "c", name: "Axel", slug: "axel-kicillof", self: true, mentions: 60 },
      { id: "r", name: "Milei", slug: "milei", self: false, mentions: 40 },
    ]);
    expect(rows[0]?.share).toBe(0.6);
    expect(rows[1]?.share).toBe(0.4);
  });
  it("atribuye un anunciante si aparece un apellido del rival", () => {
    expect(advertiserMatchesName("Milei Presidente", "Javier Milei")).toBe(true);
    expect(advertiserMatchesName("Coalición vecinal", "Javier Milei")).toBe(false);
    expect(advertiserMatchesName("Pedro Pesatti", "Pedro Sánchez")).toBe(false);
    expect(advertiserMatchesName("Comité de Pedro Sánchez", "Pedro Sánchez")).toBe(true);
  });
  it("marca unmatched cuando ningún anuncio coincide", () => {
    const ad = {
      id: "1",
      candidate_id: "c1",
      ad_id: "ad",
      page_id: "p",
      page_name: "Otra Página",
      bylines: null,
      publisher_platforms: ["facebook"],
      currency: "ARS",
      spend_lower: null,
      spend_upper: null,
      impressions_lower: null,
      impressions_upper: null,
      ad_creative_bodies: ["Hola"],
      ad_creative_link_titles: [],
      ad_snapshot_url: null,
      ad_creation_time: null,
      ad_delivery_start_time: null,
      ad_delivery_stop_time: null,
      fetched_at: "2026-11-25T00:00:00Z",
      fetched_on: "2026-11-25",
      stance: "en_contra",
    } as MetaAd;
    const stats = rivalMetaStats([ad], [rival], new Date("2026-11-25T12:00:00Z"));
    expect(stats[0]?.unmatched).toBe(true);
    expect(stats[0]?.ads).toBe(0);
  });
  it("un anuncio de Google no inventa el texto del creativo", () => {
    const card = googleToCreativeCard({
      id: "g1",
      candidate_id: "c1",
      source: "political_report",
      ad_id: "99",
      ad_url: "https://adstransparency.google.com/x",
      ad_type: "TEXT",
      regions: ["AR"],
      advertiser_id: "a",
      advertiser_name: "Fuerza Patria PBA",
      advertiser_legal_name: null,
      date_range_start: "2026-11-01",
      date_range_end: "2026-11-20",
      first_served_at: null,
      last_served_at: null,
      num_of_days: null,
      impressions_lower: 1000,
      impressions_upper: 2000,
      impressions_raw: null,
      spend_currency: null,
      spend_lower: null,
      spend_upper: null,
      age_targeting: null,
      gender_targeting: null,
      geo_targeting_included: null,
      topic: null,
      ad_funded_by: null,
      fetched_at: "2026-11-24T00:00:00Z",
      fetched_on: "2026-11-24",
    } as GoogleAd);
    expect(card.body).toBeNull();
    expect(card.bodyMissingReason).toMatch(/no incluye el texto/i);
  });
});
