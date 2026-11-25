import { applyFilters, type MentionFilters } from "@/lib/filters";
import type { AiAnswer, Candidate, CandidateRival, CandidateSource, CrisisAlert, CrisisBrief, CrisisStatus, Mention, MetaAd, MetaAdsSettings, PendingCandidate, PendingCandidateSource, RecordedDailyCost, RivalLevel, RivalSuggestionRun, SourceRun, SuspiciousAccount, SuspiciousFilters, SuspiciousStatus, Topic, CustomTopic, CustomTopicSummary, CustomTopicSummaryStatus } from "@/lib/types";
import { hasDuplicatePending, slugifyName } from "@/lib/rival-suggest";
import { normalizeMetaAd } from "@/lib/meta-ads";
import type { MentionPage, PulsoRepo } from "./repo";

export interface FixtureData {
  exported_at?: string;
  candidate: Candidate;
  /** Si está, el usuario local ve todos estos (además del `candidate`). */
  candidates?: Candidate[];
  topics: Topic[];
  mentions: Mention[];
  source_runs: SourceRun[];
  candidate_sources: CandidateSource[];
  suspicious_accounts?: SuspiciousAccount[];
  ai_answers?: AiAnswer[];
  meta_ads?: MetaAd[];
  meta_ads_settings?: MetaAdsSettings[];
  crisis_alerts?: CrisisAlert[];
  crisis_briefs?: CrisisBrief[];
  /** En el modo local, el usuario se trata como equipo de Active. */
  staff?: boolean;
  candidate_rivals?: CandidateRival[];
  recorded_daily_costs?: RecordedDailyCost[];
  rival_suggestion_runs?: RivalSuggestionRun[];
  pending_candidates?: PendingCandidate[];
  custom_topics?: CustomTopic[];
  custom_topic_summaries?: CustomTopicSummary[];
}



/** Repositorio en memoria: usado por el modo fixture y los tests. */
export class MemoryRepo implements PulsoRepo {
  readonly mode = "fixture" as const;
  constructor(private readonly data: FixtureData) {}

  private visibleCandidates(): Candidate[] {
    const bySlug = new Map<string, Candidate>();
    bySlug.set(this.data.candidate.slug, this.data.candidate);
    for (const c of this.data.candidates ?? []) bySlug.set(c.slug, c);
    return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  async listCandidates() {
    return this.visibleCandidates();
  }
  async getCandidate(slug: string) {
    return this.visibleCandidates().find((c) => c.slug === slug) ?? null;
  }
  async listTopics(candidateId: string) {
    return this.data.topics
      .filter((t) => t.candidate_id === candidateId)
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }
  async mentionsSince(candidateId: string, sinceIso: string) {
    const since = new Date(sinceIso);
    return this.data.mentions.filter(
      (m) => m.candidate_id === candidateId && new Date(m.published_at) >= since,
    );
  }
  async searchMentions(candidateId: string, filters: MentionFilters, pageSize: number): Promise<MentionPage> {
    const all = applyFilters(
      this.data.mentions.filter((m) => m.candidate_id === candidateId),
      filters,
    );
    const start = (filters.page - 1) * pageSize;
    return { items: all.slice(start, start + pageSize), total: all.length };
  }
  async getMention(candidateId: string, id: string) {
    return this.data.mentions.find((m) => m.candidate_id === candidateId && m.id === id) ?? null;
  }
  async listSourceRuns(candidateId: string, limit: number) {
    return this.data.source_runs
      .filter((r) => r.candidate_id === candidateId)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, limit);
  }
  async listCandidateSources(candidateId: string) {
    return this.data.candidate_sources.filter((s) => s.candidate_id === candidateId);
  }
  async listSuspiciousAccounts(candidateId: string, filters: SuspiciousFilters = {}) {
    return (this.data.suspicious_accounts ?? [])
      .filter((a) => a.candidate_id === candidateId)
      .filter((a) => (filters.status ? a.status === filters.status : true))
      .filter((a) => (filters.platform ? a.platform === filters.platform : true))
      .sort((a, b) => b.score - a.score || b.detected_at.localeCompare(a.detected_at));
  }
  async updateSuspiciousStatus(candidateId: string, id: string, status: SuspiciousStatus, note: string | null) {
    const account = (this.data.suspicious_accounts ?? []).find((a) => a.candidate_id === candidateId && a.id === id);
    if (!account) throw new Error("Cuenta no encontrada");
    account.status = status;
    account.status_note = note;
    account.status_updated_at = new Date().toISOString();
  }
  async listAiAnswers(candidateId: string) {
    return (this.data.ai_answers ?? [])
      .filter((a) => a.candidate_id === candidateId)
      .slice()
      .sort((a, b) => b.asked_on.localeCompare(a.asked_on) || a.prompt_key.localeCompare(b.prompt_key, "es"));
  }
  async listMetaAds(candidateId: string) {
    return (this.data.meta_ads ?? [])
      .filter((a) => a.candidate_id === candidateId)
      .map(normalizeMetaAd)
      .sort((a, b) => {
        const aStart = a.ad_delivery_start_time ?? a.fetched_at;
        const bStart = b.ad_delivery_start_time ?? b.fetched_at;
        return bStart.localeCompare(aStart) || a.ad_id.localeCompare(b.ad_id);
      });
  }
  async listMetaAdsSettings(candidateId: string) {
    return (this.data.meta_ads_settings ?? []).find((s) => s.candidate_id === candidateId) ?? null;
  }

