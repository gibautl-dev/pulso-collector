import { describe, expect, it } from "vitest";
import { META_ADS_EU_UNAVAILABLE } from "@/lib/labels";
import { computeMetaAdsHealth } from "@/lib/meta-ads-health";

describe("computeMetaAdsHealth", () => {
  it("en Argentina usa fetched_at y cuenta la última corrida y los 7 días", () => {
    const health = computeMetaAdsHealth(
      [
        { fetched_at: "2026-11-24T12:04:24.194772+00:00", fetched_on: "2026-11-24" },
        { fetched_at: "2026-11-24T12:04:24.194772+00:00", fetched_on: "2026-11-24" },
        { fetched_at: "2026-11-18T15:00:00.000Z", fetched_on: "2026-11-18" },
      ],
      { candidate_id: "c1", enabled: true, last_run_on: "2026-11-24", updated_at: "2026-11-24T12:04:24.194772+00:00" },
      { now: new Date("2026-11-24T18:00:00-03:00"), showMetaAds: true },
    );
    expect(health.applicable).toBe(true);
    expect(health.unavailableReason).toBeNull();
    expect(health.lastSuccessAt).toBe("2026-11-24T12:04:24.194772+00:00");
    expect(health.adsLastRun).toBe(2);
    expect(health.adsLast7d).toBe(3);
    expect(health.lastError).toBeNull();
  });

  it("en la UE no lo muestra como error", () => {
    const health = computeMetaAdsHealth([], null, { showMetaAds: false });
    expect(health.applicable).toBe(false);
    expect(health.unavailableReason).toBe(META_ADS_EU_UNAVAILABLE);
    expect(health.lastError).toBeNull();
    expect(health.adsLastRun).toBeNull();
  });
});
