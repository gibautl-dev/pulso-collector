/**
 * Panel "Gasto" (solo equipo de Active). Lógica pura: no lee la base.
 *
 * Reglas:
 * - "registrado": costo que la app guardó por llamada (cost_usd del modelo).
 * - "EST": estimado con una tarifa medida (p. ej. clasificador, que no guarda costo por fila).
 * - "CALC": cuenta sobre datos reales (posts de X × precio de lista; proyección del mes).
 * - Infraestructura: solo lo que se pudo leer de Render/Supabase; si no, "no disponible".
 */

export type SpendBasis = "registrado" | "sin_costo";

export interface SpendRow {
  day: string; // YYYY-MM-DD (Buenos Aires)
  feature: string;
  candidate_id: string | null;
  items: number;
  calls: number;
  cost_usd: number | null;
  calls_without_cost: number;
  basis: SpendBasis;
}

export interface XUsageRow {
  quota_date: string; // YYYY-MM-DD (UTC: el cupo de X se reinicia a las 21:00 de Buenos Aires)
  candidate_id: string;
  posts: number;
  requests: number;
  runs: number;
  items_new: number;
}

export interface XCap {
  candidate_id: string;
  enabled: boolean;
  max_posts_per_day: number;
  max_requests_per_day: number;
}

export interface SpendCaps {
  simulator?: { enabled: boolean; daily_budget_usd: number; max_request_usd: number } | null;
  crisis?: { candidate_id: string; enabled: boolean; max_cost_usd: number }[];
  ai_visibility?: { candidate_id: string; enabled: boolean; model: string; web_search: boolean; prompts: number }[];
  /** Tope diario total de En la IA (deploy/ai_visibility_cap.sql). */
  ai_visibility_budget?: { daily_budget_usd: number; last_reached_on: string | null; updated_at: string } | null;
}

export interface SpendReport {
  generated_at: string;
  from: string;
  to: string;
  timezone: string;
  rows: SpendRow[];
  x_usage: XUsageRow[];
  x_caps: XCap[];
  caps: SpendCaps;
  candidates: { id: string; slug: string; name: string }[];
}

/** X API: lectura de posts, precio oficial (docs.x.com/x-api/getting-started/pricing, ver README). */
export const X_USD_PER_POST = 0.005;
/** X API: cada usuario incluido en la expansión author_id. El recolector no lo cuenta. */
export const X_USD_PER_USER = 0.01;

/**
 * Clasificador de menciones: no guarda costo por fila. EST medido en los logs del
 * cron del 25/11/2026: 18 corridas, 71 menciones, 43.737 tokens de entrada y 3.801
 * de salida con gpt-6-luna (USD 0,10 / 0,50 por millón) ⇒ USD 0,0063 / 71.
 */
export const CLASSIFIER_EST_USD_PER_MENTION = 0.0000884;

export interface FeatureInfo {
  label: string;
  /** Tope diario en USD si existe uno que corte de verdad (null = no hay tope diario). */
  dailyCapUsd?: number | null;
  capText: string;
  info: string;
}

