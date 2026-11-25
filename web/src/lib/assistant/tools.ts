/**
 * Herramientas del asistente de datos. Sin I/O: reciben datos ya leídos con la
 * sesión del usuario (RLS) y devuelven cifras calculadas en código.
 *
 * El modelo nunca escribe SQL ni ve la base: elige una herramienta y
 * parámetros acotados (enums, rangos, términos de texto limpios). Las cifras
 * de la respuesta salen de acá; el modelo solo redacta y cita menciones por
 * su referencia (m1, m2…), que el servidor valida contra este registro.
 *
 * Reglas de cobertura (las mismas del tablero y de Rivales):
 *  - las variaciones comparan con el período anterior de igual longitud usando
 *    solo fuentes activas durante los dos períodos (coveredPeriodChange);
 *  - entre candidatos, solo el período y las fuentes que se miden para ambos
 *    (commonWindow);
 *  - si una fuente empezó a medirse dentro del período pedido, se avisa.
 */

import { bucketFor } from "@/lib/analytics";
import {
  commonWindow,
  countThirdPartyInWindow,
  mentionsInWindow,
  sourcesCoveredSince,
  type CoverageStarts,
} from "@/lib/comparison-window";
import { sourceLabel, TONE_LABEL } from "@/lib/labels";
import { mentionHeadline, cleanMentionText } from "@/lib/mention-excerpt";
import { aggregateSpend, formatSpendAggregate, isAdActive, adOverlapsPeriod, adSnippet, rankPages, adStance } from "@/lib/meta-ads";
import { dayKey, formatDate, formatDateTime, startOfDay, type Clock } from "@/lib/time";
import type { Candidate, DailyBrief, GoogleAd, Mention, MetaAd, RivalLevel, Topic } from "@/lib/types";
import { cleanTerms, decodeEntities, normalize, termMatcher } from "./text";

const DAY_MS = 86400000;
export const MAX_PERIOD_DAYS = 30;
export const MAX_LIST = 8;

export const TONE_FILTERS = ["todas", "a_favor", "en_contra", "neutral"] as const;
export type ToneFilter = (typeof TONE_FILTERS)[number];
export const AUTHORSHIP = ["terceros", "propias", "todas"] as const;
export type Authorship = (typeof AUTHORSHIP)[number];
export const SOURCE_FILTERS = ["todas", "google_news", "rss_media", "google_alerts", "youtube", "x"] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number];

/** Mención que el modelo puede citar. `ref` es estable dentro de una pregunta. */
export interface CitedMention {
  ref: string;
  id: string;
  candidate_slug: string;
  url: string;
  title: string;
  excerpt: string;
  outlet: string | null;
  author: string | null;
  source: string;
  published_at: string;
  tone: string | null;
  about_candidate: boolean;
  own: boolean;
}

/** Dato calculado en código que la UI muestra debajo de la respuesta. */
export interface Fact {
  label: string;
  value: string;
  hint?: string | null;
  tone?: "positive" | "negative" | "default";
}

export interface ToolOutput {
  /** JSON compacto para el modelo. */
  result: Record<string, unknown>;
  facts: Fact[];
  /** Nota de cobertura en lenguaje de cliente (período, fuentes). */
  notes: string[];
}

/** Registro de menciones citables de una pregunta (m1, m2…). */
export class Evidence {
  private byId = new Map<string, CitedMention>();
  private byRef = new Map<string, CitedMention>();

  add(m: Mention, candidate: Candidate): CitedMention {
    const existing = this.byId.get(m.id);
    if (existing) return existing;
    const ref = `m${this.byId.size + 1}`;
    const cited: CitedMention = {
      ref,
      id: m.id,
      candidate_slug: candidate.slug,
      url: m.url,
      title: decodeEntities(mentionHeadline(m, { maxLength: 140 })),
      excerpt: decodeEntities(cleanMentionText(m.content ?? "", { maxLength: 240 })),
      outlet: m.outlet ?? null,
      author: m.author_handle ? `@${m.author_handle}` : (m.author ?? null),
      source: m.source,
      published_at: m.published_at,
      tone: m.tone,
      about_candidate: m.target === "candidate",
      own: m.account_relation === "own",
    };
    this.byId.set(m.id, cited);
    this.byRef.set(ref, cited);
    return cited;
  }

