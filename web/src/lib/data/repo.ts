import "server-only";
import { isFixtureMode } from "@/lib/mode";
import type { MentionFilters } from "@/lib/filters";
import type { AiAnswer, Candidate, CandidateRival, CandidateSource, CrisisAlert, CrisisBrief, CrisisStatus, Mention, MetaAd, MetaAdsSettings, GoogleAd, GoogleAdsSettings, PendingCandidate, PendingCandidateSource, RecordedDailyCost, RivalLevel, RivalSuggestionRun, SourceRun, SuspiciousAccount, SuspiciousFilters, SuspiciousStatus, Topic, CustomTopic, CustomTopicSummary, CustomTopicSummaryStatus, DailyBrief, InconsistencyAlert, InconsistencyScan, ResponseSimulation, ResponseSimulationFinish, AssistantQuestion, AssistantQuota, AssistantRunRecord } from "@/lib/types";
import type { SimulatorLimits } from "@/lib/response-simulator";
import type { SpendReport } from "@/lib/spend";

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
  /** `collected_at` más antiguo por fuente (inicio real de la recolección). */
  firstCollectedBySource(candidateId: string, sources: readonly string[]): Promise<Record<string, string | null>>;
  listSuspiciousAccounts(candidateId: string, filters?: SuspiciousFilters): Promise<SuspiciousAccount[]>;
  updateSuspiciousStatus(
    candidateId: string,
    id: string,
    status: SuspiciousStatus,
    note: string | null,
  ): Promise<void>;
  listAiAnswers(candidateId: string): Promise<AiAnswer[]>;
  listMetaAds(candidateId: string): Promise<MetaAd[]>;
  listMetaAdsSettings(candidateId: string): Promise<MetaAdsSettings | null>;
  listGoogleAds(candidateId: string): Promise<GoogleAd[]>;
  listGoogleAdsSettings(candidateId: string): Promise<GoogleAdsSettings | null>;
  listCrisisAlerts(candidateId: string): Promise<CrisisAlert[]>;
  getCrisisAlert(candidateId: string, id: string): Promise<CrisisAlert | null>;
  listCrisisBriefs(candidateId: string, alertId: string): Promise<CrisisBrief[]>;
  updateCrisisAlertStatus(
    candidateId: string,
    id: string,
    status: CrisisStatus,
    note: string | null,
  ): Promise<void>;
  /** Resúmenes diarios del candidato, del más reciente al más viejo. */
  listDailyBriefs(candidateId: string, limit: number): Promise<DailyBrief[]>;
  /** Alertas de contradicciones del candidato, de la más nueva a la más vieja. */
  listInconsistencyAlerts(candidateId: string): Promise<InconsistencyAlert[]>;
  /** Última revisión de contradicciones (datos suficientes o no). */
  getInconsistencyScan(candidateId: string): Promise<InconsistencyScan | null>;
  updateInconsistencyAlertStatus(
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
  /**
   * Panel Gasto (solo staff): agregados por función/candidato/día, uso de X y topes.
   * null = la función pulso_spend_report todavía no está en la base.
   */
  getSpendReport(from: string, to: string): Promise<SpendReport | null>;
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
  approvePendingCandidate(id: string, approvedBy?: string | null): Promise<PendingCandidate>;
  deletePendingCandidate(id: string): Promise<void>;
  listCustomTopics(candidateId: string): Promise<CustomTopic[]>;
  getCustomTopic(candidateId: string, id: string): Promise<CustomTopic | null>;
  upsertCustomTopic(row: {
    id?: string;
    candidate_id: string;
    name: string;
    description?: string | null;
    keywords: string[];
    include_terms: string[];
    exclude_terms: string[];
    sources?: string[] | null;
    enabled: boolean;
  }): Promise<CustomTopic>;
  listCustomTopicSummaries(candidateId: string, topicId: string): Promise<CustomTopicSummary[]>;
  latestCustomTopicSummary(candidateId: string, topicId: string): Promise<CustomTopicSummary | null>;
  saveCustomTopicSummary(row: Omit<CustomTopicSummary, "id" | "created_at"> & { id?: string; created_at?: string }): Promise<CustomTopicSummary>;
  updateCustomTopicSummaryStatus(
    candidateId: string,
    topicId: string,
    summaryId: string,
    status: CustomTopicSummaryStatus,
  ): Promise<void>;
  /** Topes del simulador; null si todavía no se aplicó deploy/response_simulator.sql. */
  getSimulatorLimits(): Promise<SimulatorLimits | null>;
  /** Simulaciones propias (RLS: solo el autor), de la más nueva a la más vieja. */
  listResponseSimulations(candidateId: string, limit: number): Promise<ResponseSimulation[]>;
  getResponseSimulation(candidateId: string, id: string): Promise<ResponseSimulation | null>;
  /** Chequea acceso y cupos y reserva el costo. Error "pulso:<motivo>" si no se puede. */
  startResponseSimulation(candidateId: string, draft: string, reserveUsd: number): Promise<string>;
  finishResponseSimulation(id: string, row: ResponseSimulationFinish): Promise<void>;
  /** Cupo del asistente para el usuario actual. null = el asistente no está habilitado (falta la tabla). */
  assistantQuota(): Promise<AssistantQuota | null>;
  /** Reserva la pregunta (status pending) antes de llamar al modelo. La base rechaza si se pasó del cupo. */
  startAssistantQuestion(row: { candidate_id: string; question: string; page: string | null; prompt_version: string }): Promise<{ id: string; created_at: string }>;
  finishAssistantQuestion(id: string, record: AssistantRunRecord): Promise<void>;
  /** Preguntas del usuario actual sobre el candidato (RLS: solo las propias), más recientes primero. */
  listAssistantQuestions(candidateId: string, limit: number): Promise<AssistantQuestion[]>;
}




export async function getRepo(): Promise<PulsoRepo> {
  if (isFixtureMode()) {
    const { FixtureRepo } = await import("./fixture");
    return FixtureRepo.load(process.env.PULSO_FIXTURE_PATH!);
  }
  const { SupabaseRepo } = await import("./supabase");
  return SupabaseRepo.create();
}