export const FEATURES: Record<string, FeatureInfo> = {
  ia_visibilidad: {
    label: "En la IA",
    dailyCapUsd: null,
    capText: "Sin tope diario en la base",
    info: "Preguntas a ChatGPT con búsqueda web sobre el candidato (ai_answers). Costo guardado por respuesta, con tokens y búsquedas. El tope diario es el total de todos los candidatos, día de Buenos Aires.",
  },
  equipo_accion: {
    label: "Equipo de acción",
    capText: "USD 0,50 por corrida y candidato",
    info: "Agentes de crisis (crisis_agent_runs): costo guardado por paso del agente. La cantidad es de informes escritos.",
  },
  resumen_diario: {
    label: "Resumen del día",
    dailyCapUsd: 0.2,
    capText: "USD 0,20 por día (1 corrida)",
    info: "Un resumen por candidato y día (daily_briefs). Tope por resumen USD 0,05 y por corrida USD 0,20.",
  },
  contradicciones: {
    label: "Contradicciones",
    capText: "USD 0,06 por corrida",
    info: "Revisión de contradicciones (inconsistency_scans). La tabla guarda solo el último escaneo por candidato, así que el histórico queda por debajo del real.",
  },
  simulador: {
    label: "Simulador de respuesta",
    capText: "USD 1 por día",
    info: "Simulaciones de borradores (response_simulations). Tope diario leído de la configuración.",
  },
  asistente: {
    label: "Preguntale a Pulso",
    dailyCapUsd: 1,
    capText: "USD 1 por día",
    info: "Preguntas al asistente (assistant_questions). El tope diario lo aplica la base.",
  },
  temas_clasificacion: {
    label: "Temas a medida · clasificación",
    capText: "Sin tope diario propio",
    info: "Clasificación de menciones contra temas a medida (custom_topic_classifications).",
  },
  temas_resumen: {
    label: "Temas a medida · resúmenes",
    capText: "Sin tope diario propio",
    info: "Resúmenes de temas a medida (custom_topic_summaries).",
  },
  sugerencias_rivales: {
    label: "Sugerencias de rivales",
    capText: "A pedido",
    info: "Sugerencias de rivales pedidas desde el panel (rival_suggestion_runs).",
  },
  clasificador: {
    label: "Clasificador de menciones",
    capText: "Hasta 30 menciones por corrida",
    info: "Tono, tema y relevancia de cada mención. No guarda costo por fila: se estima con lo medido en los logs del cron (EST).",
  },
  anuncios_clasificacion: {
    label: "Clasificación de anuncios",
    capText: "USD 1 por corrida",
    info: "Postura de los anuncios de Meta (meta_ad_classifications). No guarda costo por fila y no hay medición: se muestra solo la cantidad.",
  },
};

export function featureLabel(key: string): string {
  return FEATURES[key]?.label ?? key;
}

/** Infra fija. Solo datos leídos de las APIs de Render y Supabase el 25/11/2026. */
export interface InfraItem {
  name: string;
  plan: string;
  monthlyUsd: number | null;
  basis: string;
  note: string;
}

export const INFRA: InfraItem[] = [
  {
    name: "Render · web (pulso-web)",
    plan: "Starter",
    monthlyUsd: 7,
    basis: "precio de lista",
    note: "Plan leído de Render. USD 7/mes es el precio publicado del plan Starter (render.com/pricing, 04/11/2026), no una factura.",
  },
  {
    name: "Render · recolector (pulso-rss)",
    plan: "Starter (cron cada 20 min)",
    monthlyUsd: null,
    basis: "no disponible",
    note: "Se cobra por segundo de ejecución. Render no expone la facturación por API: ver Billing en el panel de Render.",
  },
  {
    name: "Supabase (pulso-demo)",
    plan: "Free",
    monthlyUsd: 0,
    basis: "plan leído",
    note: "Organización en plan Free según la API de Supabase.",
  },
  {
    name: "Google Cloud (BigQuery, proyecto Pulso)",
    plan: "Sandbox sin facturación",
    monthlyUsd: 0,
    basis: "sin facturación",
    note: "Sandbox gratuito sin cuenta de facturación: no puede generar cargos.",
  },
];

export interface FeatureTotal {
  feature: string;
  label: string;
  items: number;
  usd: number;
  todayUsd: number;
  basis: "registrado" | "EST" | "sin dato";
  capText: string;
  dailyCapUsd: number | null;
  info: string;
  callsWithoutCost: number;
}

export interface DayPoint {
  day: string;
  recorded: number;
  estimated: number;
}

export interface CandidateTotal {
  candidate_id: string | null;
  name: string;
  recorded: number;
  estimated: number;
  x: number;
}

export interface XDay {
  date: string;
  posts: number;
  requests: number;
  maxPosts: number;
  maxRequests: number;
  usd: number;
  byCandidate: { candidate_id: string; name: string; posts: number; requests: number; maxPosts: number; maxRequests: number }[];
}

export interface SpendSummary {
  monthLabel: string;
  daysElapsed: number;
  daysInMonth: number;
  recordedUsd: number;
  estimatedUsd: number; // EST clasificador
  xUsd: number; // CALC posts × precio
  aiTotalUsd: number;
  todayUsd: number;
  projectionUsd: number; // CALC
  dailyRateUsd: number; // CALC, promedio últimos 7 días completos
  infraMonthlyUsd: number; // solo los conocidos
  features: FeatureTotal[];
  days: DayPoint[];
  candidates: CandidateTotal[];
  xDays: XDay[];
  xPostsTotal: number;
  xRequestsTotal: number;
  simulatorCapUsd: number | null;
  aiVisibilityCapUsd: number | null;
  aiVisibilityCapReachedOn: string | null;
}

