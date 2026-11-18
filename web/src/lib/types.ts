export type Tone =
  | "a_favor"
  | "critica"
  | "insulto"
  | "acusacion"
  | "pregunta"
  | "informativo";
export type Target = "candidate" | "other" | "unclear";
export type Relevance = "alta" | "media" | "baja";
export type RunStatus = "running" | "ok" | "partial" | "error" | "skipped";

export interface Candidate {
  id: string;
  slug: string;
  name: string;
}

export interface Topic {
  id: string;
  candidate_id: string;
  label: string;
}

export interface Mention {
  id: string;
  candidate_id: string;
  source: string;
  url: string;
  title: string | null;
  content: string | null;
  author: string | null;
  outlet: string | null;
  published_at: string;
  collected_at: string;
  account_relation: "third_party" | "own" | "reference";
  tone: Tone | null;
  tone_reason: string | null;
  tone_confidence: number | string | null;
  target: Target | null;
  topic_id: string | null;
  relevance: Relevance | null;
  classified_at: string | null;
  classification_model: string | null;
  classification_prompt_version: string | null;
  /** Métricas de la fuente (p. ej. vistas/likes de YouTube). jsonb, puede ser null. */
  metrics: Record<string, unknown> | null;
}

export interface SourceRun {
  id: string;
  candidate_id: string;
  source: string;
  run_kind: string;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  items_found: number;
  items_new: number;
  error: string | null;
}

export interface CandidateSource {
  candidate_id: string;
  source: string;
  enabled: boolean;
  interval_seconds: number;
  last_attempt_at: string | null;
  last_success_at: string | null;
  collection_started_at: string | null;
  earliest_observed_at: string | null;
  latest_observed_at: string | null;
  coverage_status: "unknown" | "partial" | "complete";
}


export const SUSPICIOUS_STATUSES = [
  "pending",
  "reviewed_suspicious",
  "discarded",
  "reported_manual",
] as const;
export type SuspiciousStatus = (typeof SUSPICIOUS_STATUSES)[number];
export type SuspiciousPlatform = "x" | "youtube";

export interface SuspiciousEvidence {
  mention_id: string;
  url: string;
  published_at: string;
  excerpt: string;
  fingerprint?: string | null;
}

export interface SuspiciousSignal {
  type: string;
  weight: number;
  summary: string;
  evidence: SuspiciousEvidence[];
}

export interface SuspiciousAccount {
  id: string;
  candidate_id: string;
  platform: SuspiciousPlatform;
  account_key: string;
  handle: string | null;
  display_name: string | null;
  profile_url: string | null;
  score: number;
  signals: SuspiciousSignal[];
  mention_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  account_created_at: string | null;
  status: SuspiciousStatus;
  status_note: string | null;
  status_updated_at: string | null;
  detected_at: string;
}

export interface SuspiciousFilters {
  status?: SuspiciousStatus;
  platform?: SuspiciousPlatform;
}

export function isSuspiciousStatus(value: string): value is SuspiciousStatus {
  return (SUSPICIOUS_STATUSES as readonly string[]).includes(value);
}

export function isSuspiciousPlatform(value: string): value is SuspiciousPlatform {
  return value === "x" || value === "youtube";
}


export interface AiCitation {
  url: string;
  title: string | null;
  domain: string | null;
  source?: string | null;
  kept: boolean;
  filter_reason?: string | null;
}

export interface AiAnswer {
  id: string;
  candidate_id: string;
  provider: string;
  model: string;
  prompt_key: string;
  prompt: string;
  answer: string;
  citations: AiCitation[];
  balance: number | null;
  balance_reason: string | null;
  positives: string[];
  negatives: string[];
  topics: string[];
  other_politicians: string[];
  asked_at: string;
  asked_on: string;
  cost: number | string | null;
  classification_model: string | null;
}

export interface AiDayScore {
  day: string;
  balance: number;
  answers: number;
}

export interface AiDomainRank {
  domain: string;
  count: number;
}
