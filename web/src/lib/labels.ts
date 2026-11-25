import type { Relevance, RunStatus, SuspiciousPlatform, SuspiciousStatus, Target, Tone } from "./types";

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
  acusacion: "bg-red-50 text-red-800 ring-red-700/20",
  pregunta: "bg-violet-50 text-violet-700 ring-violet-600/20",
  informativo: "bg-slate-100 text-slate-700 ring-slate-500/20",
};

/** Color de barra por tono. */
export const TONE_BAR: Record<Tone, string> = {
  a_favor: "bg-emerald-500",
  critica: "bg-rose-500",
  insulto: "bg-red-800",
  acusacion: "bg-red-800",
  pregunta: "bg-violet-500",
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
  meta_ads: "Biblioteca de anuncios de Meta",
  google_ads: "Anuncios de Google",
};
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** Clases Tailwind por fuente (badge). */
export const SOURCE_BADGE: Record<string, string> = {
  google_news: "bg-sky-50 text-sky-800 ring-sky-600/20",
  rss_media: "bg-amber-50 text-amber-800 ring-amber-600/20",
  google_alerts: "bg-teal-50 text-teal-800 ring-teal-600/20",
  youtube: "bg-red-50 text-red-800 ring-red-600/20",
  x: "bg-zinc-900 text-white ring-zinc-900",
};
export const SOURCE_BADGE_DEFAULT = "bg-slate-100 text-slate-700 ring-slate-500/20";

/** Color de barra por fuente (tablero). */
export const SOURCE_BAR: Record<string, string> = {
  google_news: "bg-sky-500",
  rss_media: "bg-amber-500",
  google_alerts: "bg-teal-500",
  youtube: "bg-red-500",
  x: "bg-zinc-800",
};
export const SOURCE_BAR_DEFAULT = "bg-slate-400";

/** Fuentes de producto que siempre aparecen en el filtro, aunque no estén habilitadas. */
export const PRIMARY_SOURCES = ["google_news", "rss_media", "youtube", "x"] as const;


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



export const SUSPICIOUS_STATUS_LABEL: Record<SuspiciousStatus, string> = {
  pending: "Pendiente",
  reviewed_suspicious: "Sospechosa",
  discarded: "Descartada",
  reported_manual: "Denunciada a mano",
};

export const SUSPICIOUS_STATUS_BADGE: Record<SuspiciousStatus, string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-600/20",
  reviewed_suspicious: "bg-rose-50 text-rose-800 ring-rose-600/20",
  discarded: "bg-slate-100 text-slate-600 ring-slate-500/20",
  reported_manual: "bg-indigo-50 text-indigo-800 ring-indigo-600/20",
};

export const SUSPICIOUS_SIGNAL_LABEL: Record<string, string> = {
  self_repeat: "Texto repetido",
  coordination: "Posible coordinación",
  author_burst: "Ráfaga",
  group_burst: "Ráfaga de grupo",
  new_account: "Cuenta nueva",
  follow_ratio: "Relación de seguidos",
  digit_name: "Nombre con dígitos",
  low_engagement: "Poco engagement",
};

export function suspiciousSignalLabel(type: string): string {
  return SUSPICIOUS_SIGNAL_LABEL[type] ?? type;
}

export function suspiciousAccountLabel(a: {
  platform: SuspiciousPlatform;
  handle: string | null;
  display_name: string | null;
  account_key: string;
}): string {
  if (a.platform === "youtube" && a.display_name?.startsWith("@")) return a.display_name;
  if (a.handle) return `@${a.handle.replace(/^@/, "")}`;
  return a.display_name || a.account_key;
}

export const CRISIS_STATUS_LABEL: Record<string, string> = {
  new: "Nueva",
  in_review: "En revisión",
  approved: "Aprobada",
  discarded: "Descartada",
};
export const CRISIS_STATUS_BADGE: Record<string, string> = {
  new: "bg-amber-50 text-amber-800 ring-amber-200",
  in_review: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  discarded: "bg-slate-100 text-slate-600 ring-slate-200",
};
export const CRISIS_TRIGGER_LABEL: Record<string, string> = {
  negative_spike: "Pico negativo",
  rising_topic: "Tema emergente",
  suspicious_campaign: "Campaña sospechosa",
  attack_ads: "Anuncios en contra",
  ai_shift: "Caída en la IA",
};
export const CRISIS_RISK_LABEL: Record<string, string> = {
  bajo: "Riesgo bajo",
  medio: "Riesgo medio",
  medio_alto: "Riesgo medio-alto",
  alto: "Riesgo alto",
};
export const CRISIS_RISK_BADGE: Record<string, string> = {
  bajo: "bg-slate-50 text-slate-700 ring-slate-200",
  medio: "bg-amber-50 text-amber-800 ring-amber-200",
  medio_alto: "bg-orange-50 text-orange-800 ring-orange-200",
  alto: "bg-rose-50 text-rose-800 ring-rose-200",
};
export const CRISIS_CHANNEL_LABEL: Record<string, string> = {
  x: "Borrador para X",
  comunicado: "Comunicado",
  argumento_oral: "Argumento oral",
};

export const RIVAL_LEVEL_LABEL: Record<string, string> = {
  radar: "Radar",
  comparativo: "Comparativo",
  completo: "Completo",
};
export const RIVAL_LEVEL_HINT: Record<string, string> = {
  radar: "Solo menciones en medios.",
  comparativo: "Volumen, balance y anuncios: ranking y curvas frente al candidato.",
  completo: "Medios, X, IA, anuncios y cuentas sospechosas.",
};

export const PENDING_CANDIDATE_STATUS_LABEL = "Pendiente de alta";
export const PENDING_CANDIDATE_STATUS_LABELS: Record<string, string> = {
  pendiente_de_alta: "Pendiente de alta",
  aprobado: "Aprobado y activado",
  borrado: "Borrado",
};

export const META_ADS_EU_UNAVAILABLE =
  "No aplica en la UE (anuncios políticos bloqueados)";

/** Nombre visible de la bandeja de crisis. La ruta sigue siendo /accion. */
export const ACCION_SECTION_LABEL = "Equipo de acción";
/** Sección de temáticas definidas a mano, distinta de los temas automáticos del clasificador. */
export const CUSTOM_TOPICS_SECTION_LABEL = "Temas a medida";

export const CUSTOM_TOPIC_SUMMARY_STATUS_LABEL: Record<string, string> = {
  draft: "Borrador para revisar",
  approved: "Aprobado",
  discarded: "Descartado",
};

export const SIMULATOR_SECTION_LABEL = "Simulador de respuesta";
