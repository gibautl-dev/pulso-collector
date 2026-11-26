import "server-only";
import { loadCoverage } from "@/lib/data/coverage";
import type { PulsoRepo } from "@/lib/data/repo";
import { regionFor } from "@/lib/region";
import { clockFor } from "@/lib/time";
import type { Candidate } from "@/lib/types";
import type { AssistantDataSource } from "./agent";
import type { AdsData, MentionsData, RivalData } from "./tools";

const DAY_MS = 86400000;
/** 2 × 30 días: alcanza para la variación del período más largo. */
const LOOKBACK_DAYS = 60;

function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
}

/**
 * Datos del asistente leídos con el repo de la sesión: en producción es el
 * cliente de Supabase del usuario logueado, así que RLS decide qué ve.
 */
export function repoDataSource(repo: PulsoRepo, candidate: Candidate, now: Date): AssistantDataSource {
  const clock = clockFor(candidate.slug, candidate.country);
  const region = regionFor(candidate.slug, candidate.country);
  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString();
  const topics = once(() => repo.listTopics(candidate.id));
  const mentions = once(async (): Promise<MentionsData> => {
    const [rows, t, cov] = await Promise.all([repo.mentionsSince(candidate.id, since), topics(), loadCoverage(repo, candidate.id)]);
    return { candidate, mentions: rows, topics: t, coverage: cov.starts, now, clock };
  });
  const briefs = once(() => repo.listDailyBriefs(candidate.id, 7));
  const ads = once(async (): Promise<AdsData> => {
    const [meta, google] = await Promise.all([
      region.showMetaAds ? repo.listMetaAds(candidate.id) : Promise.resolve(null),
      region.showGoogleAds ? repo.listGoogleAds(candidate.id) : Promise.resolve(null),
    ]);
    return { candidate, meta, google, now, clock };
  });
  const rivals = once(async (): Promise<RivalData[]> => {
    const rows = await repo.listRivals(candidate.id);
    const out: RivalData[] = [];
    for (const row of rows) {
      const rival = await repo.getCandidateById(row.rival_id);
      if (!rival) continue; // RLS: si no lo puede ver, no existe para el asistente.
      const [m, cov] = await Promise.all([repo.mentionsSince(rival.id, since), loadCoverage(repo, rival.id)]);
      out.push({ rival, level: row.level, mentions: m, coverage: cov.starts });
    }
    return out;
  });
  return { candidate, now, clock, topics, mentions, briefs, ads, rivals };
}

export async function rivalNames(repo: PulsoRepo, candidateId: string): Promise<string[]> {
  const rows = await repo.listRivals(candidateId);
  const names: string[] = [];
  for (const r of rows) {
    const c = await repo.getCandidateById(r.rival_id);
    if (c) names.push(c.name);
  }
  return names;
}
