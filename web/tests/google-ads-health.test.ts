import { describe, expect, it } from "vitest";
import { computeGoogleAdsHealth } from "@/lib/google-ads-health";
import { GOOGLE_ADS_SPAIN_PENDING } from "@/lib/google-ads";

describe("computeGoogleAdsHealth", () => {
  it("usa fetched_on de la captura oficial y cuenta anunciantes", () => {
    const health = computeGoogleAdsHealth(
      [
        { fetched_at: "2026-11-25T00:04:21.000Z", fetched_on: "2026-11-24", advertiser_id: "AR03608428782462959617" },
        { fetched_at: "2026-11-25T00:04:21.000Z", fetched_on: "2026-11-24", advertiser_id: "AR09160339148358287361" },
      ],
      { candidate_id: "c1", enabled: true, source: "political_report", region: "AR", last_run_on: "2026-11-24", report_updated_at: "2026-11-24T16:04:21", updated_at: "2026-11-25T00:04:21.000Z" },
    );
    expect(health.totalAds).toBe(2);
    expect(health.advertiserCount).toBe(2);
    expect(health.adsLastRun).toBe(2);
    expect(health.pendingReason).toBeNull();
  });

  it("deja pendiente España si no hay anuncios, con el motivo oficial", () => {
    const health = computeGoogleAdsHealth([], null, { pendingReason: GOOGLE_ADS_SPAIN_PENDING });
    expect(health.totalAds).toBe(0);
    expect(health.lastSuccessAt).toBeNull();
    expect(health.pendingReason).toBe(GOOGLE_ADS_SPAIN_PENDING);
  });
});
