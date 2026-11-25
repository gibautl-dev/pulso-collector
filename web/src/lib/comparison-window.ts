/**
 * Ventana común para comparar candidatos. Sin I/O.
 *
 * Dos candidatos solo se comparan en el período en que Pulso recolecta a los
 * dos, y solo con las fuentes que se miden para ambos. Si un rival se sumó
 * después (p. ej. Milei el 24/11), las menciones anteriores del candidato
 * principal no entran en la cuenta: si no, la participación queda sesgada.
 *
 * Inicio de cobertura por (sujeto, fuente):
 *  - `candidate_sources.collection_started_at` si la fila es legible y la
 *    fuente está activa (el staff y los miembros del candidato la ven);
 *  - si no es legible (RLS: un miembro no ve las fuentes del rival) o no
 *    tiene fecha, el `collected_at` más antiguo de esa fuente en `mentions`
 *    (el collector nunca lo pisa: `on conflict do nothing`).
 * Las notas que trae el primer barrido con fecha anterior (backfill) no
 * cuentan como cobertura: ese barrido es parcial.
 */

import type { CandidateSource, Mention } from "./types";
import { sourceLabel } from "./labels";
import { DEFAULT_CLOCK, type Clock } from "./time";

const DAY_MS = 86400000;

/** Fuentes de menciones que puede tener un candidato (catálogo del collector). */
export const MENTION_SOURCE_CATALOG = [
  "google_news",
  "rss_media",
  "google_alerts",
  "youtube",
  "gdelt",
  "x",
  "facebook",
  "instagram",
  "serp",
] as const;

/** Fuente → inicio de cobertura (ISO). Solo fuentes activas con fecha. */
export type CoverageStarts = Record<string, string>;

export interface SubjectCoverage {
  id: string;
  starts: CoverageStarts;
}

/**
 * Combina filas de `candidate_sources` (si se pudieron leer) con el primer
 * `collected_at` por fuente. Con filas legibles, una fuente apagada no cuenta.
 */
export function coverageStarts(
  rows: Pick<CandidateSource, "source" | "enabled" | "collection_started_at">[],
  firstCollected: Record<string, string | null | undefined> = {},
): CoverageStarts {
  const out: CoverageStarts = {};
  if (rows.length > 0) {
    for (const row of rows) {
      if (!row.enabled) continue;
      const start = row.collection_started_at ?? firstCollected[row.source] ?? null;
      if (start) out[row.source] = start;
    }
    return out;
  }
  for (const [source, start] of Object.entries(firstCollected)) {
    if (start) out[source] = start;
  }
  return out;
}

/** Fuentes cuyo inicio hay que buscar en `mentions` (filas ilegibles o sin fecha). */
export function sourcesNeedingFirstCollected(
  rows: Pick<CandidateSource, "source" | "enabled" | "collection_started_at">[],
  catalog: readonly string[],
): string[] {
  if (rows.length === 0) return [...catalog];
  return rows.filter((r) => r.enabled && !r.collection_started_at).map((r) => r.source);
}

export interface CommonWindow {
  /** Inicio efectivo (ISO): el más tardío entre lo pedido y la cobertura común. */
  start: string;
  /** Fin (ISO): momento de los datos. */
  end: string;
  /** Inicio que pidió el usuario (hoy − N días). */
  requestedStart: string;
  /** Desde cuándo todas las fuentes comparadas cubren a todos los sujetos. */
  coveredSince: string;
  /** Fuentes que se miden para todos los sujetos, ordenadas. */
  sources: string[];
  /** true si la ventana se recortó porque algún sujeto empezó después. */
  clipped: boolean;
  /** true si la ventana anterior de la misma longitud también está cubierta. */
  previousComparable: boolean;
  /** Ventana anterior (solo si `previousComparable`). */
  previousStart: string | null;
  previousEnd: string | null;
  subjects: number;
}

/**
 * Ventana común. Devuelve null si no hay fuentes compartidas o si la
 * cobertura común todavía no empezó.
 */