  get(ref: string): CitedMention | undefined {
    return this.byRef.get(ref);
  }

  all(): CitedMention[] {
    return [...this.byRef.values()];
  }

  get size(): number {
    return this.byRef.size;
  }
}

// ---------------------------------------------------------------- ventanas

export interface Period {
  start: Date;
  end: Date;
  days: number;
  label: string;
}

function isoDay(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function clampDays(value: unknown, fallback = 7): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(MAX_PERIOD_DAYS, n);
}

/**
 * Período pedido: `desde`/`hasta` (días en la zona del candidato, inclusive)
 * o los últimos `periodo_dias`. Nunca más de 30 días ni después de `now`.
 */
export function resolvePeriod(args: { periodo_dias?: unknown; desde?: unknown; hasta?: unknown }, now: Date, clock: Clock): Period {
  const from = isoDay(args.desde);
  const to = isoDay(args.hasta) ?? (from ? isoDay(args.desde) : null);
  if (from && to) {
    let start = new Date(startOfDay(from, clock.timeZone));
    const next = new Date(new Date(startOfDay(to, clock.timeZone)).getTime() + DAY_MS + 3 * 3600000);
    let end = new Date(startOfDay(dayKey(next, clock.timeZone), clock.timeZone));
    if (end > now) end = now;
    if (start >= end) start = new Date(end.getTime() - DAY_MS);
    if (end.getTime() - start.getTime() > MAX_PERIOD_DAYS * DAY_MS) start = new Date(end.getTime() - MAX_PERIOD_DAYS * DAY_MS);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
    const label =
      from === to
        ? `el ${formatDate(start.toISOString(), clock)}`
        : `del ${formatDate(start.toISOString(), clock)} al ${formatDate(new Date(end.getTime() - 1).toISOString(), clock)}`;
    return { start, end, days, label };
  }
  const days = clampDays(args.periodo_dias);
  return {
    start: new Date(now.getTime() - days * DAY_MS),
    end: now,
    days,
    label: days === 1 ? "las últimas 24 horas" : `los últimos ${days} días`,
  };
}

/** Avisos de fuentes que empezaron a medirse dentro del período (una sola frase si son varias). */
export function coverageNotes(starts: CoverageStarts, period: Period, clock: Clock, source: SourceFilter = "todas"): string[] {
  const late: [string, string][] = [];
  for (const [src, start] of Object.entries(starts)) {
    if (source !== "todas" && src !== source) continue;
    const t = new Date(start).getTime();
    if (t > period.start.getTime() && t < period.end.getTime()) late.push([src, start]);
  }
  if (!late.length) return [];
  late.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const names = late.map(([src]) => sourceLabel(src));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  const when = `${formatDateTime(late[0][1], clock)} (${clock.tzLabel})`;
  return [
    names.length === 1
      ? `${list} se mide desde el ${when}: antes de eso no hay datos de esa fuente.`
      : `${list} se miden desde el ${when}: antes de eso no hay datos de esas fuentes.`,
  ];
}

// ---------------------------------------------------------------- filtros

export interface MentionFilterArgs {
  tema?: unknown;
  texto?: unknown;
  fuente?: unknown;
  tono?: unknown;
  autoria?: unknown;
}

