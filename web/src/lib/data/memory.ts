import { applyFilters, type MentionFilters } from "@/lib/filters";
import type { Candidate, CandidateSource, Mention, SourceRun, Topic } from "@/lib/types";
import type { MentionPage, PulsoRepo } from "./repo";

export interface FixtureData {
  exported_at?: string;
  candidate: Candidate;
  topics: Topic[];
  mentions: Mention[];
  source_runs: SourceRun[];
  candidate_sources: CandidateSource[];
}

/** Repositorio en memoria: usado por el modo fixture y los tests. */
export class MemoryRepo implements PulsoRepo {
  readonly mode = "fixture" as const;
  constructor(private readonly data: FixtureData) {}

  async listCandidates() {
    return [this.data.candidate];
  }
  async getCandidate(slug: string) {
    return this.data.candidate.slug === slug ? this.data.candidate : null;
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
  async dataTimestamp() {
    return this.data.exported_at ?? null;
  }
}