  async listCrisisAlerts(candidateId: string) {
    const briefs = this.data.crisis_briefs ?? [];
    return (this.data.crisis_alerts ?? [])
      .filter((a) => a.candidate_id === candidateId)
      .slice()
      .sort((a, b) => b.last_detected_at.localeCompare(a.last_detected_at))
      .map((alert) => ({
        ...alert,
        latest_brief: briefs
          .filter((b) => b.alert_id === alert.id)
          .slice()
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null,
      }));
  }
  async getCrisisAlert(candidateId: string, id: string) {
    const alerts = await this.listCrisisAlerts(candidateId);
    return alerts.find((a) => a.id === id) ?? null;
  }
  async listCrisisBriefs(candidateId: string, alertId: string) {
    return (this.data.crisis_briefs ?? [])
      .filter((b) => b.candidate_id === candidateId && b.alert_id === alertId)
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async updateCrisisAlertStatus(candidateId: string, id: string, status: CrisisStatus, note: string | null) {
    const alert = (this.data.crisis_alerts ?? []).find((a) => a.candidate_id === candidateId && a.id === id);
    if (!alert) throw new Error("Alerta no encontrada");
    alert.status = status;
    alert.status_note = note;
    alert.status_updated_at = new Date().toISOString();
  }
  async dataTimestamp() {
    return this.data.exported_at ?? null;
  }
  async isStaff() {
    return this.data.staff === true;
  }
  async getCandidateById(id: string) {
    return this.visibleCandidates().find((c) => c.id === id) ?? null;
  }
  async listAssignableCandidates() {
    return this.visibleCandidates();
  }
  async listRivals(candidateId: string) {
    return (this.data.candidate_rivals ?? []).filter((r) => r.candidate_id === candidateId);
  }
  async replaceRivals(candidateId: string, rows: { rival_id: string; level: RivalLevel }[]) {
    if (!(await this.isStaff())) throw new Error("Solo el equipo de Active puede asignar rivales");
    const known = new Set(this.visibleCandidates().map((c) => c.id));
    const next: CandidateRival[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.rival_id === candidateId) throw new Error("Un candidato no puede ser rival de sí mismo");
      if (!known.has(row.rival_id)) throw new Error("El rival tiene que ser un candidato de Pulso");
      if (seen.has(row.rival_id)) continue;
      seen.add(row.rival_id);
      next.push({ candidate_id: candidateId, rival_id: row.rival_id, level: row.level });
    }
    this.data.candidate_rivals = [
      ...(this.data.candidate_rivals ?? []).filter((r) => r.candidate_id !== candidateId),
      ...next,
    ];
  }
  async listRecordedDailyCosts() {
    return this.data.recorded_daily_costs ?? [];
  }
  async latestSuggestionRun(candidateId: string) {
    return (
      (this.data.rival_suggestion_runs ?? [])
        .filter((r) => r.candidate_id === candidateId)
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
    );
  }
  async saveSuggestionRun(run: Omit<RivalSuggestionRun, "id" | "created_at"> & { id?: string; created_at?: string }) {
    if (!(await this.isStaff())) throw new Error("Solo el equipo de Active puede pedir sugerencias");
    const saved: RivalSuggestionRun = {
      ...run,
      id: run.id ?? crypto.randomUUID(),
      created_at: run.created_at ?? new Date().toISOString(),
    };
    this.data.rival_suggestion_runs = [...(this.data.rival_suggestion_runs ?? []), saved];
    return saved;
  }
  async listPendingCandidates(candidateId: string) {
    return (this.data.pending_candidates ?? [])
      .filter((p) => p.requested_for_candidate_id === candidateId && p.status !== "borrado")
      .slice()
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "pendiente_de_alta" ? -1 : 1;
        return b.created_at.localeCompare(a.created_at);
      });
  }
  async addPendingCandidate(row: {
    name: string;
    slug?: string | null;
    arena?: string | null;
    requested_for_candidate_id: string;
    requested_level: RivalLevel;
    source: PendingCandidateSource;
    reason?: string | null;
  }) {
    if (!(await this.isStaff())) throw new Error("Solo el equipo de Active puede pedir un alta");
    const name = row.name.trim();
    if (!name) throw new Error("Falta el nombre");
    const existing = this.visibleCandidates().some(
      (c) => c.name.toLowerCase() === name.toLowerCase() || c.slug === (row.slug || slugifyName(name)),
    );
    if (existing) throw new Error("Ese candidato ya está en Pulso: sumalo con la lista de arriba, no como un alta nueva.");
    const pending = this.data.pending_candidates ?? [];
    if (hasDuplicatePending(name, pending, row.requested_for_candidate_id)) {
      throw new Error(`Ya hay un pedido de alta para ${name} en este candidato.`);
    }
    const rec: PendingCandidate = {
      id: crypto.randomUUID(),
      name,
      slug: row.slug ?? slugifyName(name) ?? null,
      arena: row.arena ?? null,
      status: "pendiente_de_alta",
      requested_for_candidate_id: row.requested_for_candidate_id,
      requested_level: row.requested_level,
      source: row.source,
      reason: row.reason ?? null,
      created_at: new Date().toISOString(),
    };
    this.data.pending_candidates = [...pending, rec];
    return rec;
  }

  async approvePendingCandidate(id: string, approvedBy?: string | null) {
    if (!(await this.isStaff())) throw new Error("Solo el equipo de Active puede aprobar un alta");
    const rec = (this.data.pending_candidates ?? []).find((p) => p.id === id);
    if (!rec || rec.status === "borrado") throw new Error("No está ese pedido de alta");
    rec.status = "aprobado";
    rec.approved_at = new Date().toISOString();
    rec.approved_by = approvedBy ?? null;
    return rec;
  }
  async deletePendingCandidate(id: string) {
    if (!(await this.isStaff())) throw new Error("Solo el equipo de Active puede borrar un alta");
    const rec = (this.data.pending_candidates ?? []).find((p) => p.id === id);
    if (!rec) throw new Error("No está ese pedido de alta");
    rec.status = "borrado";
  }

  async listCustomTopics(candidateId: string) {
    return (this.data.custom_topics ?? [])
      .filter((t) => t.candidate_id === candidateId)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }
  async getCustomTopic(candidateId: string, id: string) {
    return (this.data.custom_topics ?? []).find((t) => t.candidate_id === candidateId && t.id === id) ?? null;
  }
  async upsertCustomTopic(row: {
    id?: string;
    candidate_id: string;
    name: string;
    description?: string | null;
    keywords: string[];
    include_terms: string[];
    exclude_terms: string[];
    sources?: string[] | null;
    enabled: boolean;
  }) {
    if (!(await this.isStaff())) throw new Error("Solo el equipo de Active puede definir temas a medida");
    const name = row.name.trim();
    if (!name) throw new Error("Falta el nombre del tema");
    const now = new Date().toISOString();
    const list = this.data.custom_topics ?? [];
    if (row.id) {
      const idx = list.findIndex((t) => t.id === row.id && t.candidate_id === row.candidate_id);
      if (idx < 0) throw new Error("No está ese tema");
      const updated: CustomTopic = {
        ...list[idx],
        name,
        description: row.description ?? null,
        keywords: row.keywords,
        include_terms: row.include_terms,
        exclude_terms: row.exclude_terms,
        sources: row.sources ?? null,
        enabled: row.enabled,
        updated_at: now,
      };
      this.data.custom_topics = list.map((t, i) => (i === idx ? updated : t));
      return updated;
    }
    const rec: CustomTopic = {
      id: crypto.randomUUID(),
      candidate_id: row.candidate_id,
      name,
      description: row.description ?? null,
      keywords: row.keywords,
      include_terms: row.include_terms,
      exclude_terms: row.exclude_terms,
      sources: row.sources ?? null,
      enabled: row.enabled,
      created_at: now,
      updated_at: now,
    };
    this.data.custom_topics = [...list, rec];
    return rec;
  }
  async listCustomTopicSummaries(candidateId: string, topicId: string) {
    return (this.data.custom_topic_summaries ?? [])
      .filter((s) => s.candidate_id === candidateId && s.topic_id === topicId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async latestCustomTopicSummary(candidateId: string, topicId: string) {
    const all = await this.listCustomTopicSummaries(candidateId, topicId);
    return all[0] ?? null;
  }
  async saveCustomTopicSummary(row: Omit<CustomTopicSummary, "id" | "created_at"> & { id?: string; created_at?: string }) {
    const rec: CustomTopicSummary = {
      ...row,
      id: row.id ?? crypto.randomUUID(),
      created_at: row.created_at ?? new Date().toISOString(),
    };
    this.data.custom_topic_summaries = [...(this.data.custom_topic_summaries ?? []), rec];
    return rec;
  }
  async updateCustomTopicSummaryStatus(
    candidateId: string,
    topicId: string,
    summaryId: string,
    status: CustomTopicSummaryStatus,
  ) {
    const list = this.data.custom_topic_summaries ?? [];
    const idx = list.findIndex((s) => s.id === summaryId && s.candidate_id === candidateId && s.topic_id === topicId);
    if (idx < 0) throw new Error("No está ese resumen");
    this.data.custom_topic_summaries = list.map((s, i) =>
      i === idx ? { ...s, status, reviewed_at: new Date().toISOString() } : s,
    );
  }
}
