import type { AiAnswer, AiCitation, AiDayScore, AiDomainRank } from "@/lib/types";

export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

export function asCitations(value: unknown): AiCitation[] {
  if (!Array.isArray(value)) return [];
  const out: AiCitation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.url !== "string" || !row.url) continue;
    out.push({
      url: row.url,
      title: typeof row.title === "string" ? row.title : null,
      domain: typeof row.domain === "string" ? row.domain : null,
      source: typeof row.source === "string" ? row.source : null,
      kept: row.kept !== false,
      filter_reason: typeof row.filter_reason === "string" ? row.filter_reason : null,
    });
  }
  return out;
}

export function keptCitations(answer: AiAnswer): AiCitation[] {
  return (answer.citations ?? []).filter((c) => c.kept && c.url);
}

export function dailyScores(answers: AiAnswer[]): AiDayScore[] {
  const byDay = new Map<string, number[]>();
  for (const answer of answers) {
    if (typeof answer.balance !== "number") continue;
    const day = answer.asked_on;
    const list = byDay.get(day) ?? [];
    list.push(answer.balance);
    byDay.set(day, list);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, scores]) => ({
      day,
      balance: Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) / 10,
      answers: scores.length,
    }));
}

export function latestDay(answers: AiAnswer[]): string | null {
  const days = dailyScores(answers);
  return days.at(-1)?.day ?? null;
}

export function answersOnDay(answers: AiAnswer[], day: string): AiAnswer[] {
  return answers
    .filter((a) => a.asked_on === day)
    .slice()
    .sort((a, b) => a.prompt_key.localeCompare(b.prompt_key, "es"));
}

export function domainRanking(answers: AiAnswer[]): AiDomainRank[] {
  const counts = new Map<string, number>();
  for (const answer of answers) {
    for (const citation of keptCitations(answer)) {
      const domain = citation.domain || hostOf(citation.url);
      if (!domain) continue;
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain, "es"));
}

export function formatBalance(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

export function balanceTone(value: number | null | undefined): "positive" | "negative" | "default" {
  if (typeof value !== "number") return "default";
  if (value > 5) return "positive";
  if (value < -5) return "negative";
  return "default";
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