export function commonWindow(
  subjects: SubjectCoverage[],
  opts: { now: Date; days: number; allowedSources?: ReadonlySet<string> | null },
): CommonWindow | null {
  if (subjects.length === 0) return null;
  let shared: string[] = Object.keys(subjects[0].starts);
  for (const s of subjects.slice(1)) shared = shared.filter((src) => src in s.starts);
  if (opts.allowedSources) shared = shared.filter((src) => opts.allowedSources!.has(src));
  shared.sort();
  if (shared.length === 0) return null;

  let covered = -Infinity;
  for (const s of subjects) {
    for (const src of shared) covered = Math.max(covered, new Date(s.starts[src]).getTime());
  }
  const end = opts.now.getTime();
  if (!Number.isFinite(covered) || covered >= end) return null;
  const requested = end - opts.days * DAY_MS;
  const start = Math.max(requested, covered);
  const previousComparable = covered <= end - 2 * opts.days * DAY_MS;
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    requestedStart: new Date(requested).toISOString(),
    coveredSince: new Date(covered).toISOString(),
    sources: shared,
    clipped: covered > requested,
    previousComparable,
    previousStart: previousComparable ? new Date(end - 2 * opts.days * DAY_MS).toISOString() : null,
    previousEnd: previousComparable ? new Date(requested).toISOString() : null,
    subjects: subjects.length,
  };
}

function inRange(m: Mention, sources: string[], startMs: number, endMs: number | null): boolean {
  if (!sources.includes(m.source)) return false;
  const t = new Date(m.published_at).getTime();
  if (t < startMs) return false;
  return endMs == null || t < endMs;
}

/** Menciones dentro de la ventana común (fuentes compartidas, desde el inicio). */
export function mentionsInWindow<T extends Mention>(mentions: T[], w: CommonWindow): T[] {
  const start = new Date(w.start).getTime();
  return mentions.filter((m) => inRange(m, w.sources, start, null));
}

/** Menciones de terceros en la ventana común: la base del share of voice. */
export function countThirdPartyInWindow(mentions: Mention[], w: CommonWindow): number {
  return mentionsInWindow(mentions, w).filter((m) => m.account_relation === "third_party").length;
}

/** Igual, en la ventana anterior. null si esa ventana no está cubierta. */
export function countThirdPartyPrevious(mentions: Mention[], w: CommonWindow): number | null {
  if (!w.previousComparable || !w.previousStart || !w.previousEnd) return null;
  const start = new Date(w.previousStart).getTime();
  const end = new Date(w.previousEnd).getTime();
  return mentions.filter((m) => m.account_relation === "third_party" && inRange(m, w.sources, start, end)).length;
}

/** Días calendario (en la zona) que toca la ventana, para gráficos por día. */
export function windowCalendarDays(w: CommonWindow, timeZone: string = DEFAULT_CLOCK.timeZone): number {
  const key = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const first = key(new Date(w.start));
  const last = key(new Date(w.end));
  const diff = Math.round((Date.parse(`${last}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / DAY_MS);
  return Math.max(1, diff + 1);
}

function parts(iso: string, clock: Clock): { day: string; month: string; key: string; time: string } {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat(clock.locale, { timeZone: clock.timeZone, day: "numeric" }).format(d);
  const month = new Intl.DateTimeFormat(clock.locale, { timeZone: clock.timeZone, month: "short" })
    .format(d)
    .replace(".", "");
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: clock.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat(clock.locale, { timeZone: clock.timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { day, month, key, time };
}

/** Rango corto para la tarjeta: "24–25 nov", "28 oct – 3 nov" o "25 nov". */
export function formatWindowRange(w: CommonWindow, clock: Clock = DEFAULT_CLOCK): string {
  const a = parts(w.start, clock);
  const b = parts(w.end, clock);
  if (a.key === b.key) return `${a.day} ${a.month}`;
  if (a.month === b.month) return `${a.day}–${b.day} ${b.month}`;
  return `${a.day} ${a.month} – ${b.day} ${b.month}`;
}

function joinEs(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** Texto del ⓘ: qué período y qué fuentes se compararon. Sin jerga. */
export function windowTooltip(w: CommonWindow, clock: Clock = DEFAULT_CLOCK): string {
  const a = parts(w.start, clock);
  const b = parts(w.end, clock);
  const who = w.subjects > 2 ? "de todos" : "de ambos";
  const range =
    a.key === b.key
      ? `el ${a.day} ${a.month}`
      : a.month === b.month
        ? `del ${a.day} al ${b.day} ${b.month}`
        : `del ${a.day} ${a.month} al ${b.day} ${b.month}`;
  const since = w.clipped ? ` (desde las ${a.time}, ${clock.tzLabel})` : "";
  const sources = joinEs(w.sources.map(sourceLabel));
  const prev = w.previousComparable
    ? ""
    : ` Todavía no hay un período anterior completo con datos ${who} para mostrar la variación.`;
  return `Comparado ${range}${since}, período con datos ${who}. Fuentes que se miden para ${w.subjects > 2 ? "todos" : "los dos"}: ${sources}.${prev}`;
}
