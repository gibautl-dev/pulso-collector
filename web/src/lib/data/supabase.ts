import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { NEGATIVE_TONES } from "@/lib/labels";
import { dateBounds, type MentionFilters } from "@/lib/filters";
import type { Candidate, CandidateSource, Mention, SourceRun, Topic } from "@/lib/types";
import type { MentionPage, PulsoRepo } from "./repo";

// Columnas explícitas: nunca pedimos settings/cursor de candidate_sources
// (pueden contener URLs privadas) ni nada que la app no muestre.
const MENTION_COLS =
  "id,candidate_id,source,url,title,content,author,outlet,published_at,collected_at,account_relation,tone,tone_reason,tone_confidence,target,topic_id,relevance,classified_at,classification_model,classification_prompt_version";
const MENTION_LIST_COLS =
  "id,candidate_id,source,url,title,outlet,published_at,collected_at,account_relation,tone,tone_confidence,target,topic_id,relevance,classified_at,content,author,tone_reason,classification_model,classification_prompt_version";
const SOURCE_COLS =
  "candidate_id,source,enabled,interval_seconds,last_attempt_at,last_success_at,collection_started_at,earliest_observed_at,latest_observed_at,coverage_status";
const RUN_COLS = "id,candidate_id,source,run_kind,started_at,finished_at,status,items_found,items_new,error";

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Error leyendo ${what}: ${res.error.message}`);
  return res.data as T;
}

export class SupabaseRepo implements PulsoRepo {
  readonly mode = "supabase" as const;
  private constructor(private readonly db: SupabaseClient) {}

  static async create(): Promise<SupabaseRepo> {
    return new SupabaseRepo(await createClient());
  }

  /** Para tests de humo: usar un cliente ya armado. */
  static fromClient(db: SupabaseClient): SupabaseRepo {
    return new SupabaseRepo(db);
  }

  async listCandidates() {
    return check<Candidate[]>(
      await this.db.from("candidates").select("id,slug,name").order("name"),
      "candidatos",
    );
  }
  async getCandidate(slug: string) {
    return check<Candidate | null>(
      await this.db.from("candidates").select("id,slug,name").eq("slug", slug).maybeSingle(),
      "candidato",
    );
  }
  async listTopics(candidateId: string) {
    return check<Topic[]>(
      await this.db.from("topics").select("id,candidate_id,label").eq("candidate_id", candidateId).order("label"),
      "temas",
    );
  }
  async mentionsSince(candidateId: string, sinceIso: string) {
    // v1: agregamos en el servidor de la app; el volumen actual es chico.
    // Con más volumen, pasar a vistas/RPC con security_invoker.
    return check<Mention[]>(
      await this.db
        .from("mentions")
        .select(MENTION_COLS)
        .eq("candidate_id", candidateId)
        .gte("published_at", sinceIso)
        .order("published_at", { ascending: false })
        .limit(5000),
      "menciones",
    );
  }
  async searchMentions(candidateId: string, f: MentionFilters, pageSize: number): Promise<MentionPage> {
    let q = this.db
      .from("mentions")
      .select(MENTION_LIST_COLS, { count: "exact" })
      .eq("candidate_id", candidateId);
    if (f.tone === "pendiente") q = q.is("tone", null);
    else if (f.tone === "negativas") q = q.in("tone", NEGATIVE_TONES);
    else if (f.tone) q = q.eq("tone", f.tone);
    if (f.target) q = q.eq("target", f.target);
    if (f.topic) q = q.eq("topic_id", f.topic);
    if (f.source) q = q.eq("source", f.source);
    if (f.relevance) q = q.eq("relevance", f.relevance);
    const { gte, lt } = dateBounds(f);
    if (gte) q = q.gte("published_at", gte);
    if (lt) q = q.lt("published_at", lt);
    if (f.q) q = q.or(`title.ilike."*${f.q}*",content.ilike."*${f.q}*"`); // f.q ya sanitizado
    const from = (f.page - 1) * pageSize;
    const res = await q.order("published_at", { ascending: false }).range(from, from + pageSize - 1);
    if (res.error) throw new Error(`Error leyendo menciones: ${res.error.message}`);
    return { items: (res.data ?? []) as unknown as Mention[], total: res.count ?? 0 };
  }
  async getMention(candidateId: string, id: string) {
    return check<Mention | null>(
      await this.db.from("mentions").select(MENTION_COLS).eq("candidate_id", candidateId).eq("id", id).maybeSingle(),
      "mención",
    );
  }
  async listSourceRuns(candidateId: string, limit: number) {
    return check<SourceRun[]>(
      await this.db
        .from("source_runs")
        .select(RUN_COLS)
        .eq("candidate_id", candidateId)
        .order("started_at", { ascending: false })
        .limit(limit),
      "corridas",
    );
  }
  async listCandidateSources(candidateId: string) {
    return check<CandidateSource[]>(
      await this.db.from("candidate_sources").select(SOURCE_COLS).eq("candidate_id", candidateId).order("source"),
      "fuentes",
    );
  }
  async dataTimestamp() {
    return null;
  }
}
