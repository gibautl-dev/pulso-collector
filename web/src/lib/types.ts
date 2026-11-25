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

export interface MetaAdsSettings {
  candidate_id: string;
  enabled: boolean;
  last_run_on: string | null;
  updated_at: string | null;
}

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
  /** Tipo opcional del borrador (p. ej. vocero), si el job lo informa. */
  type?: string | null;
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

export const RIVAL_LEVELS = ["radar", "comparativo", "completo"] as const;
export type RivalLevel = (typeof RIVAL_LEVELS)[number];

export function isRivalLevel(value: string): value is RivalLevel {
  return (RIVAL_LEVELS as readonly string[]).includes(value);
}

export interface CandidateRival {
  candidate_id: string;
  rival_id: string;
  level: RivalLevel;
  created_at?: string;
}

export const PENDING_CANDIDATE_STATUSES = ["pendiente_de_alta", "aprobado", "borrado"] as const;
export type PendingCandidateStatus = (typeof PENDING_CANDIDATE_STATUSES)[number];
export const PENDING_CANDIDATE_STATUS = "pendiente_de_alta" as const;
export const ACTIVE_PENDING_STATUSES: PendingCandidateStatus[] = ["pendiente_de_alta", "aprobado"];

export function isPendingCandidateStatus(value: string): value is PendingCandidateStatus {
  return (PENDING_CANDIDATE_STATUSES as readonly string[]).includes(value);
}

export function isActivePendingStatus(status: string): boolean {
  return status === "pendiente_de_alta" || status === "aprobado";
}

export type PendingCandidateSource = "manual" | "ai_suggestion";

export interface PendingCandidate {
  id: string;
  name: string;
  slug: string | null;
  arena: string | null;
  status: PendingCandidateStatus;
  requested_for_candidate_id: string;
  requested_level: RivalLevel;
  source: PendingCandidateSource;
  reason: string | null;
  created_at: string;
  created_by?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
}

export interface RivalSuggestion {
  name: string;
  reason: string;
  arena: string;
  already_in_pulso: boolean;
  matched_candidate_id: string | null;
  matched_candidate_slug: string | null;
}

export type RivalSuggestionOrigin = "ai" | "fixture_example";

export interface RivalSuggestionRun {
  id: string;
  candidate_id: string;
  prompt_version: string;
  model: string | null;
  suggestions: RivalSuggestion[];
  cost_usd: number | null;
  usage?: Record<string, unknown> | null;
  created_at: string;
  origin: RivalSuggestionOrigin;
  note?: string | null;
}

/** Costo diario ya registrado en Pulso, para estimar un alta. */
export interface RecordedDailyCost {
  candidate_id: string;
  source: string;
  date: string;
  cost_usd: number;
}


