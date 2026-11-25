import type { WikipediaPageview, WikipediaPageviewSettings } from "@/lib/types";

export const WIKIMEDIA_ATTRIBUTION = {
  name: "Wikimedia",
  href: "https://www.wikimedia.org/",
  tip: "Visitas de personas a la página del candidato en Wikipedia en español. Fuente: Wikimedia.",
};

export const GDELT_ATTRIBUTION = {
  name: "Proyecto GDELT",
  href: "https://www.gdeltproject.org/",
  tip: "Cobertura de noticias reunida por el Proyecto GDELT.",
};

export interface WikipediaInterest {
  article: string;
  project: string;
  url: string;
  lastDay: string;
  lastViews: number;
  previousViews: number | null;
  changePercent: number | null;
  series: { day: string; views: number }[];
}

export function articleUrl(project: string, article: string): string {
  const host = project.replaceAll("_", "-");
  return `https://${host}.org/wiki/${encodeURIComponent(article)}`;
}

/** Último día con dato, variación frente a 7 días antes, y la serie para la minigráfica. */
export function computeWikipediaInterest(
  rows: WikipediaPageview[],
  settings?: WikipediaPageviewSettings | null,
): WikipediaInterest | null {
  const series = rows
    .map((r) => ({ day: r.day.slice(0, 10), views: Number(r.views) || 0 }))
    .filter((r) => r.day)
    .sort((a, b) => a.day.localeCompare(b.day));
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  const previous = series.find((r) => r.day === shiftDay(last.day, -7)) ?? null;
  let changePercent: number | null = null;
  if (previous && previous.views > 0) {
    changePercent = Math.round(((last.views - previous.views) / previous.views) * 100);
  } else if (previous && previous.views === 0 && last.views > 0) {
    changePercent = null;
  }
  const article = settings?.article || rows[rows.length - 1]?.article || "";
  const project = settings?.project || rows[rows.length - 1]?.project || "es.wikipedia";
  return {
    article,
    project,
    url: articleUrl(project, article),
    lastDay: last.day,
    lastViews: last.views,
    previousViews: previous ? previous.views : null,
    changePercent,
    series,
  };
}

export function formatDayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  const formatted = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return formatted.replace(".", "");
}

export function formatViews(n: number): string {
  return n.toLocaleString("es-AR");
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
