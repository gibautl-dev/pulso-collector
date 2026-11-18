import { NEGATIVE_TONES } from "./labels";
import type { Mention, SuspiciousAccount, SuspiciousSignal, Topic } from "./types";
import { balanceTone, formatBalance } from "./x-posts";
import { isYoutubeComment } from "./youtube";

/** Mínimos para no leer una “participación” con una o dos cuentas aisladas. */
export const MIN_FLAGGED_ACCOUNTS = 3;
export const MIN_FLAGGED_POSTS = 5;

export const SIGNAL_CATEGORY_IDS = ["automated", "spam", "profile", "other"] as const;
export type SignalCategoryId = (typeof SIGNAL_CATEGORY_IDS)[number];

export const SIGNAL_CATEGORY_LABEL: Record<SignalCategoryId, string> = {
  automated: "Conducta automatizada o ráfagas",
  spam: "Spam o texto repetido",
  profile: "Perfil nuevo o de baja calidad",
  other: "Otros indicios",
};

export const SIGNAL_CATEGORY_HINT: Record<SignalCategoryId, string> = {
  automated: "Ráfagas de un mismo autor o de un grupo de cuentas débiles en poco tiempo.",
  spam: "El mismo texto, o uno casi idéntico, repetido por la cuenta o por varias cuentas.",
  profile: "Cuenta nueva, nombre con muchos dígitos, poca interacción o una relación rara de seguidos.",
  other: "Señales que el detector guardó y todavía no entran en las otras categorías.",
};

const SIGNAL_TO_CATEGORY: Record<string, SignalCategoryId> = {
  author_burst: "automated",
  group_burst: "automated",
  self_repeat: "spam",
  coordination: "spam",
  new_account: "profile",
  follow_ratio: "profile",
  digit_name: "profile",
  low_engagement: "profile",
};

const TUPLE_KEY_RE = /^\(\s*[^,]+,\s*([^,]+),\s*(.+?)\)$/;

export function signalCategory(type: string): SignalCategoryId {
  return SIGNAL_TO_CATEGORY[type] ?? "other";
}

/** Saca el handle de un account_key mal guardado como tupla de Python: (uuid,x,handle). */
export function parseTupleAccountKey(accountKey: string): { platform: string; key: string } | null {
  const match = (accountKey || "").trim().match(TUPLE_KEY_RE);
  if (!match) return null;
  const platform = match[1].trim();
  const key = match[2].trim();
  if (!platform || !key) return null;
  return { platform, key };
}

function normalizeHandle(platform: string, raw: string): string {
  const value = raw.trim();
  if (platform === "x") return value.replace(/^@/, "").toLowerCase();
  return value;
}

export function flaggedLookupKey(account: Pick<SuspiciousAccount, "platform" | "handle" | "account_key">): string | null {
  const fromHandle = (account.handle || "").trim();
  if (fromHandle) return `${account.platform}:${normalizeHandle(account.platform, fromHandle)}`;
  const parsed = parseTupleAccountKey(account.account_key);
  if (parsed) {
    const platform = parsed.platform === "x" || parsed.platform === "youtube" ? parsed.platform : account.platform;
    return `${platform}:${normalizeHandle(platform, parsed.key)}`;
  }
  const fallback = (account.account_key || "").trim();
  return fallback ? `${account.platform}:${normalizeHandle(account.platform, fallback)}` : null;
}

/** Misma regla que el detector: en X usa el handle en minúsculas; en YouTube, el handle tal cual. */
export function mentionLookupKey(m: Pick<Mention, "source" | "author_handle" | "author">): string | null {
  if (m.source !== "x" && m.source !== "youtube") return null;
  const handle = (m.author_handle || "").trim();
  if (handle) return `${m.source}:${normalizeHandle(m.source, handle)}`;
  const name = (m.author || "").trim();
  if (!name) return null;
  return `${m.source}:${name.toLowerCase()}`;
}

/** Conversación que mira el detector: posts de X y comentarios de YouTube de terceros. */
export function isConversationMention(m: Pick<Mention, "source" | "url" | "metrics" | "account_relation">): boolean {
  if (m.account_relation !== "third_party") return false;
  if (m.source === "x") return true;
  return m.source === "youtube" && isYoutubeComment(m);
}

export function isActiveFlag(account: Pick<SuspiciousAccount, "status">): boolean {
  return account.status !== "discarded";
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
}

export interface SentimentSplit {
  posts: number;
  aboutCandidate: number;
  classifiedAbout: number;
  positive: number;
  negative: number;
  pending: number;
  balance: number | null;
}

export interface TopicComparison {
  topicId: string | null;
  label: string;
  flagged: number;
  overall: number;
}

export interface GroupedReasonAccount {
  account: SuspiciousAccount;
  signals: SuspiciousSignal[];
}

export interface GroupedReason {
  id: SignalCategoryId;
  label: string;
  hint: string;
  accounts: GroupedReasonAccount[];
}

export interface SuspiciousInsights {
  periodDays: number;
  posts: number;
  authors: number;
  flaggedPosts: number;
  flaggedAuthors: number;
  flaggedAccounts: SuspiciousAccount[];
  authorShare: number | null;
  postShare: number | null;
  sufficient: boolean;
  insufficientReason: string | null;
  sentiment: {
    overall: SentimentSplit;
    flagged: SentimentSplit;
    without: SentimentSplit;
  };
  topics: TopicComparison[];
  reasons: GroupedReason[];
}

