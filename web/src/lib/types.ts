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
