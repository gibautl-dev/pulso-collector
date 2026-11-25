/** Alertas de contradicciones: lectura defensiva y textos para la UI. Sin I/O. */

import type {
  CrisisStatus,
  InconsistencyAlert,
  InconsistencyKind,
  InconsistencyPiece,
  InconsistencyScan,
  InconsistencySeverity,
} from "@/lib/types";

export const INCONSISTENCY_SECTION_LABEL = "Contradicciones";

export const KIND_LABEL: Record<InconsistencyKind, string> = {
  contradiccion: "Contradicción",
  cambio_de_postura: "Cambio de postura",
  promesa_incumplida: "Promesa incumplida",
  tension: "Posible flanco",
};

export const KIND_HINT: Record<InconsistencyKind, string> = {
  contradiccion: "Lo nuevo dice lo contrario de lo que dijo antes sobre el mismo tema.",
  cambio_de_postura: "No es lo contrario literal, pero cambió de posición o dio marcha atrás.",
  promesa_incumplida: "Una nota dice que no se cumplió algo que había anunciado.",
  tension: "No es una contradicción, pero un rival podría presentarlo así.",
};

export const SEVERITY_LABEL: Record<InconsistencySeverity, string> = { alto: "Alta", medio: "Media", bajo: "Baja" };

export const SEVERITY_BADGE: Record<InconsistencySeverity, string> = {
  alto: "bg-rose-50 text-rose-700 ring-rose-200",
  medio: "bg-amber-50 text-amber-800 ring-amber-200",
  bajo: "bg-slate-100 text-slate-700 ring-slate-200",
};

export const SEVERITY_ACCENT: Record<InconsistencySeverity, string> = {
  alto: "bg-rose-500",
  medio: "bg-amber-400",
  bajo: "bg-slate-300",
};

export const PIECE_LABEL: Record<InconsistencyPiece["kind"], string> = {
  own: "Publicado en su cuenta",
  attributed: "Frase atribuida en medios",
  flag: "Nota que lo señala",
  context: "Nota previa",
};

const SEVERITY_ORDER: Record<string, number> = { alto: 0, medio: 1, bajo: 2 };
const OPEN: CrisisStatus[] = ["new", "in_review"];

export function isOpen(a: Pick<InconsistencyAlert, "status">): boolean {
  return OPEN.includes(a.status);
}

/** Abiertas primero, después por severidad y por fecha de la pieza nueva. */
export function sortAlerts(list: InconsistencyAlert[]): InconsistencyAlert[] {
  return list.slice().sort((a, b) => {
    const open = Number(isOpen(b)) - Number(isOpen(a));
    if (open) return open;
    const sev = (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3);
    if (sev) return sev;
    return (b.later?.published_at ?? "").localeCompare(a.later?.published_at ?? "");
  });
}

const KINDS = new Set(Object.keys(KIND_LABEL));
const SEVERITIES = new Set(Object.keys(SEVERITY_LABEL));

function validUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\//.test(url);
}

function validPiece(p: unknown): p is InconsistencyPiece {
  if (!p || typeof p !== "object") return false;
  const x = p as Record<string, unknown>;
  return typeof x.text === "string" && x.text.trim().length > 0 && validUrl(x.url) && typeof x.published_at === "string";
}

/** Descarta filas incompletas (sin pieza nueva o con enlaces inválidos). */
export function normalizeAlerts(rows: InconsistencyAlert[]): InconsistencyAlert[] {
  return rows
    .filter((a) => KINDS.has(a.kind) && validPiece(a.later))
    .map((a) => ({
      ...a,
      severity: SEVERITIES.has(a.severity) ? a.severity : "bajo",
      earlier: validPiece(a.earlier) ? a.earlier : null,
    }));
}

export function summarize(list: InconsistencyAlert[]) {
  const open = list.filter(isOpen);
  return {
    total: list.length,
    open: open.length,
    high: open.filter((a) => a.severity === "alto").length,
    medium: open.filter((a) => a.severity === "medio").length,
    reviewed: list.length - open.length,
  };
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "11 nov" a partir de la fecha local guardada (o del ISO en la zona del candidato). */
export function pieceDate(p: Pick<InconsistencyPiece, "local_date" | "published_at">, timeZone: string): string {
  let day = p.local_date;
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(p.published_at),
    );
  }
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function daysLabel(days: number | null | undefined): string | null {
  if (days == null) return null;
  if (days === 0) return "el mismo día";
  return `${days} día${days === 1 ? "" : "s"} después`;
}

/** Titular sin el " - Medio" final. */
export function pieceText(p: Pick<InconsistencyPiece, "text" | "outlet">): string {
  let t = (p.text || "").trim();
  if (p.outlet) {
    for (const sep of [" - ", " – ", " | "]) {
      if (t.endsWith(`${sep}${p.outlet}`)) t = t.slice(0, -(sep.length + p.outlet.length)).trim();
    }
  }
  return t;
}

export function shortOutlet(outlet: string | null | undefined): string {
  const base = (outlet || "Medio").split(/\s[-–:|]\s|:\s/)[0].trim();
  return base.length > 30 ? `${base.slice(0, 29)}…` : base;
}

function squash(v: string): string {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Medio a mostrar. Algunos agregadores guardan la sección ("España") en vez del medio;
 * si el nombre no se parece al dominio, mostramos el dominio (abc.es).
 */
export function pieceOutlet(p: Pick<InconsistencyPiece, "outlet" | "url">): string {
  const name = shortOutlet(p.outlet);
  let host = "";
  try {
    host = new URL(p.url).hostname.replace(/^www\./, "");
  } catch {
    return name;
  }
  const label = squash(host.split(".")[0] ?? "");
  const n = squash(name);
  if (!p.outlet || !label || !n) return host || name;
  return n.includes(label) || label.includes(n) || squash(host).includes(n) ? name : host;
}

export function sideTitles(a: Pick<InconsistencyAlert, "origin" | "kind">): { before: string; after: string } {
  if (a.origin === "par") return { before: "Lo que dijo antes", after: "Lo que dijo ahora" };
  if (a.kind === "promesa_incumplida") return { before: "Lo que había anunciado", after: "Lo que señalan" };
  return { before: "Antes", after: "Lo que señalan" };
}

/** Texto de cobertura para el encabezado (sin detalles técnicos). */
export function coverageLine(scan: InconsistencyScan | null, name: string): string | null {
  const n = scan?.stats?.statements_30d;
  if (!scan || n == null) return null;
  const own = scan.stats.own_30d ?? 0;
  const parts = [`${n} declaraci${n === 1 ? "ón" : "ones"} de ${name} en el último mes`];
  if (own > 0) parts.push(`${own} de sus cuentas`);
  return `Comparamos ${parts.join(", ")}.`;
}

export const HOW_IT_WORKS =
  "Pulso junta lo que dijo el candidato (sus cuentas y las frases que le atribuyen los medios) y compara cada frase nueva con lo que dijo antes sobre el mismo tema. También avisa cuando una nota dice que se contradijo o no cumplió algo. Las dos citas son textuales de las notas. Una persona del equipo revisa cada alerta; Pulso no publica ni responde nada.";
