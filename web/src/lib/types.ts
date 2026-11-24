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
  /** Usuario de la cuenta en la fuente, sin @ (p. ej. X). */
  author_handle?: string | null;
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


export interface MetaAd {
  id: string;
  candidate_id: string;
  ad_id: string;
  page_id: string | null;
  page_name: string | null;
  bylines: string | null;
  publisher_platforms: string[];
  currency: string | null;
  spend_lower: number | string | null;
  spend_upper: number | string | null;
  impressions_lower: number | string | null;
  impressions_upper: number | string | null;
  ad_creative_bodies: string[];
  ad_creative_link_titles: string[];
  ad_snapshot_url: string | null;
  ad_creation_time: string | null;
  ad_delivery_start_time: string | null;
  ad_delivery_stop_time: string | null;
  fetched_at: string;
  fetched_on: string;
  stance?: MetaAdStance | null;
  stance_reason?: string | null;
  stance_confidence?: number | string | null;
  classified_at?: string | null;
  classification_model?: string | null;
  classification_prompt_version?: string | null;
}

export const META_AD_STANCES = ["a_favor", "en_contra", "neutral_otro"] as const;
export type MetaAdStance = (typeof META_AD_STANCES)[number];

export type MetaAdStatusFilter = "activo" | "inactivo";

export interface MetaAdFilters {
  q?: string;
  page?: string;
  status?: MetaAdStatusFilter;
  currency?: string;
  stance?: MetaAdStance | "sin_clasificar";
}

export function isMetaAdStatus(value: string): value is MetaAdStatusFilter {
  return value === "activo" || value === "inactivo";
}

export function isMetaAdStance(value: string): value is MetaAdStance {
  return (META_AD_STANCES as readonly string[]).includes(value);
}


export const CRISIS_STATUSES = ["new", "in_review", "approved", "discarded"] as const;
export type CrisisStatus = (typeof CRISIS_STATUSES)[number];

export const CRISIS_TRIGGERS = [
  "negative_spike",
  "rising_topic",
  "suspicious_campaign",
  "attack_ads",
  "ai_shift",
] as const;
export type CrisisTrigger = (typeof CRISIS_TRIGGERS)[number];

export const CRISIS_RISKS = ["bajo", "medio", "medio_alto", "alto"] as const;
export type CrisisRisk = (typeof CRISIS_RISKS)[number];

export function isCrisisStatus(value: string): value is CrisisStatus {
  return (CRISIS_STATUSES as readonly string[]).includes(value);
}

export interface CrisisKeyPiece {
  outlet_or_author: string;
  published_at: string;
  url: string;
  quote: string;
  why: string;
}

export interface CrisisOption {
  id: string;
  title: string;
  rationale: string;
  audience: string;
  risk: string;
  when_to_use: string;
}

export interface CrisisDraft {
  option_id: string;
  channel: string;
  text: string;
  notes: string;
}

export interface CrisisBriefOutput {
  title?: string;
  risk_level?: CrisisRisk | string;
  summary?: string;
  analyst?: {
    diagnosis?: string;
    who?: string;
    reach?: string;
    key_pieces?: CrisisKeyPiece[];
  };
  evidence?: {
    dossier_recommended?: boolean;
    reason?: string;
    accounts?: { handle: string; why: string }[];
    caveats?: string;
  };
  strategist?: { options?: CrisisOption[] };
  writer?: { drafts?: CrisisDraft[] };
  coordinator?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CrisisBrief {
  id: string;
  alert_id: string;
  candidate_id: string;
  prompt_version: string;
  model: string;
  risk_level: CrisisRisk | string | null;
  title: string | null;
  input_ref: Record<string, unknown>;
  output: CrisisBriefOutput;
  cost_usd: number | string | null;
  usage?: Record<string, unknown>;
  created_at: string;
}

export interface CrisisAlert {
  id: string;
  candidate_id: string;
  trigger_type: CrisisTrigger | string;
  trigger_key: string;
  cluster_label: string | null;
  topic_id?: string | null;
  window_start: string;
  window_end: string;
  severity: CrisisRisk | string;
  metrics: Record<string, unknown>;
  status: CrisisStatus;
  status_note: string | null;
  status_updated_at: string | null;
  status_updated_by?: string | null;
  first_detected_at: string;
  last_detected_at: string;
  created_at?: string;
  latest_brief?: CrisisBrief | null;
}

export interface CrisisAgentSetting {
  candidate_id: string;
  enabled: boolean;
  max_cost_usd: number | string;
  max_briefs_per_run: number;
  notify_email: boolean;
}
