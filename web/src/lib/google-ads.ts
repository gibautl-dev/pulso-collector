/** Vista de anuncios de Google a partir de rutas oficiales. Sin inventar montos. */
import { formatAmount, formatSpendRange } from "@/lib/meta-ads";
import type { GoogleAd, GoogleAdSource } from "@/lib/types";

export const GOOGLE_ADS_EXAMPLE_BANNER =
  "Ejemplo: captura del reporte oficial de anuncios políticos de Google del 24 de noviembre de 2026 (16:04 PT). No es una corrida en vivo de Pulso.";

export const GOOGLE_ADS_KICILLOF_SCOPE =
  "En el reporte oficial no aparece un anunciante con el nombre Kicillof. Se muestran anuncios electorales verificados de coaliciones de la provincia de Buenos Aires (Fuerza Patria PBA y Unión por la Patria de la provincia). El dataset no incluye el texto del creativo: el vínculo abre la ficha oficial.";

export const GOOGLE_ADS_SPAIN_PENDING =
  "Para anuncios de Google en España hay que consultar el dataset oficial del Ads Transparency Center con un proyecto de Google Cloud (capa gratuita de 1 TB al mes). Todavía no está configurado. El informe de anuncios políticos de la UE dejó de publicarse en septiembre de 2025.";

export const SOURCE_LABEL: Record<GoogleAdSource, string> = {
  political_report: "Reporte de anuncios políticos de Google",
  ads_transparency_center: "Ads Transparency Center",
};

const TYPE_LABEL: Record<string, string> = {
  TEXT: "Texto",
  IMAGE: "Imagen",
  VIDEO: "Video",
};

export function googleAdTypeLabel(value: string | null | undefined): string {
  if (!value) return "Formato no informado";
  return TYPE_LABEL[value.toUpperCase()] ?? value;
}

export function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatImpressionRange(ad: Pick<GoogleAd, "impressions_lower" | "impressions_upper" | "impressions_raw">): string {
  if (ad.impressions_raw && ad.impressions_raw.trim()) return `${ad.impressions_raw} impresiones`;
  const lower = toNumber(ad.impressions_lower);
  const upper = toNumber(ad.impressions_upper);
  if (lower == null && upper == null) return "Sin dato de impresiones";
  if (upper == null && lower != null) return `${formatAmount(lower)} impresiones o más`;
  if (lower == null && upper != null) return `hasta ${formatAmount(upper)} impresiones`;
  if (lower === upper) return `${formatAmount(lower!)} impresiones`;
  return `${formatAmount(lower!)} – ${formatAmount(upper!)} impresiones`;
}

export function formatGoogleSpend(ad: Pick<GoogleAd, "spend_currency" | "spend_lower" | "spend_upper">): string {
  return formatSpendRange(ad.spend_currency, toNumber(ad.spend_lower), toNumber(ad.spend_upper));
}

export function formatGoogleAdDate(value: string | null | undefined): string {
  if (!value) return "—";
  const day = value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [y, m, d] = day.split("-");
    return `${d}/${m}/${y}`;
  }
  return value;
}

export interface GoogleAdvertiserBucket {
  advertiserId: string;
  advertiserName: string;
  ads: number;
}

export interface GoogleAdsView {
  total: number;
  advertisers: GoogleAdvertiserBucket[];
  firstStart: string | null;
  lastDelivery: string | null;
  fetchedAt: string | null;
  fetchedOn: string | null;
  source: GoogleAdSource | null;
  spendCurrency: string | null;
  spendLowerSum: number;
  spendUpperSum: number;
  openSpend: boolean;
}

export function computeGoogleAdsView(ads: GoogleAd[]): GoogleAdsView {
  const advertisers = new Map<string, GoogleAdvertiserBucket>();
  let firstStart: string | null = null;
  let lastDelivery: string | null = null;
  let fetchedAt: string | null = null;
  let fetchedOn: string | null = null;
  const source: GoogleAdSource | null = ads[0]?.source ?? null;
  let spendCurrency: string | null = null;
  let spendLowerSum = 0;
  let spendUpperSum = 0;
  let openSpend = false;
  for (const ad of ads) {
    const key = ad.advertiser_id || ad.advertiser_name || "sin anunciante";
    const current = advertisers.get(key) ?? {
      advertiserId: ad.advertiser_id ?? key,
      advertiserName: ad.advertiser_name ?? "Anunciante sin nombre",
      ads: 0,
    };
    current.ads += 1;
    advertisers.set(key, current);
    const start = ad.date_range_start ?? ad.first_served_at;
    const end = ad.date_range_end ?? ad.last_served_at;
    if (start && (!firstStart || start < firstStart)) firstStart = start;
    if (end && (!lastDelivery || end > lastDelivery)) lastDelivery = end;
    if (ad.fetched_at && (!fetchedAt || ad.fetched_at > fetchedAt)) fetchedAt = ad.fetched_at;
    if (ad.fetched_on && (!fetchedOn || ad.fetched_on > fetchedOn)) fetchedOn = ad.fetched_on;
    const lower = toNumber(ad.spend_lower);
    const upper = toNumber(ad.spend_upper);
    if (ad.spend_currency) spendCurrency = ad.spend_currency;
    if (lower != null) spendLowerSum += lower;
    if (upper != null) spendUpperSum += upper;
    else if (lower != null) openSpend = true;
  }
  return {
    total: ads.length,
    advertisers: [...advertisers.values()].sort((a, b) => b.ads - a.ads || a.advertiserName.localeCompare(b.advertiserName, "es")),
    firstStart,
    lastDelivery,
    fetchedAt,
    fetchedOn,
    source,
    spendCurrency,
    spendLowerSum,
    spendUpperSum,
    openSpend,
  };
}

export function formatSpendAggregate(view: GoogleAdsView): string | null {
  if (!view.spendCurrency && view.spendLowerSum === 0 && view.spendUpperSum === 0) return null;
  const range = formatSpendRange(
    view.spendCurrency,
    view.spendLowerSum || null,
    view.openSpend ? null : view.spendUpperSum || null,
  );
  return view.openSpend ? `${range} (suma de rangos; algunos sin techo)` : `Suma de rangos: ${range}`;
}
