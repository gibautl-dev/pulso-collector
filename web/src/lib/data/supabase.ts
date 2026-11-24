import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { NEGATIVE_TONES } from "@/lib/labels";
import { dateBounds, type MentionFilters } from "@/lib/filters";
import type { AiAnswer, Candidate, CandidateSource, CrisisAlert, CrisisBrief, CrisisStatus, Mention, MetaAd, SourceRun, SuspiciousAccount, SuspiciousFilters, SuspiciousStatus, Topic } from "@/lib/types";
import { asCitations, asStringList } from "@/lib/ai-visibility";
import { normalizeMetaAd } from "@/lib/meta-ads";
import type { MentionPage, PulsoRepo } from "./repo";

// Columnas explícitas: nunca pedimos settings/cursor de candidate_sources
// (pueden contener URLs privadas) ni nada que la app no muestre.
const MENTION_COLS =
  "id,candidate_id,source,url,title,content,author,author_handle,outlet,published_at,collected_at,account_relation,tone,tone_reason,tone_confidence,target,topic_id,relevance,classified_at,classification_model,classification_prompt_version,metrics";
const MENTION_LIST_COLS =
  "id,candidate_id,source,url,title,outlet,published_at,collected_at,account_relation,tone,tone_confidence,target,topic_id,relevance,classified_at,content,author,author_handle,tone_reason,classification_model,classification_prompt_version,metrics";
const SOURCE_COLS =
  "candidate_id,source,enabled,interval_seconds,last_attempt_at,last_success_at,collection_started_at,earliest_observed_at,latest_observed_at,coverage_status";
const RUN_COLS = "id,candidate_id,source,run_kind,started_at,finished_at,status,items_found,items_new,error";
const META_AD_COLS =
  "id,candidate_id,ad_id,page_id,page_name,bylines,publisher_platforms,currency,spend_lower,spend_upper,impressions_lower,impressions_upper,ad_creative_bodies,ad_creative_link_titles,ad_snapshot_url,ad_creation_time,ad_delivery_start_time,ad_delivery_stop_time,fetched_at,fetched_on";
