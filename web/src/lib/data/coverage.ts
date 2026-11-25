import "server-only";
import type { PulsoRepo } from "./repo";
import {
  coverageStarts,
  MENTION_SOURCE_CATALOG,
  sourcesNeedingFirstCollected,
  type SubjectCoverage,
} from "@/lib/comparison-window";

/** Inicio de cobertura por fuente de un candidato (ver comparison-window.ts). */
export async function loadCoverage(repo: PulsoRepo, candidateId: string): Promise<SubjectCoverage> {
  const rows = await repo.listCandidateSources(candidateId);
  const missing = sourcesNeedingFirstCollected(rows, MENTION_SOURCE_CATALOG);
  const first = missing.length ? await repo.firstCollectedBySource(candidateId, missing) : {};
  return { id: candidateId, starts: coverageStarts(rows, first) };
}
