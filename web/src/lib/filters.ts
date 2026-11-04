import { NEGATIVE_TONES, RELEVANCE, TONES } from "./labels";
import type { Mention, Relevance, Target, Tone } from "./types";
import { startOfDayArt } from "./time";

export const PAGE_SIZE = 25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_RE = /^[a-z_]{1,32}$/;
const TARGETS: Target[] = ["candidate", "other", "unclear"];

export interface MentionFilters {
  tone?: Tone | "pendiente" | "negativas";
  target?: Target;
  topic?: string;
  source?: string;
  relevance?: Relevance;
  from?: string; // YYYY-MM-DD, hora argentina, inclusive
  to?: string; // YYYY-MM-DD, hora argentina, inclusive
  q?: string;
  page: number;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() !== "" ? s.trim() : undefined;
}

/**
 * Limpia el texto de búsqueda. Se usa dentro de un filtro `or=(...)` de
 * PostgREST, así que quitamos los caracteres con significado sintáctico
 * (coma, paréntesis, comodines, comillas, barra invertida) para que el
 * usuario no pueda inyectar condiciones adicionales.
 */
export function sanitizeSearch(q: string | undefined): string | undefined {
  if (!q) return undefined;
  const clean = q
    .replace(/[,()*%_\\"'.:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return clean.length >= 2 ? clean : undefined;
}

/** Valida los parámetros contra listas blancas; lo inválido se ignora. */
export function parseFilters(params: RawParams): MentionFilters {
  const tone = first(params.tone);
  const target = first(params.target);
  const topic = first(params.topic);
  const source = first(params.source);
  const relevance = first(params.relevance);
  const from = first(params.from);
  const to = first(params.to);
  const page = Number.parseInt(first(params.page) ?? "1", 10);
  return {
    tone:
      tone === "pendiente" || tone === "negativas" || (tone && (TONES as string[]).includes(tone))
        ? (tone as Tone | "pendiente" | "negativas")
        : undefined,
    target: target && (TARGETS as string[]).includes(target) ? (target as Target) : undefined,
    topic: topic && UUID_RE.test(topic) ? topic : undefined,
    source: source && SOURCE_RE.test(source) ? source : undefined,
    relevance:
      relevance && (RELEVANCE as string[]).includes(relevance) ? (relevance as Relevance) : undefined,
    from: from && DAY_RE.test(from) ? from : undefined,
    to: to && DAY_RE.test(to) ? to : undefined,
    q: sanitizeSearch(first(params.q)),
    page: Number.isFinite(page) && page > 0 && page < 10000 ? page : 1,
  };
}

/** Límites de fecha en ISO UTC para [from 00:00 ART, (to+1) 00:00 ART). */
export function dateBounds(f: MentionFilters): { gte?: string; lt?: string } {
  const out: { gte?: string; lt?: string } = {};
  if (f.from) out.gte = startOfDayArt(f.from);
  if (f.to) {
    const next = new Date(`${f.to}T00:00:00-03:00`);
    next.setUTCDate(next.getUTCDate() + 1);
    out.lt = next.toISOString();
  }
  return out;
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Filtro en memoria (modo fixture y tests); equivale a la consulta Supabase. */
export function applyFilters(mentions: Mention[], f: MentionFilters): Mention[] {
  const { gte, lt } = dateBounds(f);
  const q = f.q ? normalize(f.q) : undefined;
  return mentions
    .filter((m) => {
      if (f.tone === "pendiente") {
        if (m.tone !== null) return false;
      } else if (f.tone === "negativas") {
        if (!m.tone || !NEGATIVE_TONES.includes(m.tone)) return false;
      } else if (f.tone && m.tone !== f.tone) return false;
      if (f.target && m.target !== f.target) return false;
      if (f.topic && m.topic_id !== f.topic) return false;
      if (f.source && m.source !== f.source) return false;
      if (f.relevance && m.relevance !== f.relevance) return false;
      if (gte && new Date(m.published_at) < new Date(gte)) return false;
      if (lt && new Date(m.published_at) >= new Date(lt)) return false;
      if (q) {
        const hay = normalize(`${m.title ?? ""} ${m.content ?? ""}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => b.published_at.localeCompare(a.published_at));
}

export function filtersToSearch(f: MentionFilters, overrides: Partial<MentionFilters> = {}): string {
  const merged = { ...f, ...overrides };
  const sp = new URLSearchParams();
  for (const k of ["tone", "target", "topic", "source", "relevance", "from", "to", "q"] as const) {
    const v = merged[k];
    if (v) sp.set(k, v);
  }
  if (merged.page && merged.page > 1) sp.set("page", String(merged.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function hasActiveFilters(f: MentionFilters): boolean {
  return Boolean(f.tone || f.target || f.topic || f.source || f.relevance || f.from || f.to || f.q);
}