const SUSPICIOUS_COLS =
  "id,candidate_id,platform,account_key,handle,display_name,profile_url,score,signals,mention_count,first_seen_at,last_seen_at,account_created_at,status,status_note,status_updated_at,detected_at";

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
  async listSuspiciousAccounts(candidateId: string, filters: SuspiciousFilters = {}) {
    let q = this.db
      .from("suspicious_accounts_web")
      .select(SUSPICIOUS_COLS)
      .eq("candidate_id", candidateId);
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.platform) q = q.eq("platform", filters.platform);
    const rows = check<SuspiciousAccount[]>(
      await q.order("score", { ascending: false }).order("detected_at", { ascending: false }),
      "cuentas sospechosas",
    );
    return rows.map((row) => ({
      ...row,
      signals: Array.isArray(row.signals) ? row.signals : [],
    }));
  }
  async updateSuspiciousStatus(candidateId: string, id: string, status: SuspiciousStatus, note: string | null) {
    // Solo columnas de estado: el trigger completa status_updated_at/by con la sesión.
    const res = await this.db
      .from("suspicious_accounts")
      .update({ status, status_note: note })
      .eq("candidate_id", candidateId)
      .eq("id", id)
      .select("id");
    if (res.error) throw new Error(`Error actualizando el estado: ${res.error.message}`);
    if (!res.data?.length) throw new Error("No se pudo actualizar la cuenta");
  }
  async listAiAnswers(candidateId: string) {
    const rows = check<AiAnswer[]>(
      await this.db
        .from("ai_answers")
        .select("id,candidate_id,provider,model,prompt_key,prompt,answer,citations,balance,balance_reason,positives,negatives,topics,other_politicians,asked_at,asked_on,cost,classification_model")
        .eq("candidate_id", candidateId)
        .order("asked_on", { ascending: false })
        .order("prompt_key", { ascending: true })
        .limit(400),
      "respuestas en IA",
    );
    return rows.map((row) => ({
      ...row,
      citations: asCitations(row.citations),
      positives: asStringList(row.positives),
      negatives: asStringList(row.negatives),
      topics: asStringList(row.topics),
      other_politicians: asStringList(row.other_politicians),
    }));
  }
  async listMetaAds(candidateId: string) {
    const rows = check<MetaAd[]>(
      await this.db
        .from("meta_ads")
        .select(META_AD_COLS)
        .eq("candidate_id", candidateId)
        .order("ad_delivery_start_time", { ascending: false, nullsFirst: false })
        .order("ad_id", { ascending: true })
        .limit(5000),
      "anuncios de Meta",
    );
    const classified = await this.mergeAdClassifications(candidateId, rows);
    return classified.map(normalizeMetaAd);
  }

  async listCrisisAlerts(candidateId: string) {
    const alerts = check<CrisisAlert[]>(
      await this.db
        .from("crisis_alerts")
        .select("id,candidate_id,trigger_type,trigger_key,cluster_label,topic_id,window_start,window_end,severity,metrics,status,status_note,status_updated_at,status_updated_by,first_detected_at,last_detected_at,created_at")
        .eq("candidate_id", candidateId)
        .order("last_detected_at", { ascending: false })
        .limit(200),
      "alertas de acción",
    );
    if (alerts.length === 0) return alerts;
    const briefs = check<CrisisBrief[]>(
      await this.db
        .from("crisis_briefs")
        .select("id,alert_id,candidate_id,prompt_version,model,risk_level,title,input_ref,output,cost_usd,usage,created_at")
        .eq("candidate_id", candidateId)
        .in("alert_id", alerts.map((a) => a.id))
        .order("created_at", { ascending: false })
        .limit(500),
      "briefs de acción",
    );
    const latest = new Map<string, CrisisBrief>();
    for (const brief of briefs) {
      if (!latest.has(brief.alert_id)) latest.set(brief.alert_id, brief);
    }
    return alerts.map((alert) => ({ ...alert, latest_brief: latest.get(alert.id) ?? null }));
  }
  async getCrisisAlert(candidateId: string, id: string) {
    const alerts = await this.listCrisisAlerts(candidateId);
    return alerts.find((a) => a.id === id) ?? null;
  }
  async listCrisisBriefs(candidateId: string, alertId: string) {
    return check<CrisisBrief[]>(
      await this.db
        .from("crisis_briefs")
        .select("id,alert_id,candidate_id,prompt_version,model,risk_level,title,input_ref,output,cost_usd,usage,created_at")
        .eq("candidate_id", candidateId)
        .eq("alert_id", alertId)
        .order("created_at", { ascending: false }),
      "versiones del brief",
    );
  }
  async updateCrisisAlertStatus(candidateId: string, id: string, status: CrisisStatus, note: string | null) {
    const { data: session } = await this.db.auth.getUser();
    const res = await this.db
      .from("crisis_alerts")
      .update({
        status,
        status_note: note,
        status_updated_at: new Date().toISOString(),
        status_updated_by: session.user?.id ?? null,
      })
      .eq("candidate_id", candidateId)
      .eq("id", id)
      .select("id");
    if (res.error) throw new Error(`Error actualizando el estado: ${res.error.message}`);
    if (!res.data?.length) throw new Error("No se pudo actualizar la alerta");
  }

  async dataTimestamp() {
    return null;
  }

  /**
   * Une la clasificación si la tabla existe. Si la migración todavía no se
   * aplicó, PostgREST responde error y devolvemos los anuncios sin etiqueta.
   */
  private async mergeAdClassifications(candidateId: string, rows: MetaAd[]): Promise<MetaAd[]> {
    if (rows.length === 0) return rows;
    const res = await this.db
      .from("meta_ad_classifications")
      .select("meta_ad_id,ad_id,stance,reason,confidence,classified_at,classification_model,classification_prompt_version")
      .eq("candidate_id", candidateId)
      .limit(5000);
    if (res.error || !res.data) return rows;
    const byMetaId = new Map<string, (typeof res.data)[number]>();
    const byAdId = new Map<string, (typeof res.data)[number]>();
    for (const row of res.data) {
      const rec = row as { meta_ad_id?: string; ad_id?: string };
      if (rec.meta_ad_id) byMetaId.set(rec.meta_ad_id, row);
      if (rec.ad_id) byAdId.set(rec.ad_id, row);
    }
    return rows.map((ad) => {
      const hit = byMetaId.get(ad.id) ?? byAdId.get(ad.ad_id);
      if (!hit) return ad;
      const row = hit as {
        stance?: string;
        reason?: string | null;
        confidence?: number | string | null;
        classified_at?: string | null;
        classification_model?: string | null;
        classification_prompt_version?: string | null;
      };
      return {
        ...ad,
        stance: (row.stance as MetaAd["stance"]) ?? null,
        stance_reason: row.reason ?? null,
        stance_confidence: row.confidence ?? null,
        classified_at: row.classified_at ?? null,
        classification_model: row.classification_model ?? null,
        classification_prompt_version: row.classification_prompt_version ?? null,
      };
    });
  }
}
