import type { AiAnswer, AiCitation, AiDayScore, AiDomainRank } from "@/lib/types";
import { balanceTone as polarityTone } from "./balance";

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

export { balanceCaption, balanceTone } from "./balance";

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export const MIN_AI_ANSWERS = 3;

export type AnswerPolarity = "positive" | "negative" | "neutral";

export function answerPolarity(balance: number | null | undefined): AnswerPolarity | null {
  if (typeof balance !== "number" || Number.isNaN(balance)) return null;
  const tone = polarityTone(balance);
  if (tone === "positive") return "positive";
  if (tone === "negative") return "negative";
  return "neutral";
}

export interface ClaimExample {
  promptKey: string;
  prompt: string;
  quote: string;
  askedOn: string;
}

export interface ClaimGroup {
  text: string;
  count: number;
  examples: ClaimExample[];
}

export interface QuestionRow {
  promptKey: string;
  prompt: string;
  answers: number;
  averageBalance: number;
  latestBalance: number | null;
  latestDay: string | null;
  positive: number;
  negative: number;
  neutral: number;
}

export interface AiDashboard {
  total: number;
  classified: number;
  overallBalance: number | null;
  latestBalance: number | null;
  latestDay: string | null;
  positive: number;
  negative: number;
  neutral: number;
  positiveShare: number | null;
  negativeShare: number | null;
  neutralShare: number | null;
  days: AiDayScore[];
  trend: number | null;
  trendInsufficient: boolean;
  positives: ClaimGroup[];
  negatives: ClaimGroup[];
  questions: QuestionRow[];
  domains: AiDomainRank[];
  insufficient: boolean;
  insufficientReason: string | null;
}

function normalizeClaim(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(text: string): Set<string> {
  return new Set(normalizeClaim(text).split(" ").filter((t) => t.length > 3));
}

function similarToken(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n < 5) return false;
  const prefix = a.slice(0, 5);
  return b.startsWith(prefix) && Math.abs(a.length - b.length) <= 5;
}

function tokenOverlap(a: Set<string>, b: Set<string>): { inter: number; union: number } {
  const used = new Set<string>();
  let inter = 0;
  for (const x of a) {
    for (const y of b) {
      if (used.has(y)) continue;
      if (similarToken(x, y)) {
        inter++;
        used.add(y);
        break;
      }
    }
  }
  return { inter, union: a.size + b.size - inter };
}

function claimsRelated(a: Set<string>, b: Set<string>): boolean {
  const { inter, union } = tokenOverlap(a, b);
  if (union === 0) return false;
  if (inter / union >= 0.55) return true;
  const smaller = Math.min(a.size, b.size);
  return smaller >= 2 && inter / smaller >= 0.8;
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.?!…])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 20);
}

