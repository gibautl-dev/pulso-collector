/** Navegación entre candidatos visibles (RLS). Sin I/O. */

import { regionFor } from "@/lib/region";

export const LAST_CANDIDATE_COOKIE = "pulso_last_candidate";

export const CANDIDATE_SECTIONS = [
  "resumen",
  "simulador",
  "menciones",
  "fuentes",
  "sospechosas",
  "accion",
  "temas",
  "comparacion",
  "ia",
  "x",
  "anuncios",
] as const;

export type CandidateSection = (typeof CANDIDATE_SECTIONS)[number];

const SECTION_SET = new Set<string>(CANDIDATE_SECTIONS);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseCandidateSlug(value: string | null | undefined): string | null {
  if (!value || !SLUG_RE.test(value)) return null;
  return value;
}

export function parseCandidatePath(
  pathname: string,
): { slug: string; section: string } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "c" || !parts[1]) return null;
  const slug = parseCandidateSlug(parts[1]);
  if (!slug) return null;
  return { slug, section: parts[2] ?? "" };
}

/** La pestaña existe en el destino (Anuncios, p. ej., no está en candidatos de la UE). */
export function sectionAvailable(section: string, targetSlug: string): boolean {
  if (!section) return true;
  if (!SECTION_SET.has(section)) return false;
  // Anuncios incluye Meta y/o Google. Google aplica también en la UE.
  if (section === "anuncios") {
    const region = regionFor(targetSlug);
    return region.showMetaAds || region.showGoogleAds;
  }
  return true;
}

/** Misma sección si el destino la tiene; si no, el tablero del candidato. */
export function hrefForCandidate(targetSlug: string, pathname: string): string {
  const parsed = parseCandidatePath(pathname);
  const section = parsed?.section ?? "";
  if (section && sectionAvailable(section, targetSlug)) {
    return `/c/${targetSlug}/${section}`;
  }
  return `/c/${targetSlug}`;
}

export type HomeDestination =
  | { type: "empty" }
  | { type: "redirect"; slug: string }
  | { type: "chooser" };

/**
 * Un candidato: va directo. Varios: última visita (cookie) si sigue siendo
 * visible; si no hay cookie válida, el selector de inicio. Nunca el primero
 * por nombre en silencio.
 */
export function homeDestination(
  candidates: { slug: string }[],
  lastSlug: string | null | undefined,
): HomeDestination {
  if (candidates.length === 0) return { type: "empty" };
  if (candidates.length === 1) return { type: "redirect", slug: candidates[0].slug };
  const last = parseCandidateSlug(lastSlug ?? null);
  if (last && candidates.some((c) => c.slug === last)) {
    return { type: "redirect", slug: last };
  }
  return { type: "chooser" };
}

export function lastCandidateCookieOptions(secure: boolean) {
  return {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    secure,
    maxAge: 60 * 60 * 24 * 180,
  };
}