export interface ResolvedFilters {
  topicIds: Set<string> | null;
  topicLabels: string[];
  topicMissing: string | null;
  terms: string[];
  source: SourceFilter;
  tone: ToneFilter;
  authorship: Authorship;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function resolveFilters(args: MentionFilterArgs, topics: Topic[]): ResolvedFilters {
  const tema = typeof args.tema === "string" ? args.tema.trim().slice(0, 60) : "";
  let topicIds: Set<string> | null = null;
  let topicLabels: string[] = [];
  let topicMissing: string | null = null;
  if (tema) {
    const want = normalize(tema);
    const hits = topics.filter((t) => {
      const label = normalize(t.label);
      return label === want || label.includes(want) || (want.length >= 4 && want.includes(label));
    });
    if (hits.length) {
      topicIds = new Set(hits.map((t) => t.id));
      topicLabels = [...new Set(hits.map((t) => t.label))];
    } else {
      topicMissing = tema;
    }
  }
  return {
    topicIds,
    topicLabels,
    topicMissing,
    terms: cleanTerms(Array.isArray(args.texto) ? args.texto : typeof args.texto === "string" ? [args.texto] : []),
    source: pick(args.fuente, SOURCE_FILTERS, "todas"),
    tone: pick(args.tono, TONE_FILTERS, "todas"),
    authorship: pick(args.autoria, AUTHORSHIP, "terceros"),
  };
}

function authorshipOk(m: Mention, a: Authorship): boolean {
  if (a === "terceros") return m.account_relation === "third_party";
  if (a === "propias") return m.account_relation === "own";
  return m.account_relation === "third_party" || m.account_relation === "own";
}

function toneOk(m: Mention, t: ToneFilter): boolean {
  if (t === "todas") return true;
  const b = bucketFor(m);
  if (t === "a_favor") return b === "positivo";
  if (t === "en_contra") return b === "negativo";
  return b === "neutral";
}

/** Filtros sin el período (tema, texto, fuente, tono, autoría). */
export function matchesFilters(m: Mention, f: ResolvedFilters): boolean {
  if (!authorshipOk(m, f.authorship)) return false;
  if (f.source !== "todas" && m.source !== f.source) return false;
  if (f.topicIds && !(m.topic_id && f.topicIds.has(m.topic_id))) return false;
  if (!toneOk(m, f.tone)) return false;
  if (f.terms.length) {
    const match = termMatcher(f.terms)!;
    if (!match(`${m.title ?? ""} ${m.content ?? ""}`)) return false;
  }
  return true;
}

function inPeriod(m: Mention, p: Period): boolean {
  const t = new Date(m.published_at).getTime();
  return t >= p.start.getTime() && t < p.end.getTime();
}

function describeFilters(f: ResolvedFilters): Record<string, unknown> {
  return {
    tema: f.topicLabels.length ? f.topicLabels : null,
    tema_no_encontrado: f.topicMissing,
    texto: f.terms.length ? f.terms : null,
    fuente: f.source,
    tono: f.tone,
    autoria: f.authorship,
  };
}

// ---------------------------------------------------------------- tono

export interface ToneCounts {
  a_favor: number;
  en_contra: number;
  neutral: number;
  sin_clasificar: number;
  /** −100 a +100 sobre menciones clasificadas cuyo objetivo es el candidato. */
  balance: number | null;
}

export function toneCounts(mentions: Mention[]): ToneCounts {
  let fav = 0;
  let neg = 0;
  let neu = 0;
  let pend = 0;
  let aboutClassified = 0;
  for (const m of mentions) {
    const b = bucketFor(m);
    if (b === "positivo") fav++;
    else if (b === "negativo") neg++;
    else if (b === "neutral") neu++;
    else pend++;
    if (m.tone && m.target === "candidate") aboutClassified++;
  }
  const balance = aboutClassified ? Math.round(((fav - neg) / aboutClassified) * 100) : null;
  return { a_favor: fav, en_contra: neg, neutral: neu, sin_clasificar: pend, balance };
}

function signed(n: number | null): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;
}

function balanceToneOf(n: number | null): Fact["tone"] {
  if (n == null) return "default";
  return n > 5 ? "positive" : n < -5 ? "negative" : "default";
}

function fmt(n: number): string {
  return new Intl.NumberFormat("es-AR").format(n);
}