export function cleanQuote(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\*{1,2}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractQuote(answer: string, claim: string, max = 220): string {
  const tokens = significantTokens(claim);
  const cleanedAnswer = cleanQuote(answer);
  const sentences = sentencesOf(cleanedAnswer);
  let best: { score: number; text: string } | null = null;
  for (const sentence of sentences) {
    const words = significantTokens(sentence);
    let hit = 0;
    for (const t of tokens) if (words.has(t)) hit++;
    if (hit >= 2 && (!best || hit > best.score)) best = { score: hit, text: sentence };
  }
  const raw = cleanQuote(best?.text || cleanedAnswer || claim);
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max).trim()}…`;
}

export function groupClaims(
  items: { text: string; promptKey: string; prompt: string; answer: string; askedOn: string }[],
  limit = 8,
): ClaimGroup[] {
  type Cluster = { key: string; tokens: Set<string>; texts: Map<string, number>; items: typeof items };
  const clusters: Cluster[] = [];
  for (const item of items) {
    const text = item.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = normalizeClaim(text);
    const tokens = significantTokens(text);
    let found = clusters.find((c) => c.key === key || claimsRelated(c.tokens, tokens));
    if (!found) {
      found = { key, tokens: new Set(tokens), texts: new Map(), items: [] };
      clusters.push(found);
    }
    for (const t of tokens) found.tokens.add(t);
    found.texts.set(text, (found.texts.get(text) ?? 0) + 1);
    found.items.push({ ...item, text });
  }
  return clusters
    .map((c) => {
      const canonical = [...c.texts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
      const examples: ClaimExample[] = [];
      const seen = new Set<string>();
      for (const item of c.items) {
        if (seen.has(item.promptKey)) continue;
        seen.add(item.promptKey);
        examples.push({
          promptKey: item.promptKey,
          prompt: item.prompt,
          quote: extractQuote(item.answer, canonical),
          askedOn: item.askedOn,
        });
        if (examples.length >= 3) break;
      }
      return { text: canonical, count: c.items.length, examples };
    })
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "es"))
    .slice(0, limit);
}

export function questionsBreakdown(answers: AiAnswer[]): QuestionRow[] {
  const byKey = new Map<string, AiAnswer[]>();
  for (const answer of answers) {
    const list = byKey.get(answer.prompt_key) ?? [];
    list.push(answer);
    byKey.set(answer.prompt_key, list);
  }
  const rows: QuestionRow[] = [];
  for (const [promptKey, list] of byKey) {
    const scored = list.filter((a) => typeof a.balance === "number");
    const average = scored.length
      ? Math.round((scored.reduce((s, a) => s + (a.balance as number), 0) / scored.length) * 10) / 10
      : 0;
    const latest = list.slice().sort((a, b) => b.asked_on.localeCompare(a.asked_on) || b.asked_at.localeCompare(a.asked_at))[0];
    let positive = 0, negative = 0, neutral = 0;
    for (const a of scored) {
      const p = answerPolarity(a.balance);
      if (p === "positive") positive++;
      else if (p === "negative") negative++;
      else neutral++;
    }
    rows.push({
      promptKey,
      prompt: latest?.prompt ?? promptKey,
      answers: list.length,
      averageBalance: average,
      latestBalance: typeof latest?.balance === "number" ? latest.balance : null,
      latestDay: latest?.asked_on ?? null,
      positive,
      negative,
      neutral,
    });
  }
  return rows.sort((a, b) => a.averageBalance - b.averageBalance || a.promptKey.localeCompare(b.promptKey, "es"));
}

export function computeAiDashboard(answers: AiAnswer[]): AiDashboard {
  const scored = answers.filter((a) => typeof a.balance === "number");
  const days = dailyScores(answers);
  let positive = 0, negative = 0, neutral = 0;
  for (const a of scored) {
    const p = answerPolarity(a.balance);
    if (p === "positive") positive++;
    else if (p === "negative") negative++;
    else neutral++;
  }
  const classified = scored.length;
  const overall = classified
    ? Math.round((scored.reduce((s, a) => s + (a.balance as number), 0) / classified) * 10) / 10
    : null;
  const latest = days.at(-1) ?? null;
  const trend = days.length >= 2 ? Math.round((days[days.length - 1].balance - days[0].balance) * 10) / 10 : null;
  const share = (n: number) => (classified ? n / classified : null);
  const positives = groupClaims(
    answers.flatMap((a) =>
      (a.positives ?? []).map((text) => ({
        text,
        promptKey: a.prompt_key,
        prompt: a.prompt,
        answer: a.answer,
        askedOn: a.asked_on,
      })),
    ),
  );
  const negatives = groupClaims(
    answers.flatMap((a) =>
      (a.negatives ?? []).map((text) => ({
        text,
        promptKey: a.prompt_key,
        prompt: a.prompt,
        answer: a.answer,
        askedOn: a.asked_on,
      })),
    ),
  );
  const insufficient = answers.length === 0;
  const analysisThin = !insufficient && classified < MIN_AI_ANSWERS;
  return {
    total: answers.length,
    classified,
    overallBalance: overall,
    latestBalance: latest?.balance ?? null,
    latestDay: latest?.day ?? null,
    positive,
    negative,
    neutral,
    positiveShare: share(positive),
    negativeShare: share(negative),
    neutralShare: share(neutral),
    days,
    trend,
    trendInsufficient: days.length < 2,
    positives,
    negatives,
    questions: questionsBreakdown(answers),
    domains: domainRanking(answers),
    insufficient: insufficient || analysisThin,
    insufficientReason: insufficient
      ? "Todavía no hay respuestas guardadas de la API de OpenAI."
      : analysisThin
        ? "datos insuficientes. Hace falta al menos tres respuestas clasificadas para armar este tablero."
        : null,
  };
}

export function formatShare(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}
