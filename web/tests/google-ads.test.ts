import { describe, expect, it } from "vitest";
import { computeGoogleAdsView, formatGoogleAdDate, formatImpressionRange, formatSpendAggregate } from "@/lib/google-ads";
import type { GoogleAd } from "@/lib/types";

const base: GoogleAd = {
  id: "1",
  candidate_id: "2c4f83ed-f2bd-4afe-89a3-fa6263cc5b7e",
  source: "political_report",
  ad_id: "CR04352157551505178625",
  ad_url: "https://adstransparency.google.com/advertiser/AR03608428782462959617/creative/CR04352157551505178625?political=&region=AR",
  ad_type: "VIDEO",
  regions: ["AR"],
  advertiser_id: "AR03608428782462959617",
  advertiser_name: "FUERZA PATRIA PBA A. P. - ALIANZA",
  advertiser_legal_name: null,
  date_range_start: "2025-10-20",
  date_range_end: "2025-10-31",
  first_served_at: "2025-10-20T20:54",
  last_served_at: "2025-10-31T10:57",
  num_of_days: 12,
  impressions_lower: 1_000_000,
  impressions_upper: 1_250_000,
  impressions_raw: "1000000-1250000",
  spend_currency: "ARS",
  spend_lower: 2_000_000,
  spend_upper: 2_500_000,
  age_targeting: null,
  gender_targeting: null,
  geo_targeting_included: "Buenos Aires Province,Argentina",
  topic: null,
  ad_funded_by: null,
  fetched_at: "2026-11-25T00:04:21.000Z",
  fetched_on: "2026-11-24",
};

describe("google ads view", () => {
  it("usa los rangos oficiales de la captura y no inventa un total exacto", () => {
    const second: GoogleAd = {
      ...base,
      id: "2",
      ad_id: "CR16036038699229642753",
      ad_type: "IMAGE",
      date_range_start: "2025-10-21",
      date_range_end: "2025-10-25",
      last_served_at: "2025-10-25T01:20",
      impressions_lower: 80_000,
      impressions_upper: 90_000,
      impressions_raw: "80000-90000",
      spend_lower: 15_000,
      spend_upper: 30_000,
    };
    const view = computeGoogleAdsView([base, second]);
    expect(view.total).toBe(2);
    expect(view.advertisers).toHaveLength(1);
    expect(view.advertisers[0].advertiserName).toBe("FUERZA PATRIA PBA A. P. - ALIANZA");
    expect(view.spendCurrency).toBe("ARS");
    expect(view.spendLowerSum).toBe(2_015_000);
    expect(view.spendUpperSum).toBe(2_530_000);
    expect(formatSpendAggregate(view)).toContain("ARS");
    expect(formatImpressionRange(base)).toBe("1000000-1250000 impresiones");
    expect(formatGoogleAdDate("2025-10-31")).toBe("31/10/2025");
  });
});