function topN<T>(map: Map<string, T & { count: number }>, n: number): (T & { count: number })[] {
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, n);
}

/** Variación contra el período anterior con fuentes activas en los dos (regla del tablero). */
export function filteredPeriodChange(
  mentions: Mention[],
  f: ResolvedFilters,
  starts: CoverageStarts,
  period: Period,
): { comparable: boolean; percent: number | null; current: number; previous: number; sources: string[] } {
  const len = period.end.getTime() - period.start.getTime();
  const prevStart = period.start.getTime() - len;
  let sources = sourcesCoveredSince(starts, prevStart);
  if (f.source !== "todas") sources = sources.filter((s) => s === f.source);
  if (!sources.length) return { comparable: false, percent: null, current: 0, previous: 0, sources };
  let current = 0;
  let previous = 0;
  for (const m of mentions) {
    if (!sources.includes(m.source) || !matchesFilters(m, f)) continue;
    const t = new Date(m.published_at).getTime();
    if (t >= period.start.getTime() && t < period.end.getTime()) current++;
    else if (t >= prevStart && t < period.start.getTime()) previous++;
  }
  const percent = previous > 0 ? Math.round(((current - previous) / previous) * 100) : current === 0 ? 0 : null;
  return { comparable: true, percent, current, previous, sources };
}

// ---------------------------------------------------------------- herramientas

export interface MentionsData {
  candidate: Candidate;
  mentions: Mention[];
  topics: Topic[];
  coverage: CoverageStarts;
  now: Date;
  clock: Clock;
}