/** Temática definida a mano para un candidato (no es el tema automático del clasificador). */
export interface CustomTopic {
  id: string;
  candidate_id: string;
  name: string;
  description: string | null;
  keywords: string[];
  include_terms: string[];
  exclude_terms: string[];
  sources: string[] | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

export type CustomTopicSummaryStatus = "draft" | "approved" | "discarded";
export type CustomTopicSummaryOrigin = "ai" | "fixture_example";

export interface CustomTopicSummaryOutput {
  happening: string;
  risks: string[];
  opportunities: string[];
  angles: { title: string; body: string }[];
}

export interface CustomTopicSummary {
  id: string;
  topic_id: string;
  candidate_id: string;
  status: CustomTopicSummaryStatus;
  period_start: string;
  period_end: string;
  output: CustomTopicSummaryOutput;
  model: string | null;
  cost_usd: number | null;
  usage?: Record<string, unknown> | null;
  prompt_version: string;
  origin: CustomTopicSummaryOrigin;
  note?: string | null;
  created_at: string;
  created_by?: string | null;
  reviewed_at?: string | null;
}

export interface CustomTopicClassification {
  topic_id: string;
  mention_id: string;
  candidate_id: string;
  relevance: Relevance;
  reason: string | null;
  model: string | null;
  cost_usd: number | null;
  created_at: string;
}


export const GOOGLE_AD_SOURCES = ["political_report", "ads_transparency_center"] as const;
export type GoogleAdSource = (typeof GOOGLE_AD_SOURCES)[number];

export interface GoogleAd {
  id: string;
  candidate_id: string;
  source: GoogleAdSource;
  ad_id: string;
  ad_url: string | null;
  ad_type: string | null;
  regions: string[];
  advertiser_id: string | null;
  advertiser_name: string | null;
  advertiser_legal_name: string | null;
  date_range_start: string | null;
  date_range_end: string | null;
  first_served_at: string | null;
  last_served_at: string | null;
  num_of_days: number | string | null;
  impressions_lower: number | string | null;
  impressions_upper: number | string | null;
  impressions_raw: string | null;
  spend_currency: string | null;
  spend_lower: number | string | null;
  spend_upper: number | string | null;
  age_targeting: string | null;
  gender_targeting: string | null;
  geo_targeting_included: string | null;
  topic: string | null;
  ad_funded_by: string | null;
  fetched_at: string;
  fetched_on: string;
}

export interface GoogleAdsSettings {
  candidate_id: string;
  enabled: boolean;
  source: GoogleAdSource;
  region: string;
  last_run_on: string | null;
  report_updated_at: string | null;
  updated_at: string | null;
}

export function isGoogleAdSource(value: string): value is GoogleAdSource {
  return (GOOGLE_AD_SOURCES as readonly string[]).includes(value);
}

/** Resumen diario (public.daily_briefs). Las cifras vienen calculadas; el texto cita menciones. */
export type DailyBriefStatus = "ok" | "insufficient";
export interface DailyBriefPoint {
  text: string;
  mention_ids: string[];
}
export interface DailyBriefAction {
  action: string;
  why: string;
  priority: "alta" | "media" | "baja" | string;
  area: string;
  mention_ids: string[];
}
export interface DailyBriefHighlight {
  key: string;
  value: string;
  label: string;
  delta: string | null;
  tone: "negative" | "positive" | "neutral" | string;
}
export interface DailyBriefSource {
  id: string;
  url: string;
  title: string;
  outlet: string | null;
  source: string;
  tone: Tone | null;
  time: string | null;
}
export interface DailyBriefOutput {
  headline: string;
  highlight: DailyBriefHighlight | null;
  what_changed: DailyBriefPoint[];
  why_it_matters: DailyBriefPoint[];
  what_to_do: DailyBriefAction[];
  aclaracion?: string;
  insufficient_reason?: string | null;
  sources: DailyBriefSource[];
}
export interface DailyBrief {
  id: string;
  candidate_id: string;
  brief_date: string;
  timezone: string;
  status: DailyBriefStatus | string;
  headline: string | null;
  metrics: Record<string, unknown>;
  output: DailyBriefOutput;
  created_at: string;
  updated_at?: string;
}

/** Asistente de datos (public.assistant_questions). Las cifras y citas salen de código. */
export type AssistantStatus = "pending" | "ok" | "no_data" | "error" | "limited";
export interface AssistantCitation {
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
export interface AssistantFact {
  label: string;
  value: string;
  hint?: string | null;
  tone?: "positive" | "negative" | "default";
}
export interface AssistantAnswer {
  text: string;
  no_data: boolean;
  followups: string[];
  citations: AssistantCitation[];
  facts: AssistantFact[];
  notes: string[];
}
export interface AssistantQuestion {
  id: string;
  candidate_id: string;
  question: string;
  status: AssistantStatus | string;
  answer: AssistantAnswer | null;
  page?: string | null;
  created_at: string;
}
export interface AssistantQuota {
  user_last_hour: number;
  user_today: number;
  total_today: number;
  cost_today_usd: number;
}
export interface AssistantRunRecord {
  status: AssistantStatus;
  answer: AssistantAnswer | null;
  tools: unknown[];
  model: string | null;
  cost_usd: number | null;
  usage: Record<string, unknown>;
}
