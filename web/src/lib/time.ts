export const TZ = "America/Argentina/Buenos_Aires";
export const TZ_LABEL = "hora de Argentina";

const dateTimeFmt = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const shortDayFmt = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateTimeFmt.format(new Date(iso));
}

/** Clave de día (YYYY-MM-DD) en hora de Argentina. */
export function dayKey(iso: string | Date): string {
  return dayKeyFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatDayShort(key: string): string {
  // key YYYY-MM-DD en hora argentina; mediodía ART evita saltos de día.
  return shortDayFmt.format(new Date(`${key}T12:00:00-03:00`));
}

/** Inicio del día (00:00 ART) de una clave YYYY-MM-DD, en ISO UTC. */
export function startOfDayArt(key: string): string {
  return new Date(`${key}T00:00:00-03:00`).toISOString();
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
