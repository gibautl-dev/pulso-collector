import { applyFilters, type MentionFilters } from "@/lib/filters";
import type { AiAnswer, Candidate, CandidateRival, CandidateSource, CrisisAlert, CrisisBrief, CrisisStatus, Mention, MetaAd, MetaAdsSettings, GoogleAd, GoogleAdsSettings, WikipediaPageview, WikipediaPageviewSettings, PendingCandidate, PendingCandidateSource, RecordedDailyCost, RivalLevel, RivalSuggestionRun, SourceRun, SuspiciousAccount, SuspiciousFilters, SuspiciousStatus, Topic, CustomTopic, CustomTopicSummary, CustomTopicSummaryStatus, DailyBrief, InconsistencyAlert, InconsistencyScan, ResponseSimulation, ResponseSimulationFinish, AssistantQuestion, AssistantQuota, AssistantRunRecord } from "@/lib/types";
import type { SpendReport } from "@/lib/spend";
import { SIMULATOR_LIMITS_DEFAULT, checkQuota, type SimulatorLimits } from "@/lib/response-simulator";
import { dayKey, startOfDay } from "@/lib/time";
import { hasDuplicatePending, matchExistingCandidate, slugifyName } from "@/lib/rival-suggest";
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
  google_ads?: GoogleAd[];
  google_ads_settings?: GoogleAdsSettings[];
  wikipedia_pageviews?: WikipediaPageview[];
  wikipedia_pageview_settings?: WikipediaPageviewSettings[];
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
  daily_briefs?: DailyBrief[];
  inconsistency_alerts?: InconsistencyAlert[];
  inconsistency_scans?: InconsistencyScan[];
  response_simulations?: ResponseSimulation[];
  /** Topes del simulador. undefined = valores por defecto; null = migración sin aplicar. */
  simulator_limits?: SimulatorLimits | null;
  /** Preguntas al asistente del usuario local (modo fixture). */
  assistant_questions?: (AssistantQuestion & { cost_usd?: number | null })[];
  /** Panel Gasto exportado de la base (solo lectura). undefined/null = sin datos. */
  spend_report?: SpendReport | null;
  /** Modo local: simula que hoy se alcanzó el tope de En la IA. */
  ai_visibility_cap_reached_today?: boolean | string[];
}

