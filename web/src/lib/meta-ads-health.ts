/** Salud de la Biblioteca de anuncios de Meta, a partir de tablas ya existentes. */
import { META_ADS_EU_UNAVAILABLE } from "./labels";
import type { MetaAd } from "./types";

export interface MetaAdsSettingsRow {
  candidate_id: string;
  enabled: boolean;
  last_run_on: string | null;
  updated_at: string | null;
}

export interface MetaAdsHealth {
  source: "meta_ads";
  /** false en la UE: no se consulta la API de anuncios políticos. */
  applicable: boolean;
  unavailableReason: string | null;
  lastSuccessAt: string | null;
  lastRunOn: string | null;
  adsLastRun: number | null;
  adsLast7d: number | null;
  totalAds: number;
  /** Los fallos del job no se guardan en la base; solo se informan si hubiera un registro. */
  lastError: string | null;
}

export function computeMetaAdsHealth(
  ads: Pick<MetaAd, "fetched_at" | "fetched_on">[],
  settings: MetaAdsSettingsRow | null,
  opts: { now?: Date; showMetaAds: boolean },
): MetaAdsHealth {
  if (!opts.showMetaAds) {
    return {
      source: "meta_ads",
      applicable: false,
      unavailableReason: META_ADS_EU_UNAVAILABLE,
      lastSuccessAt: null,
      lastRunOn: null,
      adsLastRun: null,
      adsLast7d: null,
      totalAds: 0,
      lastError: null,
    };
  }
  const now = opts.now ?? new Date();
  const cutoff = now.getTime() - 7 * 86400000;
  let lastSuccessAt: string | null = null;
  let lastRunOn: string | null = settings?.last_run_on ?? null;
  for (const ad of ads) {
    if (!lastSuccessAt || ad.fetched_at > lastSuccessAt) lastSuccessAt = ad.fetched_at;
    if (!lastRunOn || (ad.fetched_on && ad.fetched_on > lastRunOn)) lastRunOn = ad.fetched_on;
  }
  if (settings?.updated_at && (!lastSuccessAt || settings.updated_at > lastSuccessAt)) {
    lastSuccessAt = settings.updated_at;
  }
  const adsLastRun = lastRunOn ? ads.filter((a) => a.fetched_on === lastRunOn).length : 0;
  const adsLast7d = ads.filter((a) => new Date(a.fetched_at).getTime() >= cutoff).length;
  return {
    source: "meta_ads",
    applicable: true,
    unavailableReason: null,
    lastSuccessAt,
    lastRunOn,
    adsLastRun: lastSuccessAt ? adsLastRun : 0,
    adsLast7d,
    totalAds: ads.length,
    lastError: null,
  };
}
