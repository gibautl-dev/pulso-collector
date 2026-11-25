/** Perfil regional por candidato, espejo de pulso/region.py. Sin cambio de esquema. */

export interface RegionProfile {
  country: string;
  countryName: string;
  timezone: string;
  locale: string;
  tzLabel: string;
  electionLabel: string;
  showMetaAds: boolean;
  /** Ruta oficial de anuncios de Google disponible para este país. */
  showGoogleAds: boolean;
}

export const DEFAULT_REGION: RegionProfile = {
  country: "AR",
  countryName: "Argentina",
  timezone: "America/Argentina/Buenos_Aires",
  locale: "es-AR",
  tzLabel: "hora de Argentina",
  electionLabel: "Elecciones 2027 · Argentina",
  showMetaAds: true,
  showGoogleAds: true,
};

export const SPAIN_REGION: RegionProfile = {
  country: "ES",
  countryName: "España",
  timezone: "Europe/Madrid",
  locale: "es-ES",
  tzLabel: "hora de España",
  electionLabel: "Elecciones generales 29N · España",
  showMetaAds: false,
  showGoogleAds: true,
};

const PROFILES: Record<string, RegionProfile> = {
  "pedro-sanchez": SPAIN_REGION,
};

export const META_ADS_EU_UNAVAILABLE =
  "Desde el 6 de octubre de 2025 Meta no entrega anuncios políticos, electorales o de temas sociales en la Unión Europea, y la API de la Biblioteca de anuncios ya no admite esa búsqueda para países de la UE.";

export function regionFor(slug: string | null | undefined): RegionProfile {
  if (slug && PROFILES[slug]) return PROFILES[slug];
  return DEFAULT_REGION;
}
