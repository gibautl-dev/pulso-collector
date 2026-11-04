import type { Relevance, RunStatus, Target, Tone } from "./types";

export const TONES: Tone[] = [
  "critica",
  "acusacion",
  "insulto",
  "pregunta",
  "informativo",
  "a_favor",
];

export const TONE_LABEL: Record<Tone, string> = {
  a_favor: "A favor",
  critica: "Crítica",
  insulto: "Insulto",
  acusacion: "Acusación",
  pregunta: "Pregunta",
  informativo: "Informativo",
};

/** Clases Tailwind por tono (badge). */
export const TONE_BADGE: Record<Tone, string> = {
  a_favor: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  critica: "bg-rose-50 text-rose-700 ring-rose-600/20",
  insulto: "bg-red-100 text-red-800 ring-red-600/30",
  acusacion: "bg-orange-50 text-orange-700 ring-orange-600/20",
  pregunta: "bg-sky-50 text-sky-700 ring-sky-600/20",
  informativo: "bg-slate-100 text-slate-700 ring-slate-500/20",
};

/** Color de barra por tono. */
export const TONE_BAR: Record<Tone, string> = {
  a_favor: "bg-emerald-500",
  critica: "bg-rose-500",
  insulto: "bg-red-700",
  acusacion: "bg-orange-500",
  pregunta: "bg-sky-500",
  informativo: "bg-slate-400",
};

export const NEGATIVE_TONES: Tone[] = ["critica", "acusacion", "insulto"];

export const TARGET_LABEL: Record<Target, string> = {
  candidate: "Sobre el candidato",
  other: "Sobre otros",
  unclear: "Objetivo poco claro",
};

export const RELEVANCE: Relevance[] = ["alta", "media", "baja"];
export const RELEVANCE_LABEL: Record<Relevance, string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};
export const RELEVANCE_BADGE: Record<Relevance, string> = {
  alta: "bg-indigo-600 text-white ring-indigo-600",
  media: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  baja: "bg-white text-slate-500 ring-slate-300",
};

const SOURCE_LABELS: Record<string, string> = {
  google_news: "Google News",
  rss_media: "Medios (RSS)",
  google_alerts: "Google Alerts",
  youtube: "YouTube",
  gdelt: "GDELT",
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  serp: "Buscador (SERP)",
  llm: "Clasificador IA",
};
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: "En curso",
  ok: "OK",
  partial: "Parcial",
  error: "Error",
  skipped: "Omitida",
};
export const RUN_STATUS_BADGE: Record<RunStatus, string> = {
  running: "bg-sky-50 text-sky-700 ring-sky-600/20",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  partial: "bg-amber-50 text-amber-800 ring-amber-600/20",
  error: "bg-rose-50 text-rose-700 ring-rose-600/20",
  skipped: "bg-slate-100 text-slate-600 ring-slate-500/20",
};