function sentimentOf(rows: Mention[]): SentimentSplit {
  let aboutCandidate = 0;
  let classifiedAbout = 0;
  let positive = 0;
  let negative = 0;
  let pending = 0;
  for (const m of rows) {
    if (!m.tone) pending++;
    if (m.target !== "candidate") continue;
    aboutCandidate++;
    if (!m.tone) continue;
    classifiedAbout++;
    if (m.tone === "a_favor") positive++;
    if (NEGATIVE_TONES.includes(m.tone)) negative++;
  }
  return {
    posts: rows.length,
    aboutCandidate,
    classifiedAbout,
    positive,
    negative,
    pending,
    balance: classifiedAbout > 0 ? Math.round(((positive - negative) / classifiedAbout) * 100) : null,
  };
}

export function computeSuspiciousInsights(
  mentions: Mention[],
  accounts: SuspiciousAccount[],
  topics: Topic[],
  opts: { days: number; now?: Date },
): SuspiciousInsights {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * 86400000);
  const conversation = mentions.filter(
    (m) => isConversationMention(m) && new Date(m.published_at) >= since,
  );
  const topicLabel = new Map(topics.map((t) => [t.id, t.label]));

  const active = accounts.filter(isActiveFlag);
  const flaggedKeys = new Map<string, SuspiciousAccount>();
  for (const account of active) {
    const key = flaggedLookupKey(account);
    if (key) flaggedKeys.set(key, account);
  }

  const authorKeys = new Set<string>();
  const flaggedAuthorKeys = new Set<string>();
  const flaggedMentions: Mention[] = [];
  const cleanMentions: Mention[] = [];
  const flaggedInPeriod = new Map<string, SuspiciousAccount>();

  for (const m of conversation) {
    const key = mentionLookupKey(m);
    if (key) authorKeys.add(key);
    const flagged = key ? flaggedKeys.get(key) : undefined;
    if (flagged && key) {
      flaggedMentions.push(m);
      flaggedAuthorKeys.add(key);
      flaggedInPeriod.set(key, flagged);
    } else {
      cleanMentions.push(m);
    }
  }

  const flaggedAccounts = [...flaggedInPeriod.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const authorShare = authorKeys.size > 0 ? (flaggedAuthorKeys.size / authorKeys.size) * 100 : null;
  const postShare = conversation.length > 0 ? (flaggedMentions.length / conversation.length) * 100 : null;
  const sufficient =
    flaggedAccounts.length >= MIN_FLAGGED_ACCOUNTS && flaggedMentions.length >= MIN_FLAGGED_POSTS;
  const insufficientReason = sufficient
    ? null
    : flaggedAccounts.length === 0
      ? "Todavía no hay cuentas marcadas en este período."
      : `Solo hay ${flaggedAccounts.length} ${flaggedAccounts.length === 1 ? "cuenta marcada" : "cuentas marcadas"} y ${flaggedMentions.length} ${flaggedMentions.length === 1 ? "post o comentario" : "posts o comentarios"} en este período. Con tan poca evidencia no se puede leer una participación real de la conversación.`;

  const overallTopics = new Map<string, TopicComparison>();
  const flaggedTopics = new Map<string, number>();
  const bump = (map: Map<string, TopicComparison>, m: Mention) => {
    const key = m.topic_id ?? "none";
    const row = map.get(key) ?? {
      topicId: m.topic_id,
      label: m.topic_id ? (topicLabel.get(m.topic_id) ?? "Tema") : "Sin tema",
      flagged: 0,
      overall: 0,
    };
    row.overall++;
    map.set(key, row);
  };
  for (const m of conversation) bump(overallTopics, m);
  for (const m of flaggedMentions) {
    const key = m.topic_id ?? "none";
    flaggedTopics.set(key, (flaggedTopics.get(key) ?? 0) + 1);
  }
  const topicsOut = flaggedMentions.length > 0
    ? [...overallTopics.values()]
        .map((row) => ({ ...row, flagged: flaggedTopics.get(row.topicId ?? "none") ?? 0 }))
        .filter((row) => row.flagged > 0)
        .sort((a, b) => b.flagged - a.flagged || b.overall - a.overall || a.label.localeCompare(b.label, "es"))
        .slice(0, 10)
    : [];

  const reasonMap = new Map<SignalCategoryId, Map<string, GroupedReasonAccount>>();
  for (const account of flaggedAccounts) {
    const grouped = new Map<SignalCategoryId, SuspiciousSignal[]>();
    for (const signal of account.signals) {
      const id = signalCategory(signal.type);
      const list = grouped.get(id) ?? [];
      list.push(signal);
      grouped.set(id, list);
    }
    for (const [id, signals] of grouped) {
      const accounts = reasonMap.get(id) ?? new Map();
      accounts.set(account.id, { account, signals });
      reasonMap.set(id, accounts);
    }
  }
  const reasons: GroupedReason[] = SIGNAL_CATEGORY_IDS.filter((id) => id !== "other" || (reasonMap.get("other")?.size ?? 0) > 0)
    .map((id) => ({
      id,
      label: SIGNAL_CATEGORY_LABEL[id],
      hint: SIGNAL_CATEGORY_HINT[id],
      accounts: [...(reasonMap.get(id)?.values() ?? [])].sort(
        (a, b) => b.account.score - a.account.score || a.account.id.localeCompare(b.account.id),
      ),
    }))
    .filter((row) => row.id !== "other" || row.accounts.length > 0);

  return {
    periodDays: opts.days,
    posts: conversation.length,
    authors: authorKeys.size,
    flaggedPosts: flaggedMentions.length,
    flaggedAuthors: flaggedAuthorKeys.size,
    flaggedAccounts,
    authorShare,
    postShare,
    sufficient,
    insufficientReason,
    sentiment: {
      overall: sentimentOf(conversation),
      flagged: sentimentOf(flaggedMentions),
      without: sentimentOf(cleanMentions),
    },
    topics: topicsOut,
    reasons,
  };
}

export { balanceTone, formatBalance };
