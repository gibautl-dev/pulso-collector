import "server-only";
import type { PulsoRepo } from "@/lib/data/repo";
import { regionFor } from "@/lib/region";
import type { Candidate } from "@/lib/types";

/** Datos del panel: null si el asistente no está habilitado (falta la migración). */
export async function loadAssistantPanel(repo: PulsoRepo, candidate: Candidate) {
  const quota = await repo.assistantQuota().catch(() => null);
  if (!quota) return null;
  const [history, topics, rivals] = await Promise.all([
    repo.listAssistantQuestions(candidate.id, 10),
    repo.listTopics(candidate.id),
    repo.listRivals(candidate.id),
  ]);
  const labels = topics.map((t) => t.label);
  const topTopic = labels.find((l) => /econom/i.test(l)) ?? labels.find((l) => l !== "otros") ?? null;
  const rival = rivals[0] ? await repo.getCandidateById(rivals[0].rival_id) : null;
  const region = regionFor(candidate.slug);
  return {
    slug: candidate.slug,
    candidateName: candidate.name,
    initial: history.slice().reverse(),
    suggestionInput: {
      candidateName: candidate.name,
      topTopic,
      rival: rival?.name ?? null,
      hasAds: region.showMetaAds || region.showGoogleAds,
    },
  };
}
