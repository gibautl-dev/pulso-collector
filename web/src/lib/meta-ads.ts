import { dayKey, formatMonth, parseDate } from "./time";
import type { MetaAd, MetaAdFilters } from "./types";

const LIBRARY_URL = "https://www.facebook.com/ads/library/?id=";

const moneyFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

/** Entero seguro: PostgREST a veces manda bigint como string. */
export function asInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((s) => s.trim()).filter(Boolean);
}

/**
 * Día civil que informa Meta (YYYY-MM-DD). Las fechas de pautado suelen llegar
 * a las 00:00 UTC; si se convierten a hora de Argentina quedan en el día anterior.
 */
export function metaAdDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const match = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : dayKey(iso);
}

/** Fecha de pautado (dd/mm/aaaa) usando el día civil de Meta, no el huso argentino. */
export function formatMetaAdDate(iso: string | null | undefined): string {
  const key = metaAdDateKey(iso);
  if (!key) return "—";
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

/** URL pública de la Biblioteca. Nunca devolvemos el snapshot de la API: puede traer el token. */
export function publicAdLibraryUrl(adId: string | null | undefined): string | null {
  const id = (adId ?? "").trim();
  if (!id) return null;
  return `${LIBRARY_URL}${encodeURIComponent(id)}`;
}

function asIso(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  const date = parseDate(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function normalizeMetaAd(row: MetaAd): MetaAd {
  return {
    ...row,
    page_name: row.page_name ? row.page_name.replace(/\s+/g, " ").trim() : row.page_name,
    bylines: row.bylines ? row.bylines.trim() : row.bylines,
    publisher_platforms: asStringArray(row.publisher_platforms),
    currency: row.currency ? row.currency.trim() : row.currency,
    spend_lower: asInt(row.spend_lower),
    spend_upper: asInt(row.spend_upper),
    impressions_lower: asInt(row.impressions_lower),
    impressions_upper: asInt(row.impressions_upper),
    ad_creative_bodies: asStringArray(row.ad_creative_bodies),
    ad_creative_link_titles: asStringArray(row.ad_creative_link_titles),
    ad_snapshot_url: publicAdLibraryUrl(row.ad_id),
    ad_creation_time: asIso(row.ad_creation_time),
    ad_delivery_start_time: asIso(row.ad_delivery_start_time),
    ad_delivery_stop_time: asIso(row.ad_delivery_stop_time),
    fetched_at: asIso(row.fetched_at) ?? row.fetched_at,
  };
}

export function isAdActive(ad: Pick<MetaAd, "ad_delivery_stop_time">, now: Date): boolean {
  if (!ad.ad_delivery_stop_time) return true;
  return new Date(ad.ad_delivery_stop_time).getTime() > now.getTime();
}

export function adStartAt(
  ad: Pick<MetaAd, "ad_delivery_start_time" | "ad_creation_time" | "fetched_at">,
): string | null {
  return ad.ad_delivery_start_time ?? ad.ad_creation_time ?? ad.fetched_at ?? null;
}

/** El anuncio estuvo en circulación en algún momento del período [since, until]. */
export function adOverlapsPeriod(ad: MetaAd, since: Date, until: Date): boolean {
  const startIso = adStartAt(ad);
  if (!startIso) return false;
  if (new Date(startIso) > until) return false;
  if (!ad.ad_delivery_stop_time) return true;
  return new Date(ad.ad_delivery_stop_time) >= since;
}

export function adSnippet(
  ad: Pick<MetaAd, "ad_creative_bodies" | "ad_creative_link_titles">,
  max = 220,
): string {
  const body = (ad.ad_creative_bodies ?? []).find((t) => t.trim()) ?? "";
  const title = (ad.ad_creative_link_titles ?? []).find((t) => t.trim()) ?? "";
  const text = (body || title).replace(/\s+/g, " ").trim();
  if (!text) return "Sin texto del anuncio";
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}…`;
}

export function formatAmount(value: number): string {
  return moneyFmt.format(value);
}

/**
 * Rango de gasto tal como lo informa Meta. No inventa un punto medio.
 * Si falta el techo, dice "o más". Si falta el piso, dice "hasta".
 */
export function formatSpendRange(
  currency: string | null,
  lower: number | null,
  upper: number | null,
): string {
  const cur = (currency ?? "").trim();
  const prefix = cur ? `${cur} ` : "";
  if (lower == null && upper == null) return "Sin dato de gasto";
  if (upper == null && lower != null) return `${prefix}${formatAmount(lower)} o más`;
  if (lower == null && upper != null) return `${prefix}hasta ${formatAmount(upper)}`;
  if (lower === upper) return `${prefix}${formatAmount(lower!)}`;
  return `${prefix}${formatAmount(lower!)} – ${formatAmount(upper!)}`;
}

export interface SpendByCurrency {
  currency: string;
  ads: number;
  lowerSum: number;
  upperSum: number;
  openUpper: number;
  openLower: number;
  missing: number;
}

export function aggregateSpend(ads: MetaAd[]): SpendByCurrency[] {
  const map = new Map<string, SpendByCurrency>();
  for (const ad of ads) {
    const currency = (ad.currency ?? "").trim() || "sin moneda";
    let row = map.get(currency);
    if (!row) {
      row = { currency, ads: 0, lowerSum: 0, upperSum: 0, openUpper: 0, openLower: 0, missing: 0 };
      map.set(currency, row);
    }
    row.ads += 1;
    const lower = asInt(ad.spend_lower);
    const upper = asInt(ad.spend_upper);
    if (lower == null && upper == null) {
      row.missing += 1;
      continue;
    }
    if (lower == null) row.openLower += 1;
    else row.lowerSum += lower;
    if (upper == null) row.openUpper += 1;
    else row.upperSum += upper;
  }
  return [...map.values()].sort((a, b) => b.ads - a.ads || a.currency.localeCompare(b.currency, "es"));
}

/** Texto honesto de una suma de rangos. El "+" marca techos abiertos; no se inventa un total. */
export function formatSpendAggregate(row: SpendByCurrency): { value: string; hint: string; openEnded: boolean } {
  const counted = row.ads - row.missing;
  if (counted <= 0) {
    return {
      value: "Sin dato de gasto",
      hint: "Estos anuncios no informan un rango de gasto.",
      openEnded: false,
    };
  }
  const openEnded = row.openUpper > 0;
  const prefix = `${row.currency} `;
  let value: string;
  if (openEnded) {
    value = `${prefix}${formatAmount(row.lowerSum)} – ${formatAmount(row.upperSum)}+`;
  } else if (row.openLower > 0) {
    value = `${prefix}${formatAmount(row.lowerSum)} – ${formatAmount(row.upperSum)}`;
  } else {
    value = formatSpendRange(row.currency, row.lowerSum, row.upperSum);
  }
  const parts = [
    "Suma de las cotas que informa Meta, no un total exacto. No convertimos monedas.",
  ];
  if (openEnded) {
    parts.push(
      `${row.openUpper} ${row.openUpper === 1 ? "anuncio no tiene" : "anuncios no tienen"} techo. El número de la derecha solo suma los techos conocidos; no se inventa un máximo.`,
    );
  }
  if (row.openLower > 0) {
    parts.push(
      `${row.openLower} ${row.openLower === 1 ? "anuncio no tiene" : "anuncios no tienen"} piso; en la suma inferior se tomó 0 para esos casos.`,
    );
  }
  if (row.missing > 0) {
    parts.push(`${row.missing} sin dato de gasto, no entran en la suma.`);
  }
  return { value, hint: parts.join(" "), openEnded };
}

export interface PageRank {
  key: string;
  pageId: string | null;
  pageName: string;
  ads: number;
  active: number;
}

export function rankPages(ads: MetaAd[], now: Date, limit = 10): PageRank[] {
  const map = new Map<string, PageRank>();
  for (const ad of ads) {
    const pageName = (ad.page_name ?? "").trim() || "Página sin nombre";
    const key = ad.page_id || pageName.toLowerCase();
    let row = map.get(key);
    if (!row) {
      row = { key, pageId: ad.page_id, pageName, ads: 0, active: 0 };
      map.set(key, row);
    }
    row.ads += 1;
    if (isAdActive(ad, now)) row.active += 1;
  }
  return [...map.values()].sort((a, b) => b.ads - a.ads || a.pageName.localeCompare(b.pageName, "es")).slice(0, limit);
}

export type AdsBucket = "day" | "week" | "month";

export interface AdsVolumePoint {
  key: string;
  label: string;
  total: number;
}

function monthKey(iso: string | Date): string {
  const key = typeof iso === "string" ? metaAdDateKey(iso) ?? dayKey(iso) : dayKey(iso);
  return key.slice(0, 7);
}

function weekStartKey(iso: string | Date): string {
  const key = typeof iso === "string" ? metaAdDateKey(iso) ?? dayKey(iso) : dayKey(iso);
  const date = new Date(`${key}T12:00:00-03:00`);
  // 12:00 ART es 15:00 UTC del mismo día civil; getUTCDay no depende del huso de la máquina.
  const dow = date.getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  const monday = new Date(date.getTime() - back * 86400000);
  return dayKey(monday);
}

function addDays(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00-03:00`);
  date.setDate(date.getDate() + days);
  return dayKey(date);
}

function addMonths(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function rangeKeys(start: string, end: string, bucket: AdsBucket): string[] {
  const out: string[] = [];
  if (bucket === "month") {
    for (let k = start.slice(0, 7); k <= end.slice(0, 7); k = addMonths(k, 1)) out.push(k);
    return out;
  }
  if (bucket === "week") {
    let k = weekStartKey(start);
    const last = weekStartKey(end);
    while (k <= last) {
      out.push(k);
      k = addDays(k, 7);
    }
    return out;
  }
  for (let k = start; k <= end; k = addDays(k, 1)) out.push(k);
  return out;
}

function bucketLabel(key: string, bucket: AdsBucket): string {
  if (bucket === "month") return formatMonth(key);
  if (bucket === "week") {
    const end = addDays(key, 6);
    const [, , d1] = key.split("-");
    const [, m2, d2] = end.split("-");
    return `${d1}/${key.slice(5, 7)}–${d2}/${m2}`;
  }
  const [, m, d] = key.split("-");
  return `${d}/${m}`;
}

export function volumeBucketFor(days: number | "all"): AdsBucket {
  if (days === "all" || days > 90) return "month";
  if (days > 30) return "week";
  return "day";
}

export function adsVolume(ads: MetaAd[], keys: string[], bucket: AdsBucket): AdsVolumePoint[] {
  const counts = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const ad of ads) {
    const start = ad.ad_delivery_start_time ?? ad.ad_creation_time;
    if (!start) continue;
    const key =
      bucket === "month" ? monthKey(start) : bucket === "week" ? weekStartKey(start) : (metaAdDateKey(start) ?? dayKey(start));
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return keys.map((key) => ({ key, label: bucketLabel(key, bucket), total: counts.get(key) ?? 0 }));
}

export function matchesMetaAdFilters(ad: MetaAd, filters: MetaAdFilters, now: Date): boolean {
  if (filters.page) {
    const needle = filters.page.trim().toLowerCase();
    const id = (ad.page_id ?? "").toLowerCase();
    const name = (ad.page_name ?? "").trim().toLowerCase();
    if (id !== needle && name !== needle) return false;
  }
  if (filters.currency) {
    if ((ad.currency ?? "").trim().toUpperCase() !== filters.currency.trim().toUpperCase()) return false;
  }
  if (filters.status === "activo" && !isAdActive(ad, now)) return false;
  if (filters.status === "inactivo" && isAdActive(ad, now)) return false;
  if (filters.q) {
    const q = filters.q.trim().toLowerCase();
    if (!q) return true;
    const hay = [
      ad.page_name,
      ad.bylines,
      ad.ad_id,
      ...(ad.ad_creative_bodies ?? []),
      ...(ad.ad_creative_link_titles ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export interface MetaAdsView {
  total: number;
  pages: number;
  active: number;
  firstStart: string | null;
  lastDelivery: string | null;
  fetchedAt: string | null;
  fetchedOn: string | null;
  spend: SpendByCurrency[];
  topPages: PageRank[];
  volume: AdsVolumePoint[];
  volumeBucket: AdsBucket;
  items: MetaAd[];
  filteredTotal: number;
  insufficient: boolean;
}

export function computeMetaAdsView(
  all: MetaAd[],
  opts: {
    days: number | "all";
    now: Date;
    filters?: MetaAdFilters;
    page?: number;
    pageSize?: number;
    topPages?: number;
  },
): MetaAdsView {
  const now = opts.now;
  const since =
    opts.days === "all" ? new Date(0) : new Date(now.getTime() - opts.days * 86400000);
  const period = all.filter((ad) => (opts.days === "all" ? true : adOverlapsPeriod(ad, since, now)));
  const starts = period.map(adStartAt).filter((v): v is string => Boolean(v));
  const ends = period.map((ad) => ad.ad_delivery_stop_time ?? adStartAt(ad)).filter((v): v is string => Boolean(v));
  const firstStart = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null;
  const lastDelivery = ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null;
  const fetchedAt = all.reduce<string | null>((acc, ad) => {
    if (!ad.fetched_at) return acc;
    return !acc || ad.fetched_at > acc ? ad.fetched_at : acc;
  }, null);
  const fetchedOn = all.reduce<string | null>((acc, ad) => {
    if (!ad.fetched_on) return acc;
    return !acc || ad.fetched_on > acc ? ad.fetched_on : acc;
  }, null);

  const pageSet = new Set(period.map((ad) => ad.page_id || (ad.page_name ?? "").trim().toLowerCase() || ad.ad_id));
  const bucket = volumeBucketFor(opts.days);
  let volumeStart: string;
  let volumeEnd: string;
  if (opts.days === "all") {
    volumeStart = firstStart ? (metaAdDateKey(firstStart) ?? dayKey(firstStart)) : dayKey(now);
    const endIso = lastDelivery && (!fetchedAt || lastDelivery < fetchedAt) ? lastDelivery : (fetchedAt ?? now.toISOString());
    volumeEnd = metaAdDateKey(endIso) ?? dayKey(endIso);
    if (volumeEnd < volumeStart) volumeEnd = volumeStart;
  } else {
    volumeStart = dayKey(since);
    volumeEnd = metaAdDateKey(now.toISOString()) ?? dayKey(now);
  }
  const keys = rangeKeys(volumeStart, volumeEnd, bucket);

  const filters = opts.filters ?? {};
  const matched = period.filter((ad) => matchesMetaAdFilters(ad, filters, now));
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, opts.page ?? 1);
  const startIdx = (page - 1) * pageSize;

  return {
    total: period.length,
    pages: pageSet.size,
    active: period.filter((ad) => isAdActive(ad, now)).length,
    firstStart,
    lastDelivery,
    fetchedAt,
    fetchedOn,
    spend: aggregateSpend(period),
    topPages: rankPages(period, now, opts.topPages ?? 10),
    volume: adsVolume(period, keys, bucket),
    volumeBucket: bucket,
    items: matched.slice(startIdx, startIdx + pageSize),
    filteredTotal: matched.length,
    insufficient: all.length === 0,
  };
}
