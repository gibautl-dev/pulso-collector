/** Salud de anuncios de Google a partir de tablas propuestas (o del fixture). */
import type { GoogleAd, GoogleAdsSettings } from "@/lib/types";

export interface GoogleAdsHealth {
  source: "google_ads";
  lastSuccessAt: string | null;
  lastRunOn: string | null;
  adsLastRun: number | null;
  totalAds: number;
  advertiserCount: number;
  reportUpdatedAt: string | null;
  pendingReason: string | null;
}

export function computeGoogleAdsHealth(
  ads: Pick<GoogleAd, "fetched_at" | "fetched_on" | "advertiser_id">[],
  settings: GoogleAdsSettings | null,
  opts?: { pendingReason?: string | null },
): GoogleAdsHealth {
  let lastSuccessAt: string | null = null;
  let lastRunOn: string | null = settings?.last_run_on ?? null;
  const advertisers = new Set<string>();
  for (const ad of ads) {
    if (!lastSuccessAt || ad.fetched_at > lastSuccessAt) lastSuccessAt = ad.fetched_at;
    if (!lastRunOn || (ad.fetched_on && ad.fetched_on > lastRunOn)) lastRunOn = ad.fetched_on;
    if (ad.advertiser_id) advertisers.add(ad.advertiser_id);
  }
  if (settings?.updated_at && (!lastSuccessAt || settings.updated_at > lastSuccessAt)) {
    lastSuccessAt = settings.updated_at;
  }
  const adsLastRun = lastRunOn ? ads.filter((a) => a.fetched_on === lastRunOn).length : 0;
  const pending = ads.length === 0 ? (opts?.pendingReason ?? null) : null;
  return {
    source: "google_ads",
    lastSuccessAt,
    lastRunOn,
    adsLastRun: lastSuccessAt ? adsLastRun : 0,
    totalAds: ads.length,
    advertiserCount: advertisers.size,
    reportUpdatedAt: settings?.report_updated_at ?? null,
    pendingReason: pending,
  };
}