/** contar_menciones: volumen, tono, fuentes, medios, temas, por día y variación. */
export function countMentions(args: MentionFilterArgs & { periodo_dias?: unknown; desde?: unknown; hasta?: unknown }, d: MentionsData): ToolOutput {
  const period = resolvePeriod(args, d.now, d.clock);
  const f = resolveFilters(args, d.topics);
  const rows = d.mentions.filter((m) => inPeriod(m, period) && matchesFilters(m, f));
  const tones = toneCounts(rows);
  const topicLabel = new Map(d.topics.map((t) => [t.id, t.label]));
  const bySource = new Map<string, { fuente: string; count: number }>();
  const byOutlet = new Map<string, { medio: string; count: number }>();
  const byTopic = new Map<string, { tema: string; count: number; en_contra: number }>();
  const byDay = new Map<string, { dia: string; count: number }>();
  for (const m of rows) {
    const s = sourceLabel(m.source);
    bySource.set(s, { fuente: s, count: (bySource.get(s)?.count ?? 0) + 1 });
    const o = (m.outlet || m.author || "").trim();
    if (o) byOutlet.set(o, { medio: o, count: (byOutlet.get(o)?.count ?? 0) + 1 });
    if (m.topic_id) {
      const label = topicLabel.get(m.topic_id) ?? "Tema";
      const cur = byTopic.get(label) ?? { tema: label, count: 0, en_contra: 0 };
      cur.count++;
      if (bucketFor(m) === "negativo") cur.en_contra++;
      byTopic.set(label, cur);
    }
    const k = dayKey(m.published_at, d.clock.timeZone);
    byDay.set(k, { dia: k, count: (byDay.get(k)?.count ?? 0) + 1 });
  }
  const change = filteredPeriodChange(d.mentions, f, d.coverage, period);
  const notes = coverageNotes(d.coverage, period, d.clock, f.source);
  if (change.comparable && change.sources.length < Object.keys(d.coverage).length && f.source === "todas") {
    notes.push(
      `La variación contra el período anterior cuenta solo fuentes con datos en los dos períodos: ${change.sources.map(sourceLabel).join(", ")}.`,
    );
  }
  const peakDay = [...byDay.values()].sort((a, b) => b.count - a.count)[0] ?? null;
  const facts: Fact[] = [
    { label: "Menciones", value: fmt(rows.length), hint: period.label },
    { label: "Balance", value: signed(tones.balance), tone: balanceToneOf(tones.balance), hint: "Sobre −100 a +100" },
    { label: "En contra", value: fmt(tones.en_contra), tone: tones.en_contra > tones.a_favor ? "negative" : "default" },
    { label: "A favor", value: fmt(tones.a_favor), tone: tones.a_favor > tones.en_contra ? "positive" : "default" },
  ];
  if (change.comparable && change.percent != null) {
    facts.push({ label: "Vs período anterior", value: `${change.percent > 0 ? "+" : change.percent < 0 ? "−" : ""}${Math.abs(change.percent)}%` });
  }
  return {
    result: {
      herramienta: "contar_menciones",
      candidato: d.candidate.name,
      periodo: { desde: period.start.toISOString(), hasta: period.end.toISOString(), descripcion: period.label },
      filtros: describeFilters(f),
      total: rows.length,
      tono: tones,
      por_fuente: topN(bySource, 6),
      medios_principales: topN(byOutlet, 5),
      temas_principales: topN(byTopic, 5),
      dia_pico: peakDay,
      por_dia: [...byDay.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
      variacion_vs_periodo_anterior: change.comparable
        ? { porcentaje: change.percent, actual: change.current, anterior: change.previous, fuentes_comparadas: change.sources.map(sourceLabel) }
        : { no_disponible: "No hay un período anterior completo con datos para comparar." },
      avisos_cobertura: notes,
      temas_disponibles: f.topicMissing ? d.topics.map((t) => t.label) : undefined,
    },
    facts,
    notes,
  };
}

const RELEVANCE_RANK: Record<string, number> = { alta: 0, media: 1, baja: 2 };

/** buscar_menciones: menciones concretas para citar (máx. 8, sin duplicados de título). */
export function searchMentions(
  args: MentionFilterArgs & { periodo_dias?: unknown; desde?: unknown; hasta?: unknown; orden?: unknown; limite?: unknown },
  d: MentionsData,
  evidence: Evidence,
): ToolOutput {
  const period = resolvePeriod(args, d.now, d.clock);
  const f = resolveFilters(args, d.topics);
  const order = pick(args.orden, ["relevantes", "recientes"] as const, "relevantes");
  const limit = Math.max(1, Math.min(MAX_LIST, Math.round(Number(args.limite) || 6)));
  const rows = d.mentions.filter((m) => inPeriod(m, period) && matchesFilters(m, f));
  const titleMatch = termMatcher(f.terms);
  const score = (m: Mention) =>
    (RELEVANCE_RANK[m.relevance ?? ""] ?? 3) * 10 + (m.target === "candidate" ? 0 : 5) + (titleMatch && titleMatch(m.title ?? "") ? 0 : 3);
  rows.sort((a, b) =>
    order === "recientes"
      ? b.published_at.localeCompare(a.published_at)
      : score(a) - score(b) || b.published_at.localeCompare(a.published_at),
  );
  // Sin títulos repetidos y, en "relevantes", variedad de fuentes (máx. la mitad de una sola).
  const seen = new Set<string>();
  const perSource = new Map<string, number>();
  const maxPerSource = order === "relevantes" && f.source === "todas" ? Math.max(1, Math.ceil(limit / 2)) : limit;
  const picked: Mention[] = [];
  const skipped: Mention[] = [];
  for (const m of rows) {
    const key = normalize(decodeEntities(mentionHeadline(m, { maxLength: 80 })));
    if (seen.has(key)) continue;
    if ((perSource.get(m.source) ?? 0) >= maxPerSource) {
      skipped.push(m);
      continue;
    }
    seen.add(key);
    perSource.set(m.source, (perSource.get(m.source) ?? 0) + 1);
    picked.push(m);
    if (picked.length >= limit) break;
  }
  for (const m of skipped) {
    if (picked.length >= limit) break;
    const key = normalize(decodeEntities(mentionHeadline(m, { maxLength: 80 })));
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(m);
  }
  const topicLabel = new Map(d.topics.map((t) => [t.id, t.label]));
  const items = picked.map((m) => {
    const c = evidence.add(m, d.candidate);
    return {
      ref: c.ref,
      fecha: formatDateTime(m.published_at, d.clock),
      fuente: sourceLabel(m.source),
      medio: c.outlet,
      autor: c.author,
      propia_del_candidato: c.own,
      titulo: c.title,
      extracto: c.excerpt,
      tono: m.tone ? TONE_LABEL[m.tone] : "sin clasificar",
      sobre: m.target === "candidate" ? "el candidato" : m.target === "other" ? "otro" : "no claro",
      tema: m.topic_id ? (topicLabel.get(m.topic_id) ?? null) : null,
      motivo_del_tono: m.tone_reason ? cleanMentionText(m.tone_reason, { maxLength: 200 }) : null,
    };
  });
  const notes = coverageNotes(d.coverage, period, d.clock, f.source);
  return {
    result: {
      herramienta: "buscar_menciones",
      candidato: d.candidate.name,
      periodo: { descripcion: period.label },
      filtros: describeFilters(f),
      encontradas: rows.length,
      mostradas: items.length,
      menciones: items,
      avisos_cobertura: notes,
      temas_disponibles: f.topicMissing ? d.topics.map((t) => t.label) : undefined,
    },
    facts: [],
    notes,
  };
}

/** temas: ranking de temas del período con tono y variación. */
export function topicsOverview(args: { periodo_dias?: unknown; desde?: unknown; hasta?: unknown }, d: MentionsData): ToolOutput {
  const period = resolvePeriod(args, d.now, d.clock);
  const len = period.end.getTime() - period.start.getTime();
  const prevStart = period.start.getTime() - len;
  const comparableSources = sourcesCoveredSince(d.coverage, prevStart);
  const rows = d.mentions.filter((m) => m.account_relation === "third_party" && inPeriod(m, period));
  const out = d.topics
    .map((t) => {
      const mine = rows.filter((m) => m.topic_id === t.id);
      const tones = toneCounts(mine);
      let cur = 0;
      let prev = 0;
      for (const m of d.mentions) {
        if (m.account_relation !== "third_party" || m.topic_id !== t.id || !comparableSources.includes(m.source)) continue;
        const ts = new Date(m.published_at).getTime();
        if (ts >= period.start.getTime() && ts < period.end.getTime()) cur++;
        else if (ts >= prevStart && ts < period.start.getTime()) prev++;
      }
      const variation = comparableSources.length && prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
      return { tema: t.label, menciones: mine.length, a_favor: tones.a_favor, en_contra: tones.en_contra, balance: tones.balance, variacion_pct: variation };
    })
    .filter((r) => r.menciones > 0)
    .sort((a, b) => b.menciones - a.menciones)
    .slice(0, 10);
  const notes = coverageNotes(d.coverage, period, d.clock);
  const top = out[0];
  const worst = [...out].filter((r) => r.balance != null && r.menciones >= 3).sort((a, b) => (a.balance ?? 0) - (b.balance ?? 0))[0];
  const facts: Fact[] = [];
  if (top) facts.push({ label: "Tema con más menciones", value: top.tema, hint: `${fmt(top.menciones)} menciones` });
  if (worst && (worst.balance ?? 0) < 0) facts.push({ label: "Tema más crítico", value: worst.tema, hint: `Balance ${signed(worst.balance)}`, tone: "negative" });
  return {
    result: {
      herramienta: "temas",
      candidato: d.candidate.name,
      periodo: { descripcion: period.label },
      temas: out,
      variacion_cuenta_solo_fuentes: comparableSources.map(sourceLabel),
      avisos_cobertura: notes,
    },
    facts,
    notes,
  };
}

/** resumen_diario: titulares y puntos de los resúmenes diarios ya generados. */
export function dailyBriefsTool(args: { dias?: unknown }, briefs: DailyBrief[], candidate: Candidate): ToolOutput {
  const n = Math.max(1, Math.min(7, Math.round(Number(args.dias) || 3)));
  const rows = briefs
    .filter((b) => b.status === "ok")
    .slice(0, n)
    .map((b) => ({
      fecha: b.brief_date,
      titular: b.output?.headline ?? b.headline,
      que_cambio: (b.output?.what_changed ?? []).map((p) => p.text).slice(0, 4),
      por_que_importa: (b.output?.why_it_matters ?? []).map((p) => p.text).slice(0, 3),
      que_hacer: (b.output?.what_to_do ?? []).map((a) => `${a.action} (${a.priority})`).slice(0, 3),
    }));
  return {
    result: {
      herramienta: "resumen_diario",
      candidato: candidate.name,
      resumenes: rows,
      sin_resumenes: rows.length === 0 ? "Todavía no hay resúmenes diarios para este candidato." : undefined,
    },
    facts: rows[0] ? [{ label: "Último resumen", value: rows[0].fecha }] : [],
    notes: [],
  };
}

export interface AdsData {
  candidate: Candidate;
  meta: MetaAd[] | null;
  google: GoogleAd[] | null;
  now: Date;
  clock: Clock;
}

/** anuncios: pauta de Meta y Google medida para el candidato. null = no se mide. */
export function adsOverview(args: { periodo_dias?: unknown; desde?: unknown; hasta?: unknown }, d: AdsData): ToolOutput {
  const period = resolvePeriod(args, d.now, d.clock);
  const facts: Fact[] = [];
  const result: Record<string, unknown> = { herramienta: "anuncios", candidato: d.candidate.name, periodo: { descripcion: period.label } };
  if (d.meta == null || d.meta.length === 0) {
    result.meta = { no_medido: "No hay anuncios de Meta medidos para este candidato." };
  } else {
    const inP = d.meta.filter((ad) => adOverlapsPeriod(ad, period.start, period.end));
    const active = d.meta.filter((ad) => isAdActive(ad, d.now));
    const spend = aggregateSpend(inP).map((row) => formatSpendAggregate(row).value);
    const stances = { a_favor: 0, en_contra: 0, neutral_otro: 0, sin_clasificar: 0 };
    for (const ad of inP) {
      const s = adStance(ad);
      if (s) stances[s]++;
      else stances.sin_clasificar++;
    }
    result.meta = {
      anuncios_en_circulacion_en_el_periodo: inP.length,
      activos_hoy: active.length,
      gasto_rango_informado_por_meta: spend,
      postura_respecto_del_candidato: stances,
      paginas_principales: rankPages(inP, d.now, 5).map((p) => ({ pagina: p.pageName, anuncios: p.ads, activos: p.active })),
      textos_de_ejemplo: inP.slice(0, 3).map((ad) => ({ pagina: ad.page_name, texto: adSnippet(ad, 160) })),
    };
    facts.push({ label: "Anuncios de Meta en el período", value: fmt(inP.length), hint: `${fmt(active.length)} activos hoy` });
    if (spend[0]) facts.push({ label: "Gasto informado (Meta)", value: spend[0], hint: "Suma de rangos que publica Meta" });
  }
  if (d.google == null || d.google.length === 0) {
    result.google = { no_medido: "No hay anuncios de Google medidos para este candidato." };
  } else {
    const inP = d.google.filter((ad) => {
      const last = ad.last_served_at ? new Date(ad.last_served_at).getTime() : null;
      const first = ad.first_served_at ? new Date(ad.first_served_at).getTime() : null;
      return (last == null || last >= period.start.getTime()) && (first == null || first <= period.end.getTime());
    });
    const advertisers = new Map<string, { anunciante: string; count: number }>();
    for (const ad of inP) {
      const name = ad.advertiser_name || "Anunciante sin nombre";
      advertisers.set(name, { anunciante: name, count: (advertisers.get(name)?.count ?? 0) + 1 });
    }
    result.google = {
      anuncios_en_circulacion_en_el_periodo: inP.length,
      anunciantes_principales: topN(advertisers, 5),
      aclaracion: "Google no publica el texto de estos anuncios.",
    };
    facts.push({ label: "Anuncios de Google en el período", value: fmt(inP.length) });
  }
  return { result, facts, notes: [] };
}

export interface RivalData {
  rival: Candidate;
  level: RivalLevel;
  mentions: Mention[];
  coverage: CoverageStarts;
}

/** comparar_rivales: participación y balance en la ventana común (período y fuentes de ambos). */
export function compareRivals(args: { periodo_dias?: unknown; rival?: unknown }, d: MentionsData, rivals: RivalData[]): ToolOutput {
  const days = clampDays(args.periodo_dias);
  const wanted = typeof args.rival === "string" ? normalize(args.rival) : "";
  const chosen = wanted ? rivals.filter((r) => normalize(r.rival.name).includes(wanted) || normalize(r.rival.slug).includes(wanted)) : rivals;
  if (rivals.length === 0) {
    return {
      result: { herramienta: "comparar_rivales", sin_rivales: "Este candidato no tiene rivales medidos en Pulso." },
      facts: [],
      notes: [],
    };
  }
  const facts: Fact[] = [];
  const notes: string[] = [];
  const comparisons = (chosen.length ? chosen : rivals).map((r) => {
    const w = commonWindow(
      [
        { id: d.candidate.id, starts: d.coverage },
        { id: r.rival.id, starts: r.coverage },
      ],
      { now: d.now, days },
    );
    if (!w) {
      return { rival: r.rival.name, sin_ventana_comun: "Todavía no hay un período con datos de los dos para comparar." };
    }
    const mine = countThirdPartyInWindow(d.mentions, w);
    const theirs = countThirdPartyInWindow(r.mentions, w);
    const total = mine + theirs;
    const share = total ? Math.round((mine / total) * 100) : null;
    const myTone = toneCounts(mentionsInWindow(d.mentions, w).filter((m) => m.account_relation === "third_party"));
    const theirTone = toneCounts(mentionsInWindow(r.mentions, w).filter((m) => m.account_relation === "third_party"));
    const range = `${formatDateTime(w.start, d.clock)} a ${formatDateTime(w.end, d.clock)} (${d.clock.tzLabel})`;
    const note = `${d.candidate.name} vs ${r.rival.name}: se compara ${w.clipped ? "solo desde que se miden los dos" : "el período completo"}, ${range}, con las fuentes que se miden para ambos (${w.sources.map(sourceLabel).join(", ")}).`;
    notes.push(note);
    if (share != null) facts.push({ label: `Participación vs ${r.rival.name}`, value: `${share}%`, hint: w.clipped ? "Período con datos de los dos" : `Últimos ${days} días` });
    if (myTone.balance != null && theirTone.balance != null) {
      facts.push({
        label: "Balance",
        value: `${signed(myTone.balance)} / ${signed(theirTone.balance)}`,
        hint: `${d.candidate.name.split(" ").slice(-1)[0]} / ${r.rival.name.split(" ").slice(-1)[0]}`,
        tone: balanceToneOf(myTone.balance - theirTone.balance),
      });
    }
    return {
      rival: r.rival.name,
      nivel: r.level,
      ventana: { desde: w.start, hasta: w.end, recortada: w.clipped, fuentes: w.sources.map(sourceLabel) },
      menciones_candidato: mine,
      menciones_rival: theirs,
      participacion_candidato_pct: share,
      balance_candidato: myTone.balance,
      balance_rival: theirTone.balance,
      periodo_anterior_comparable: w.previousComparable,
    };
  });
  return { result: { herramienta: "comparar_rivales", candidato: d.candidate.name, comparaciones: comparisons, avisos_cobertura: notes }, facts, notes };
}
