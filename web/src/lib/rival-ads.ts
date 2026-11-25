import { adSnippet, adStance, formatMetaAdDate, isAdActive, publicAdLibraryUrl, STANCE_LABEL } from "./meta-ads";
import { formatGoogleAdDate, formatImpressionRange as formatGoogleImpressions } from "./google-ads";
import type { Candidate, GoogleAd, MetaAd, MetaAdStance } from "./types";

export interface ShareOfVoiceRow {
  id: string;
  name: string;
  slug: string;
  self: boolean;
  mentions: number;
  share: number | null;
}

/**
 * Share of voice: menciones de terceros de cada sujeto en el período,
 * sobre la suma de esos totales. No inventa un universo más amplio.
 */
export function shareOfVoice(
  rows: { id: string; name: string; slug: string; self: boolean; mentions: number }[],
): ShareOfVoiceRow[] {
  const total = rows.reduce((s, r) => s + r.mentions, 0);
  return rows.map((r) => ({
    ...r,
    share: total > 0 ? r.mentions / total : null,
  }));
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Tokens del nombre (apellidos y nombres de 4+ letras) para atribuir un anunciante. */
export function nameTokens(name: string): string[] {
  return fold(name)
    .split(" ")
    .filter((t) => t.length >= 4);
}

export function advertiserMatchesName(advertiser: string, candidateName: string): boolean {
  const hay = fold(advertiser);
  if (!hay) return false;
  const tokens = nameTokens(candidateName);
  // Se exige el apellido (último token de 4+ letras) para no atribuir
  // "Pedro Pesatti" a "Pedro Sánchez" solo por el nombre de pila.
  if (tokens.length === 0) return false;
  const surname = tokens[tokens.length - 1];
  return hay.includes(surname);
}

export interface RivalAdStats {
  rival: Candidate;
  ads: number;
  active: number;
  against: number;
  classified: number;
  againstShare: number | null;
  unmatched: boolean;
}

/**
 * Pauta atribuida a un rival a partir de los anuncios de Meta recolectados
 * para el candidato (los que lo mencionan o pautan en su carrera).
 * Se atribuye si page_name o bylines contienen un token del nombre del rival
 * (4+ letras). El % en contra es sobre los anuncios atribuidos que ya tienen
 * postura IA. Si no hay ninguno atribuible, unmatched=true (estado vacío).
 */
export function rivalMetaStats(ads: MetaAd[], rivals: Candidate[], now: Date): RivalAdStats[] {
  return rivals.map((rival) => {
    const mine = ads.filter((ad) => advertiserMatchesName(`${ad.page_name ?? ""} ${ad.bylines ?? ""}`, rival.name));
    const classified = mine.filter((ad) => adStance(ad) != null);
    const against = classified.filter((ad) => adStance(ad) === "en_contra").length;
    return {
      rival,
      ads: mine.length,
      active: mine.filter((ad) => isAdActive(ad, now)).length,
      against,
      classified: classified.length,
      againstShare: classified.length ? against / classified.length : null,
      unmatched: mine.length === 0,
    };
  });
}

export interface CreativeAdCard {
  id: string;
  channel: "meta" | "google";
  advertiser: string;
  sponsoredLabel: string;
  body: string | null;
  bodyMissingReason: string | null;
  active: boolean | null;
  stance: MetaAdStance | null;
  stanceLabel: string | null;
  impressions: string;
  since: string;
  href: string | null;
}

export const GOOGLE_CREATIVE_GAP =
  "El reporte oficial de Google no incluye el texto del creativo.";

export function metaToCreativeCard(ad: MetaAd, now: Date): CreativeAdCard {
  const snippet = adSnippet(ad, 280);
  const hasText = snippet !== "Sin texto del anuncio";
  const platforms = (ad.publisher_platforms ?? []).map((p) => {
    const k = p.toLowerCase();
    if (k === "facebook") return "Facebook";
    if (k === "instagram") return "Instagram";
    return null;
  }).filter(Boolean);
  const channel = platforms.length ? platforms.join(" e ") : "Facebook e Instagram";
  const start = formatMetaAdDate(ad.ad_delivery_start_time ?? ad.ad_creation_time);
  const stance = adStance(ad);
  const impressions =
    ad.impressions_lower != null || ad.impressions_upper != null
      ? formatMetaImpressionsRange(ad)
      : "Sin dato de impresiones";
  return {
    id: ad.id,
    channel: "meta",
    advertiser: (ad.page_name ?? "").trim() || "Página sin nombre",
    sponsoredLabel: `Patrocinado · ${channel}`,
    body: hasText ? snippet : null,
    bodyMissingReason: hasText ? null : "Este anuncio no trae texto en la Biblioteca de Meta.",
    active: isAdActive(ad, now),
    stance,
    stanceLabel: stance ? STANCE_LABEL[stance] : null,
    impressions,
    since: start !== "—" ? `desde ${start.slice(0, 5)}` : "",
    href: publicAdLibraryUrl(ad.ad_id),
  };
}

function formatMetaImpressionsRange(ad: MetaAd): string {
  const lower = typeof ad.impressions_lower === "number" ? ad.impressions_lower : Number(ad.impressions_lower);
  const upper = typeof ad.impressions_upper === "number" ? ad.impressions_upper : Number(ad.impressions_upper);
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} mill.`;
    if (n >= 1000) return `${Math.round(n / 1000)} mil`;
    return n.toLocaleString("es-AR");
  };
  if (Number.isFinite(lower) && Number.isFinite(upper)) {
    if (lower === upper) return `${fmt(lower)} impresiones`;
    return `${fmt(lower)} – ${fmt(upper)} impresiones`;
  }
  if (Number.isFinite(lower)) return `${fmt(lower)} impresiones o más`;
  if (Number.isFinite(upper)) return `hasta ${fmt(upper)} impresiones`;
  return "Sin dato de impresiones";
}

export function googleToCreativeCard(ad: GoogleAd): CreativeAdCard {
  const start = formatGoogleAdDate(ad.date_range_start ?? ad.first_served_at);
  return {
    id: ad.id,
    channel: "google",
    advertiser: (ad.advertiser_name ?? "").trim() || "Anunciante sin nombre",
    sponsoredLabel: "Patrocinado · Google",
    body: null,
    bodyMissingReason: GOOGLE_CREATIVE_GAP,
    active: null,
    stance: null,
    stanceLabel: null,
    impressions: formatGoogleImpressions(ad),
    since: start !== "—" ? `desde ${start.slice(0, 5)}` : "",
    href: ad.ad_url,
  };
}

/** Anuncios de rivales: Meta atribuidos + Google cuyo anunciante coincide con el rival. */
export function rivalCreativeCards(
  parentMeta: MetaAd[],
  parentGoogle: GoogleAd[],
  rivals: Candidate[],
  now: Date,
  limit = 12,
): CreativeAdCard[] {
  const meta = parentMeta
    .filter((ad) => rivals.some((r) => advertiserMatchesName(`${ad.page_name ?? ""} ${ad.bylines ?? ""}`, r.name)))
    .map((ad) => metaToCreativeCard(ad, now));
  const google = parentGoogle
    .filter((ad) => rivals.some((r) => advertiserMatchesName(`${ad.advertiser_name ?? ""} ${ad.ad_funded_by ?? ""}`, r.name)))
    .map(googleToCreativeCard);
  return [...meta, ...google].slice(0, limit);
}

export function formatSharePct(share: number | null): string {
  if (share == null) return "—";
  return `${Math.round(share * 100)}%`;
}
