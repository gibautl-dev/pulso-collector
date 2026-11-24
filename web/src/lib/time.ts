import { DEFAULT_REGION, regionFor, type RegionProfile } from "./region";

export const TZ = DEFAULT_REGION.timezone;
export const TZ_LABEL = DEFAULT_REGION.tzLabel;

export interface Clock {
  timeZone: string;
  locale: string;
  tzLabel: string;
}

export const DEFAULT_CLOCK: Clock = {
  timeZone: TZ,
  locale: DEFAULT_REGION.locale,
  tzLabel: TZ_LABEL,
};

export function clockFromRegion(region: RegionProfile): Clock {
  return { timeZone: region.timezone, locale: region.locale, tzLabel: region.tzLabel };
}

export function clockFor(slug: string | null | undefined): Clock {
  return clockFromRegion(regionFor(slug));
}

function dateTimeFmt(clock: Clock) {
  return new Intl.DateTimeFormat(clock.locale, {
    timeZone: clock.timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function dayKeyFmt(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function shortDayFmt(clock: Clock) {
  return new Intl.DateTimeFormat(clock.locale, {
    timeZone: clock.timeZone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function dateFmt(clock: Clock) {
  return new Intl.DateTimeFormat(clock.locale, {
    timeZone: clock.timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function monthFmt(clock: Clock) {
  return new Intl.DateTimeFormat(clock.locale, {
    timeZone: clock.timeZone,
    month: "short",
    year: "numeric",
  });
}

/** Acepta ISO y el formato de Postgres (`2026-11-19 19:16:01+00`). */
export function parseDate(iso: string): Date {
  let value = iso.trim();
  if (/^\d{4}-\d{2}-\d{2} /.test(value)) value = value.replace(" ", "T");
  value = value.replace(/([+-]\d{2})$/, "$1:00");
  return new Date(value);
}

export function formatDateTime(iso: string | null | undefined, clock: Clock = DEFAULT_CLOCK): string {
  if (!iso) return "—";
  const date = parseDate(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFmt(clock).format(date);
}

/** Fecha (dd/mm/aaaa) en la zona del reloj. */
export function formatDate(iso: string | null | undefined, clock: Clock = DEFAULT_CLOCK): string {
  if (!iso) return "—";
  const date = parseDate(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFmt(clock).format(date);
}

/** Mes corto (p. ej. "nov 2026") en la zona del reloj. */
export function formatMonth(key: string, clock: Clock = DEFAULT_CLOCK): string {
  const iso = key.length === 7 ? `${key}-01T12:00:00Z` : `${key}T12:00:00Z`;
  return monthFmt(clock).format(new Date(iso)).replace(".", "");
}

/** Clave de día (YYYY-MM-DD) en la zona indicada (por defecto, Argentina). */
export function dayKey(iso: string | Date, timeZone: string = TZ): string {
  return dayKeyFmt(timeZone).format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatDayShort(key: string, clock: Clock = DEFAULT_CLOCK): string {
  // Mediodía UTC cae el mismo día calendario en AR y en Madrid.
  return shortDayFmt(clock).format(new Date(`${key}T12:00:00Z`));
}

function offsetIso(timeZone: string, date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return "+00:00";
  return `${match[1]}${String(match[2]).padStart(2, "0")}:${match[3] ?? "00"}`;
}

/** Inicio del día (00:00 en la zona) de una clave YYYY-MM-DD, en ISO UTC. */
export function startOfDay(key: string, timeZone: string = TZ): string {
  const offset = offsetIso(timeZone, new Date(`${key}T12:00:00Z`));
  return new Date(`${key}T00:00:00${offset}`).toISOString();
}

/** Inicio del día (00:00 ART) de una clave YYYY-MM-DD, en ISO UTC. */
export function startOfDayArt(key: string): string {
  return startOfDay(key, TZ);
}

export function relativeTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "nunca";
  const diffMin = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "recién";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const h = Math.round(diffMin / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export function durationSeconds(start: string, end: string | null): number | null {
  if (!end) return null;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}
