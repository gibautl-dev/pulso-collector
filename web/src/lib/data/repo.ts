import "server-only";
import { isFixtureMode } from "@/lib/mode";
import type { MentionFilters } from "@/lib/filters";
import type { AiAnswer, Candidate, CandidateSource, Mention, MetaAd, SourceRun, SuspiciousAccount, SuspiciousFilters, SuspiciousStatus, Topic } from "@/lib/types";

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
  /** Momento de los datos (fixture: exportación; supabase: ahora). */
  dataTimestamp(): Promise<string | null>;
}

export async function getRepo(): Promise<PulsoRepo> {
  if (isFixtureMode()) {
    const { FixtureRepo } = await import("./fixture");
    return FixtureRepo.load(process.env.PULSO_FIXTURE_PATH!);
  }
  const { SupabaseRepo } = await import("./supabase");
  return SupabaseRepo.create();
}