/** Valida el tope de En la IA que carga el equipo (USD, 0 a 50, hasta 2 decimales). */
export function parseDailyCap(raw: string): number | null {
  const n = Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 50) return null;
  return Math.round(n * 100) / 100;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function daysInMonth(ymd: string): number {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Primer día del mes y "hoy" en Buenos Aires para un instante dado. */
export function monthRange(now: Date, timeZone = "America/Argentina/Buenos_Aires"): { from: string; to: string } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/** Mes en curso hasta el momento de los datos (fixture: exportación; en vivo: ahora). */
export function monthToDate(dataTimestamp: string | null): { from: string; to: string } {
  return monthRange(dataTimestamp ? new Date(dataTimestamp) : new Date());
}

export function rowCost(row: SpendRow): number {
  if (row.basis === "registrado") return Number(row.cost_usd ?? 0);
  if (row.feature === "clasificador") return row.items * CLASSIFIER_EST_USD_PER_MENTION;
  return 0;
}

function rowIsEstimate(row: SpendRow): boolean {
  return row.basis !== "registrado";
}

export function summarizeSpend(report: SpendReport): SpendSummary {
  const today = report.to;
  const names = new Map(report.candidates.map((c) => [c.id, c.name]));
  const days = eachDay(report.from, report.to);

  const feat = new Map<string, FeatureTotal>();
  const byDay = new Map<string, DayPoint>(days.map((d) => [d, { day: d, recorded: 0, estimated: 0 }]));
  const byCand = new Map<string | null, CandidateTotal>();
  const cand = (id: string | null) => {
    let c = byCand.get(id);
    if (!c) {
      c = { candidate_id: id, name: id ? names.get(id) ?? "Otro candidato" : "Sin candidato", recorded: 0, estimated: 0, x: 0 };
      byCand.set(id, c);
    }
    return c;
  };

  // Todas las funciones conocidas aparecen, aunque estén en cero.
  for (const [key, info] of Object.entries(FEATURES)) {
    feat.set(key, {
      feature: key,
      label: info.label,
      items: 0,
      usd: 0,
      todayUsd: 0,
      basis: key === "clasificador" ? "EST" : key === "anuncios_clasificacion" ? "sin dato" : "registrado",
      capText: info.capText,
      dailyCapUsd: info.dailyCapUsd ?? null,
      info: info.info,
      callsWithoutCost: 0,
    });
  }
  const sim = report.caps?.simulator;
  if (sim) {
    const f = feat.get("simulador")!;
    f.dailyCapUsd = Number(sim.daily_budget_usd);
    f.capText = sim.enabled ? `USD ${fmtNum(Number(sim.daily_budget_usd), 2)} por día` : "Apagado";
  }

  const aiBudget = report.caps?.ai_visibility_budget;
  if (aiBudget) {
    const f = feat.get("ia_visibilidad")!;
    f.dailyCapUsd = Number(aiBudget.daily_budget_usd);
    f.capText = `USD ${fmtNum(Number(aiBudget.daily_budget_usd), 2)} por día (total)`;
  }

  for (const row of report.rows) {
    const cost = rowCost(row);
    const est = rowIsEstimate(row);
    const f = feat.get(row.feature) ?? {
      feature: row.feature, label: row.feature, items: 0, usd: 0, todayUsd: 0,
      basis: est ? "EST" : "registrado", capText: "—", dailyCapUsd: null, info: "", callsWithoutCost: 0,
    } as FeatureTotal;
    f.items += row.items;
    f.usd += cost;
    if (row.basis === "registrado") f.callsWithoutCost += row.calls_without_cost;
    if (row.day === today) f.todayUsd += cost;
    feat.set(row.feature, f);
    const d = byDay.get(row.day);
    if (d) {
      if (est) d.estimated += cost;
      else d.recorded += cost;
    }
    const c = cand(row.candidate_id);
    if (est) c.estimated += cost;
    else c.recorded += cost;
  }

  // X: cupo diario por candidato (día UTC).
  const caps = new Map(report.x_caps.map((c) => [c.candidate_id, c]));
  const xByDate = new Map<string, XDay>();
  for (const x of report.x_usage) {
    const cap = caps.get(x.candidate_id);
    let day = xByDate.get(x.quota_date);
    if (!day) {
      day = { date: x.quota_date, posts: 0, requests: 0, maxPosts: 0, maxRequests: 0, usd: 0, byCandidate: [] };
      xByDate.set(x.quota_date, day);
    }
    const maxPosts = cap?.max_posts_per_day ?? 300;
    const maxRequests = cap?.max_requests_per_day ?? 10;
    day.posts += x.posts;
    day.requests += x.requests;
    day.maxPosts += maxPosts;
    day.maxRequests += maxRequests;
    day.usd += x.posts * X_USD_PER_POST;
    day.byCandidate.push({
      candidate_id: x.candidate_id, name: names.get(x.candidate_id) ?? "Otro candidato",
      posts: x.posts, requests: x.requests, maxPosts, maxRequests,
    });
    cand(x.candidate_id).x += x.posts * X_USD_PER_POST;
  }
  const xDays = [...xByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const xPostsTotal = xDays.reduce((s, d) => s + d.posts, 0);
  const xRequestsTotal = xDays.reduce((s, d) => s + d.requests, 0);
  const xUsd = xPostsTotal * X_USD_PER_POST;

  const features = [...feat.values()]
    .map((f) => ({ ...f, usd: round6(f.usd), todayUsd: round6(f.todayUsd) }))
    .sort((a, b) => b.usd - a.usd || a.label.localeCompare(b.label, "es"));
  const recordedUsd = round6(features.filter((f) => f.basis === "registrado").reduce((s, f) => s + f.usd, 0));
  const estimatedUsd = round6(features.filter((f) => f.basis === "EST").reduce((s, f) => s + f.usd, 0));
  const aiTotalUsd = round6(recordedUsd + estimatedUsd);
  const todayUsd = round6(features.reduce((s, f) => s + f.todayUsd, 0));
  const dim = daysInMonth(report.to);
  const daysElapsed = days.length;
  // CALC: lo gastado + promedio de los últimos 7 días completos × días que faltan.
  const full = [...byDay.values()].filter((d) => d.day < today).slice(-7);
  const fullDays = new Set(full.map((d) => d.day));
  const aiRecent = full.reduce((s, d) => s + d.recorded + d.estimated, 0);
  // X cuenta por día UTC; se toma el mismo número de días más recientes cerrados.
  const xRecent = xDays.filter((d) => d.date < today).slice(-Math.max(1, fullDays.size)).reduce((s, d) => s + d.usd, 0);
  const remaining = Math.max(0, dim - daysElapsed);
  const dailyRate = full.length ? (aiRecent + xRecent) / full.length : 0;
  const projectionUsd = round6(aiTotalUsd + xUsd + dailyRate * remaining);
  const [, mm] = report.to.split("-").map(Number);

  return {
    monthLabel: `${MONTHS[mm - 1]} ${report.to.slice(0, 4)}`,
    daysElapsed,
    daysInMonth: dim,
    recordedUsd,
    estimatedUsd,
    xUsd: round6(xUsd),
    aiTotalUsd,
    todayUsd,
    projectionUsd,
    dailyRateUsd: round6(dailyRate),
    infraMonthlyUsd: INFRA.reduce((s, i) => s + (i.monthlyUsd ?? 0), 0),
    features,
    days: [...byDay.values()].map((d) => ({ ...d, recorded: round6(d.recorded), estimated: round6(d.estimated) })),
    candidates: [...byCand.values()]
      .map((c) => ({ ...c, recorded: round6(c.recorded), estimated: round6(c.estimated), x: round6(c.x) }))
      .sort((a, b) => b.recorded + b.estimated + b.x - (a.recorded + a.estimated + a.x)),
    xDays,
    xPostsTotal,
    xRequestsTotal,
    simulatorCapUsd: sim ? Number(sim.daily_budget_usd) : null,
    aiVisibilityCapUsd: aiBudget ? Number(aiBudget.daily_budget_usd) : null,
    aiVisibilityCapReachedOn: aiBudget?.last_reached_on ?? null,
  };
}

export function fmtNum(n: number, decimals: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** USD con 2 decimales; montos chicos con 4 para que no queden en "0,00". */
export function fmtUsd(n: number): string {
  if (n === 0) return "USD 0";
  if (Math.abs(n) < 0.01) return `USD ${fmtNum(n, 4)}`;
  return `USD ${fmtNum(n, 2)}`;
}
