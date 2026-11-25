import { CRISIS_TRIGGER_LABEL } from "./labels";
import { formatSharePct, shareOfVoice } from "./rival-ads";
import type { CrisisAlert } from "./types";

export const PENDING_ALERT_STATUSES = new Set(["new", "in_review"]);

const RISK_RANK: Record<string, number> = {
  bajo: 1,
  medio: 2,
  medio_alto: 3,
  alto: 4,
};

export function shareDeltaPp(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return Math.round((current - previous) * 100);
}

export function formatShareDeltaPp(pp: number | null, days: number): string {
  if (pp == null) return "sin base anterior";
  const window = days === 7 ? "semana anterior" : `período anterior de ${days} días`;
  if (pp === 0) return `sin cambio vs ${window}`;
  const sign = pp > 0 ? "+" : "";
  return `${sign}${pp} pp vs ${window}`;
}

export function pickMainRival<T extends { mentions: number }>(rivals: T[]): T | null {
  if (rivals.length === 0) return null;
  return rivals.reduce((best, row) => (row.mentions > best.mentions ? row : best));
}

export type ComparisonSpotlightKind = "empty" | "no_mentions" | "ready";

export interface ComparisonSpotlight {
  kind: ComparisonSpotlightKind;
  candidateName: string;
  rivalName: string | null;
  candidateShare: number | null;
  rivalShare: number | null;
  candidateMentions: number;
  rivalMentions: number;
  headline: string;
  deltaPp: number | null;
  deltaLabel: string;
}

/**
 * Participación del candidato frente a su rival principal (el de más
 * menciones de terceros en la ventana). Los % son sobre la suma de
 * candidato + todos los rivales asignados, igual que en Rivales y anuncios.
 */
export function comparisonSpotlight(opts: {
  candidate: { id: string; name: string; slug: string };
  rivals: { id: string; name: string; slug: string; mentions: number; previousMentions: number }[];
  candidateMentions: number;
  candidatePreviousMentions: number;
  days: number;
}): ComparisonSpotlight {
  const { candidate, rivals, days } = opts;
  if (rivals.length === 0) {
    return {
      kind: "empty",
      candidateName: candidate.name,
      rivalName: null,
      candidateShare: null,
      rivalShare: null,
      candidateMentions: opts.candidateMentions,
      rivalMentions: 0,
      headline: "—",
      deltaPp: null,
      deltaLabel: "sin base anterior",
    };
  }
  const current = shareOfVoice([
    { id: candidate.id, name: candidate.name, slug: candidate.slug, self: true, mentions: opts.candidateMentions },
    ...rivals.map((r) => ({ id: r.id, name: r.name, slug: r.slug, self: false, mentions: r.mentions })),
  ]);
  const previous = shareOfVoice([
    { id: candidate.id, name: candidate.name, slug: candidate.slug, self: true, mentions: opts.candidatePreviousMentions },
    ...rivals.map((r) => ({ id: r.id, name: r.name, slug: r.slug, self: false, mentions: r.previousMentions })),
  ]);
  const main = pickMainRival(rivals);
  const selfRow = current.find((r) => r.self);
  const rivalRow = main ? current.find((r) => r.id === main.id) : undefined;
  const prevSelf = previous.find((r) => r.self);
  const deltaPp = shareDeltaPp(selfRow?.share ?? null, prevSelf?.share ?? null);
  const total = current.reduce((s, r) => s + r.mentions, 0);
  const kind: ComparisonSpotlightKind = total <= 0 ? "no_mentions" : "ready";
  const headline =
    kind === "ready" ? `${formatSharePct(selfRow?.share ?? null)} vs ${formatSharePct(rivalRow?.share ?? null)}` : "—";
  return {
    kind,
    candidateName: candidate.name,
    rivalName: main?.name ?? null,
    candidateShare: selfRow?.share ?? null,
    rivalShare: rivalRow?.share ?? null,
    candidateMentions: opts.candidateMentions,
    rivalMentions: main?.mentions ?? 0,
    headline,
    deltaPp,
    deltaLabel: formatShareDeltaPp(deltaPp, days),
  };
}

export function pendingAlerts<T extends { status: string }>(alerts: T[]): T[] {
  return alerts.filter((a) => PENDING_ALERT_STATUSES.has(a.status));
}

export function pickHighestRiskAlert<T extends { status: string; severity: string; last_detected_at: string }>(
  alerts: T[],
): T | null {
  const open = pendingAlerts(alerts);
  if (open.length === 0) return null;
  return [...open].sort((a, b) => {
    const byRisk = (RISK_RANK[b.severity] ?? 0) - (RISK_RANK[a.severity] ?? 0);
    if (byRisk !== 0) return byRisk;
    return b.last_detected_at.localeCompare(a.last_detected_at);
  })[0];
}

export function alertHeadline(alert: {
  cluster_label?: string | null;
  trigger_type: string;
  latest_brief?: { title?: string | null } | null;
}): string {
  const raw =
    (alert.cluster_label ?? "").trim() ||
    (alert.latest_brief?.title ?? "").trim() ||
    CRISIS_TRIGGER_LABEL[alert.trigger_type] ||
    alert.trigger_type;
  if (raw.length <= 90) return raw;
  const cut = raw.slice(0, 89);
  const atWord = cut.replace(/\s+\S*$/, "");
  return `${(atWord.length >= 50 ? atWord : cut).trimEnd()}…`;
}

export function pickTopCustomTopic<T extends { stats: { volume: number; spike: boolean } }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => b.stats.volume - a.stats.volume || Number(b.stats.spike) - Number(a.stats.spike))[0];
}
