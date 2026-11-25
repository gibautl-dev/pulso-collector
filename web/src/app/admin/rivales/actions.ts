"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/context";
import { regionFor } from "@/lib/region";
import { MEDIA_SOURCES } from "@/lib/rivals";
import { requestRivalSuggestions } from "@/lib/rival-suggest-llm";
import { slugifyName } from "@/lib/rival-suggest";
import { isRivalLevel, type RivalLevel } from "@/lib/types";

export async function saveRivals(formData: FormData): Promise<void> {
  const { repo, candidates } = await requireStaff();
  const candidateId = String(formData.get("candidate_id") ?? "");
  if (!candidates.some((c) => c.id === candidateId)) {
    throw new Error("Candidato inválido");
  }
  const known = new Set(candidates.map((c) => c.id));
  const selected = formData.getAll("rival_id").map((v) => String(v));
  const rows: { rival_id: string; level: RivalLevel }[] = [];
  for (const rivalId of selected) {
    if (rivalId === candidateId || !known.has(rivalId)) continue;
    const raw = String(formData.get(`level_${rivalId}`) ?? "comparativo");
    const level: RivalLevel = isRivalLevel(raw) ? raw : "comparativo";
    rows.push({ rival_id: rivalId, level });
  }
  await repo.replaceRivals(candidateId, rows);
  revalidatePath("/admin/rivales");
  const candidate = candidates.find((c) => c.id === candidateId);
  if (candidate) revalidatePath(`/c/${candidate.slug}/comparacion`);
}

export async function suggestRivals(formData: FormData): Promise<void> {
  const { repo, candidates } = await requireStaff();
  const candidateId = String(formData.get("candidate_id") ?? "");
  const candidate = candidates.find((c) => c.id === candidateId);
  if (!candidate) throw new Error("Candidato inválido");
  const region = regionFor(candidate.slug);
  const ts = await repo.dataTimestamp();
  const now = ts ? new Date(ts) : new Date();
  const since = new Date(now.getTime() - 14 * 86400000).toISOString();
  const [topics, mentions] = await Promise.all([
    repo.listTopics(candidate.id),
    repo.mentionsSince(candidate.id, since),
  ]);
  const headlines = mentions
    .filter((m) => MEDIA_SOURCES.has(m.source) || m.account_relation === "third_party")
    .slice()
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .map((m) => [m.outlet, m.title].filter(Boolean).join(": "))
    .filter(Boolean)
    .slice(0, 40);
  const result = await requestRivalSuggestions(
    {
      candidate,
      region,
      topics: topics.map((t) => t.label),
      headlines,
      measuredCandidates: candidates.map((c) => ({
        name: c.name,
        slug: c.slug,
        countryName: regionFor(c.slug).countryName,
      })),
    },
    candidates,
  );
  await repo.saveSuggestionRun({
    candidate_id: candidate.id,
    prompt_version: result.prompt_version,
    model: result.model,
    suggestions: result.suggestions,
    cost_usd: result.cost_usd,
    usage: result.usage,
    origin: "ai",
    note: null,
  });
  revalidatePath("/admin/rivales");
}

export async function addPendingCandidate(formData: FormData): Promise<void> {
  const { repo, candidates } = await requireStaff();
  const candidateId = String(formData.get("candidate_id") ?? "");
  if (!candidates.some((c) => c.id === candidateId)) throw new Error("Candidato inválido");
  const name = String(formData.get("name") ?? "").trim();
  const rawLevel = String(formData.get("level") ?? "comparativo");
  const level: RivalLevel = isRivalLevel(rawLevel) ? rawLevel : "comparativo";
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const arena = String(formData.get("arena") ?? "").trim() || null;
  const sourceRaw = String(formData.get("source") ?? "manual");
  const source = sourceRaw === "ai_suggestion" ? "ai_suggestion" : "manual";
  if (!name) throw new Error("Falta el nombre del rival");
  await repo.addPendingCandidate({
    name,
    slug: slugifyName(name),
    arena,
    requested_for_candidate_id: candidateId,
    requested_level: level,
    source,
    reason,
  });
  revalidatePath("/admin/rivales");
}