/** Usuario del modo local (sin login). */
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";




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
  async firstCollectedBySource(candidateId: string, sources: readonly string[]) {
    const out: Record<string, string | null> = {};
    for (const source of sources) {
      let first: string | null = null;
      for (const m of this.data.mentions) {
        if (m.candidate_id !== candidateId || m.source !== source || !m.collected_at) continue;
        if (first == null || new Date(m.collected_at).getTime() < new Date(first).getTime()) first = m.collected_at;
      }
      out[source] = first;
    }
    return out;
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


  async listGoogleAds(candidateId: string) {
    return (this.data.google_ads ?? [])
      .filter((a) => a.candidate_id === candidateId)
      .slice()
      .sort((a, b) => {
        const aEnd = a.last_served_at ?? a.date_range_end ?? a.fetched_at;
        const bEnd = b.last_served_at ?? b.date_range_end ?? b.fetched_at;
        return bEnd.localeCompare(aEnd) || a.ad_id.localeCompare(b.ad_id);
      });
  }
  async listGoogleAdsSettings(candidateId: string) {
    return (this.data.google_ads_settings ?? []).find((s) => s.candidate_id === candidateId) ?? null;
  }
  async listWikipediaPageviews(candidateId: string) {
    return (this.data.wikipedia_pageviews ?? [])
      .filter((r) => r.candidate_id === candidateId)
      .slice()
      .sort((a, b) => a.day.localeCompare(b.day));
  }
  async listWikipediaPageviewSettings(candidateId: string) {
    return (this.data.wikipedia_pageview_settings ?? []).find((s) => s.candidate_id === candidateId) ?? null;
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
  async listDailyBriefs(candidateId: string, limit: number) {
    return (this.data.daily_briefs ?? [])
      .filter((b) => b.candidate_id === candidateId)
      .slice()
      .sort((a, b) => b.brief_date.localeCompare(a.brief_date))
      .slice(0, limit);
  }
  async listInconsistencyAlerts(candidateId: string) {
    return (this.data.inconsistency_alerts ?? [])
      .filter((a) => a.candidate_id === candidateId)
      .slice()
      .sort((a, b) => b.detected_at.localeCompare(a.detected_at) || b.later.published_at.localeCompare(a.later.published_at));
  }
  async getInconsistencyScan(candidateId: string) {
    return (this.data.inconsistency_scans ?? []).find((s) => s.candidate_id === candidateId) ?? null;
  }
  async updateInconsistencyAlertStatus(candidateId: string, id: string, status: CrisisStatus, note: string | null) {
    const alert = (this.data.inconsistency_alerts ?? []).find((a) => a.candidate_id === candidateId && a.id === id);
    if (!alert) throw new Error("Alerta no encontrada");
    alert.status = status;
    alert.status_note = note;
    alert.status_updated_at = new Date().toISOString();
  }
  async assistantQuota(): Promise<AssistantQuota | null> {
    const rows = this.data.assistant_questions ?? [];
    const now = Date.now();
    const hour = rows.filter((r) => now - new Date(r.created_at).getTime() < 3600000).length;
    const day = rows.filter((r) => now - new Date(r.created_at).getTime() < 86400000);
    return {
      user_last_hour: hour,
      user_today: day.length,
      total_today: day.length,
      cost_today_usd: day.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
    };
  }
  async startAssistantQuestion(row: { candidate_id: string; question: string; page: string | null; prompt_version: string }) {
    const saved = {
      id: crypto.randomUUID(),
      candidate_id: row.candidate_id,
      question: row.question,
      page: row.page,
      status: "pending",
      answer: null,
      created_at: new Date().toISOString(),
    };
    this.data.assistant_questions = [...(this.data.assistant_questions ?? []), saved];
    return { id: saved.id, created_at: saved.created_at };
  }
  async finishAssistantQuestion(id: string, record: AssistantRunRecord) {
    const row = (this.data.assistant_questions ?? []).find((r) => r.id === id && r.status === "pending");
    if (!row) throw new Error("Pregunta no encontrada");
    row.status = record.status;
    row.answer = record.answer;
    row.cost_usd = record.cost_usd;
  }
  async listAssistantQuestions(candidateId: string, limit: number) {
    return (this.data.assistant_questions ?? [])
      .filter((r) => r.candidate_id === candidateId && r.status !== "pending")
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((r) => ({ id: r.id, candidate_id: r.candidate_id, question: r.question, status: r.status, answer: r.answer, page: r.page ?? null, created_at: r.created_at }));
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
  async getSpendReport(from: string, to: string): Promise<SpendReport | null> {
    if (!(await this.isStaff())) throw new Error("Solo el equipo de Active puede ver el gasto");
    const r = this.data.spend_report;
    if (!r) return null;
    return {
      ...r,
      from,
      to,
      rows: r.rows.filter((x) => x.day >= from && x.day <= to),
      x_usage: r.x_usage.filter((x) => x.quota_date >= from && x.quota_date <= to),
    };
  }
  async updateAiVisibilityDailyCap(candidateId: string, usd: number) {
    if (!(await this.isStaff())) throw new Error("Solo el equipo de Active puede cambiar el tope");
    if (!Number.isFinite(usd) || usd < 0 || usd > 50) throw new Error("Tope inválido");
    if (!this.visibleCandidates().some((c) => c.id === candidateId)) throw new Error("Candidato no válido");
    const r = this.data.spend_report;
    if (r) {
      const list = [...(r.caps?.ai_visibility_candidate_budgets ?? [])];
      const i = list.findIndex((x) => x.candidate_id === candidateId);
      const row = { candidate_id: candidateId, daily_budget_usd: usd, last_reached_on: i >= 0 ? list[i].last_reached_on : null, updated_at: new Date().toISOString() };
      if (i >= 0) list[i] = row;
      else list.push(row);
      r.caps = { ...r.caps, ai_visibility_candidate_budgets: list };
    }
  }
  async aiVisibilityCapReachedToday(candidateId: string) {
    const v = this.data.ai_visibility_cap_reached_today;
    return v === true || (Array.isArray(v) && v.includes(candidateId));
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

  async approvePendingCandidate(id: string, approvedBy?: string | null, _options?: { enableIa?: boolean }) {
    if (!(await this.isStaff())) throw new Error("Solo el equipo de Active puede aprobar un alta");
    const rec = (this.data.pending_candidates ?? []).find((p) => p.id === id);
    if (!rec || rec.status === "borrado") throw new Error("No está ese pedido de alta");
    const parent = this.visibleCandidates().find((c) => c.id === rec.requested_for_candidate_id);
    if (!parent) throw new Error("Candidato inválido");
    const slug = rec.slug && rec.slug.length > 0 ? rec.slug : slugifyName(rec.name);
    const known = this.visibleCandidates();
    let rival = matchExistingCandidate(rec.name, known) ?? known.find((c) => c.slug === slug) ?? null;
    let created = false;
    if (!rival) {
      rival = { id: crypto.randomUUID(), slug, name: rec.name.trim() };
      this.data.candidates = [...(this.data.candidates ?? [this.data.candidate]), rival];
      created = true;
    }
    if (rival.id === parent.id) throw new Error("Un candidato no puede ser rival de sí mismo");
    const now = new Date().toISOString();
    const sources = [...(this.data.candidate_sources ?? [])];
    const upsert = (source: string, enabled: boolean) => {
      const idx = sources.findIndex((s) => s.candidate_id === rival!.id && s.source === source);
      if (idx >= 0) {
        sources[idx] = { ...sources[idx], enabled: source === "rss_media" || source === "google_news" ? true : (created ? false : sources[idx].enabled) };
      } else if (source === "rss_media" || source === "google_news" || created) {
        sources.push({
          candidate_id: rival!.id,
          source,
          enabled,
          interval_seconds: 1200,
          last_attempt_at: null,
          last_success_at: null,
          collection_started_at: null,
          earliest_observed_at: null,
          latest_observed_at: null,
          coverage_status: "unknown",
        });
      }
    };
    upsert("rss_media", true);
    upsert("google_news", true);
    if (created) {
      for (const extra of ["x", "youtube", "llm", "google_alerts", "facebook", "instagram", "gdelt", "serp"]) {
        upsert(extra, false);
      }
    }
    this.data.candidate_sources = sources;
    const rivals = [...(this.data.candidate_rivals ?? [])];
    const existing = rivals.find((r) => r.candidate_id === parent.id && r.rival_id === rival!.id);
    if (existing) existing.level = rec.requested_level;
    else rivals.push({ candidate_id: parent.id, rival_id: rival.id, level: rec.requested_level, created_at: now });
    this.data.candidate_rivals = rivals;
    rec.status = "aprobado";
    rec.approved_at = rec.approved_at ?? now;
    rec.approved_by = rec.approved_by ?? approvedBy ?? null;
    rec.slug = rec.slug ?? slug;
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

  async getSimulatorLimits() {
    if (this.data.simulator_limits === null) return null;
    return this.data.simulator_limits ?? { ...SIMULATOR_LIMITS_DEFAULT };
  }
  async listResponseSimulations(candidateId: string, limit: number) {
    return (this.data.response_simulations ?? [])
      .filter((r) => r.candidate_id === candidateId && r.user_id === LOCAL_USER_ID)
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  async getResponseSimulation(candidateId: string, id: string) {
    return (
      (this.data.response_simulations ?? []).find(
        (r) => r.id === id && r.candidate_id === candidateId && r.user_id === LOCAL_USER_ID,
      ) ?? null
    );
  }
  async startResponseSimulation(candidateId: string, draft: string, reserveUsd: number) {
    const limits = await this.getSimulatorLimits();
    if (!limits) throw new Error("pulso:disabled");
    if (!this.visibleCandidates().some((c) => c.id === candidateId)) throw new Error("pulso:forbidden");
    const now = new Date();
    const reserve = Math.max(reserveUsd, limits.maxRequestUsd / 10);
    const err = checkQuota({
      rows: this.data.response_simulations ?? [],
      userId: LOCAL_USER_ID,
      now,
      reserveUsd: reserve,
      limits,
      dayStart: new Date(startOfDay(dayKey(now))),
    });
    if (err) throw new Error(`pulso:${err}`);
    const rec: ResponseSimulation = {
      id: crypto.randomUUID(),
      candidate_id: candidateId,
      user_id: LOCAL_USER_ID,
      draft,
      status: "running",
      output: {},
      context: {},
      model: null,
      prompt_version: null,
      reserved_usd: reserve,
      cost_usd: null,
      error: null,
      origin: "ai",
      created_at: now.toISOString(),
      finished_at: null,
    };
    this.data.response_simulations = [...(this.data.response_simulations ?? []), rec];
    return rec.id;
  }
  async finishResponseSimulation(id: string, row: ResponseSimulationFinish) {
    const list = this.data.response_simulations ?? [];
    const idx = list.findIndex((r) => r.id === id && r.user_id === LOCAL_USER_ID && r.status === "running");
    if (idx < 0) throw new Error("pulso:not_found");
    this.data.response_simulations = list.map((r, i) =>
      i === idx
        ? {
            ...r,
            status: row.status,
            output: row.status === "ok" ? row.output : {},
            context: row.context,
            model: row.model,
            prompt_version: row.prompt_version,
            cost_usd: row.cost_usd,
            error: row.error,
            finished_at: new Date().toISOString(),
          }
        : r,
    );
  }
}
