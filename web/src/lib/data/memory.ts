import { applyFilters, type MentionFilters } from "@/lib/filters";
import type { AiAnswer, Candidate, CandidateSource, Mention, MetaAd, SourceRun, SuspiciousAccount, SuspiciousFilters, SuspiciousStatus, Topic } from "@/lib/types";
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
  async dataTimestamp() {
    return this.data.exported_at ?? null;
  }
}
