import type { DayVolume } from "./analytics";

/**
 * Variación del total del período actual contra la ventana anterior de la
 * misma longitud (si el tablero está en 7 días, es “vs semana anterior”).
 * percent = round((actual − anterior) / anterior × 100).
 * Si anterior es 0, no hay base: percent queda null.
 */
export function periodChange(
  current: number,
  previous: number,
): { percent: number | null; previous: number } {
  if (previous <= 0) return { percent: current === 0 ? 0 : null, previous };
  return { percent: Math.round(((current - previous) / previous) * 100), previous };
}

export interface VolumePeak {
  day: string;
  total: number;
  /** Porcentaje sobre el promedio del resto. Null si ese promedio es 0 (no se divide por cero). */
  percent: number | null;
  otherAverage: number;
}

/**
 * Pico de volumen: el día con más menciones (si hay empate, el más reciente).
 * X% = round((pico − promedio_del_resto) / promedio_del_resto × 100),
 * incluyendo ceros del período visible. No se usa el día previo solo.
 * Se devuelve null si no hay un pico claro (menos de 2 días, promedio 0,
 * o el máximo no supera al resto).
 */
export function volumePeak(days: DayVolume[], minPercent = 15): VolumePeak | null {
  if (days.length < 2) return null;
  let peak = days[0];
  for (const day of days) {
    if (day.total > peak.total || (day.total === peak.total && day.day >= peak.day)) peak = day;
  }
  if (peak.total <= 0) return null;
  const others = days.filter((d) => d.day !== peak.day);
  const otherAverage = others.reduce((s, d) => s + d.total, 0) / others.length;
  if (otherAverage <= 0) {
    return { day: peak.day, total: peak.total, percent: null, otherAverage: 0 };
  }
  const percent = Math.round(((peak.total - otherAverage) / otherAverage) * 100);
  if (percent < minPercent) return null;
  return { day: peak.day, total: peak.total, percent, otherAverage };
}

export function formatPeriodChange(percent: number | null, days: number): string {
  if (percent == null) return "sin base anterior";
  const window = days === 7 ? "semana anterior" : `período anterior de ${days} días`;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent}% vs ${window}`;
}
