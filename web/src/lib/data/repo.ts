import "server-only";
import { isFixtureMode } from "@/lib/mode";
import type { MentionFilters } from "@/lib/filters";
import type { AiAnswer, Candidate, CandidateRival, CandidateSource, CrisisAlert, CrisisBrief, CrisisStatus, Mention, MetaAd, PendingCandidate, PendingCandidateSource, RecordedDailyCost, RivalLevel, RivalSuggestionRun, SourceRun, SuspiciousAccount, SuspiciousFilters, SuspiciousStatus, Topic } from "@/lib/types";

export interface MentionPage {
  items: Mention[];
  total: number;
}

export interface PulsoRepo {
  readonly mode: "supabase" | "fixture";
  /** Candidatos visibles para el usuario (RLS por membresía). */
  listCandidates(): Promise<Candidate[]>;
  getCandidate(slug: string): Promise<Candidate | null>;
  listTopics(candidateId: string): Promise<Topic[]>;
  /** Menciones publicadas desde `sinceIso`, para agregados del tablero. */
  mentionsSince(candidateId: string, sinceIso: string): Promise<Mention[]>;
  searchMentions(candidateId: string, filters: MentionFilters, pageSize: number): Promise<MentionPage>;
  getMention(candidateId: string, id: string): Promise<Mention | null>;
  listSourceRuns(candidateId: string, limit: number): Promise<SourceRun[]>;
  listCandidateSources(candidateId: string): Promise<CandidateSource[]>;
  listSuspiciousAccounts(candidateId: string, filters?: SuspiciousFilters): Promise<SuspiciousAccount[]>;
  updateSuspiciousStatus(
    candidateId: string,
    id: string,
    status: SuspiciousStatus,
    note: string | null,
  ): Promise<void>;
  listAiAnswers(candidateId: string): Promise<AiAnswer[]>;
  listMetaAds(candidateId: string): Promise<MetaAd[]>;
  listCrisisAlerts(candidateId: string): Promise<CrisisAlert[]>;
  getCrisisAlert(candidateId: string, id: string): Promise<CrisisAlert | null>;
  listCrisisBriefs(candidateId: string, alertId: string): Promise<CrisisBrief[]>;
  updateCrisisAlertStatus(
    candidateId: string,
    id: string,
    status: CrisisStatus,
    note: string | null,
  ): Promise<void>;
  /** Momento de los datos (fixture: exportación; supabase: ahora). */
  dataTimestamp(): Promise<string | null>;
  isStaff(): Promise<boolean>;
  getCandidateById(id: string): Promise<Candidate | null>;
  /** Directorio para el panel (todos, si es staff). */
  listAssignableCandidates(): Promise<Candidate[]>;
  listRivals(candidateId: string): Promise<CandidateRival[]>;
  replaceRivals(candidateId: string, rows: { rival_id: string; level: RivalLevel }[]): Promise<void>;
  listRecordedDailyCosts(): Promise<RecordedDailyCost[]>;
  latestSuggestionRun(candidateId: string): Promise<RivalSuggestionRun | null>;
  saveSuggestionRun(run: Omit<RivalSuggestionRun, "id" | "created_at"> & { id?: string; created_at?: string }): Promise<RivalSuggestionRun>;
  listPendingCandidates(candidateId: string): Promise<PendingCandidate[]>;
  addPendingCandidate(row: {
    name: string;
    slug?: string | null;
    arena?: string | null;
    requested_for_candidate_id: string;
    requested_level: RivalLevel;
    source: PendingCandidateSource;
    reason?: string | null;
  }): Promise<PendingCandidate>;
}



export async function getRepo(): Promise<PulsoRepo> {
  if (isFixtureMode()) {
    const { FixtureRepo } = await import("./fixture");
    return FixtureRepo.load(process.env.PULSO_FIXTURE_PATH!);
  }
  const { SupabaseRepo } = await import("./supabase");
  return SupabaseRepo.create();
}
