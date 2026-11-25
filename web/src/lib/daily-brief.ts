/** Resumen diario: lectura defensiva del JSON guardado y cifras para la UI. Sin I/O. */

import type {
  DailyBrief,
  DailyBriefAction,
  DailyBriefHighlight,
  DailyBriefOutput,
  DailyBriefPoint,
  DailyBriefSource,
} from "@/lib/types";

export const DAILY_BRIEF_SECTION_LABEL = "Resumen del día";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseBriefDate(value: unknown): string | null {
  return typeof value === "string" && DATE_RE.test(value) ? value : null;
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "Martes 24 de noviembre" a partir de YYYY-MM-DD (fecha civil, sin zona). */
export function briefDateLabel(day: string, { capital = true }: { capital?: boolean } = {}): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const text = `${WEEKDAYS[dt.getUTCDay()]} ${d} de ${MONTHS[m - 1]}`;
  return capital ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function briefDateShort(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d}/${m}`;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function points(value: unknown): DailyBriefPoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null))
    .filter((v): v is Record<string, unknown> => v !== null && str(v.text).trim().length > 0)
    .map((v) => ({ text: str(v.text), mention_ids: strings(v.mention_ids) }))
    .filter((p) => p.mention_ids.length > 0);
}

function actions(value: unknown): DailyBriefAction[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null))
    .filter((v): v is Record<string, unknown> => v !== null && str(v.action).trim().length > 0)
    .map((v) => ({
      action: str(v.action),
      why: str(v.why),
      priority: str(v.priority) || "media",
      area: str(v.area),
      mention_ids: strings(v.mention_ids),
    }))
    .filter((a) => a.mention_ids.length > 0);
}

function highlight(value: unknown): DailyBriefHighlight | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!str(v.value)) return null;
  return {
    key: str(v.key),
    value: str(v.value),
    label: str(v.label),
    delta: typeof v.delta === "string" && v.delta ? v.delta : null,
    tone: str(v.tone) || "neutral",
  };
}

function sources(value: unknown): DailyBriefSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null))
    .filter((v): v is Record<string, unknown> => v !== null && /^https?:\/\//.test(str(v.url)) && !!str(v.id))
    .map((v) => ({
      id: str(v.id),
      url: str(v.url),
      title: str(v.title),
      outlet: str(v.outlet) || null,
      source: str(v.source),
      tone: (str(v.tone) || null) as DailyBriefSource["tone"],
      time: str(v.time) || null,
    }));
}

/** Solo quedan puntos con al menos una fuente que exista en la lista de fuentes. */
export function normalizeOutput(raw: unknown): DailyBriefOutput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const src = sources(o.sources);
  const known = new Set(src.map((s) => s.id));
  const keep = <T extends { mention_ids: string[] }>(items: T[]) =>
    items
      .map((it) => ({ ...it, mention_ids: it.mention_ids.filter((id) => known.has(id)) }))
      .filter((it) => it.mention_ids.length > 0);
  return {
    headline: str(o.headline),
    highlight: highlight(o.highlight),
    what_changed: keep(points(o.what_changed)),
    why_it_matters: keep(points(o.why_it_matters)),
    what_to_do: keep(actions(o.what_to_do)),
    aclaracion: str(o.aclaracion),
    insufficient_reason: str(o.insufficient_reason) || null,
    sources: src,
  };
}

export function pickBrief(briefs: DailyBrief[], day: string | null): DailyBrief | null {
  if (briefs.length === 0) return null;
  if (day) return briefs.find((b) => b.brief_date === day) ?? null;
  return [...briefs].sort((a, b) => b.brief_date.localeCompare(a.brief_date))[0];
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export interface BriefKpi {
  key: "menciones" | "criticas" | "a_favor" | "balance";
  label: string;
  value: string;
  hint: string | null;
  tone: "default" | "negative" | "positive";
}

function signedPct(value: number | null): string | null {
  if (value == null) return null;
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}% vs. promedio 7 días`;
}

/** Cuatro cifras del día, con la comparación solo si la base es fiable. */
export function briefKpis(metrics: Record<string, unknown>, locale = "es-AR"): BriefKpi[] {
  const menciones = obj(metrics.menciones);
  const comp = obj(metrics.comparacion);
  const day = obj(obj(metrics.sobre_candidato).dia);
  const reliable = comp.fiable === true;
  const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString(locale));
  const balance = num(day.balance);
  const balBase = num(comp.balance_7d);
  const balDay = num(comp.balance_dia);
  let balHint: string | null = null;
  if (reliable && balBase != null && balDay != null) {
    const d = balDay - balBase;
    balHint = `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)} pts vs. 7 días`;
  }
  const crit = num(day.criticas);
  const critPct = reliable ? num(comp.criticas_var_pct) : null;
  const fav = num(day.a_favor);
  const favBase = num(comp.a_favor_promedio_7d);
  const favDay = num(comp.a_favor_dia);
  const favPct = reliable && favBase && favBase > 0 && favDay != null ? Math.round(((favDay - favBase) / favBase) * 100) : null;
  return [
    {
      key: "menciones",
      label: "Menciones",
      value: fmt(num(menciones.dia)),
      hint: reliable ? signedPct(num(comp.var_vs_promedio_pct)) : null,
      tone: "default",
    },
    {
      key: "criticas",
      label: "Críticas",
      value: fmt(crit),
      hint: signedPct(critPct),
      tone: critPct != null && critPct >= 15 ? "negative" : "default",
    },
    {
      key: "a_favor",
      label: "A favor",
      value: fmt(fav),
      hint: signedPct(favPct),
      tone: favPct != null && favPct >= 15 ? "positive" : "default",
    },
    {
      key: "balance",
      label: "Balance",
      value: balance == null ? "—" : `${balance > 0 ? "+" : balance < 0 ? "−" : ""}${Math.abs(balance)}`,
      hint: balHint,
      tone: balance == null ? "default" : balance < -5 ? "negative" : balance > 5 ? "positive" : "default",
    },
  ];
}

export const PRIORITY_LABEL: Record<string, string> = { alta: "Prioridad alta", media: "Prioridad media", baja: "Prioridad baja" };
export const PRIORITY_BADGE: Record<string, string> = {
  alta: "bg-rose-50 text-rose-700 ring-rose-200",
  media: "bg-amber-50 text-amber-800 ring-amber-200",
  baja: "bg-slate-50 text-slate-600 ring-slate-200",
};
export const AREA_LABEL: Record<string, string> = {
  comunicacion: "Comunicación",
  vocerias: "Vocerías",
  territorio: "Territorio",
  digital: "Digital",
  monitoreo: "Monitoreo",
};

export function sourcesFor(ids: string[], all: DailyBriefSource[]): DailyBriefSource[] {
  const by = new Map(all.map((s) => [s.id, s]));
  return ids.map((id) => by.get(id)).filter((s): s is DailyBriefSource => !!s);
}
