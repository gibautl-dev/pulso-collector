"use server";

import { revalidatePath } from "next/cache";
import { llmActionError, LLM_NOT_CONFIGURED_MESSAGE, type FormActionState } from "@/lib/form-action";
import { requireStaff } from "@/lib/context";
import { regionFor } from "@/lib/region";
import { MEDIA_SOURCES } from "@/lib/rivals";
import { llmConfigured, requestRivalSuggestions } from "@/lib/rival-suggest-llm";
import { hasDuplicatePending, slugifyName } from "@/lib/rival-suggest";
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

export async function suggestRivals(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  try {
    const { repo, candidates } = await requireStaff();
    const candidateId = String(formData.get("candidate_id") ?? "");
    const candidate = candidates.find((c) => c.id === candidateId);
    if (!candidate) return { ok: false, error: "Candidato inválido" };
    if (!llmConfigured()) return { ok: false, error: LLM_NOT_CONFIGURED_MESSAGE };
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
    return { ok: true, message: "Sugerencias listas para revisar. No se agregó ningún rival." };
  } catch (err) {
    return llmActionError(err);
  }
}

export async function addPendingCandidate(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  try {
    const { repo, candidates } = await requireStaff();
    const candidateId = String(formData.get("candidate_id") ?? "");
    if (!candidates.some((c) => c.id === candidateId)) return { ok: false, error: "Candidato inválido" };
    const name = String(formData.get("name") ?? "").trim();
    const rawLevel = String(formData.get("level") ?? "comparativo");
    const level: RivalLevel = isRivalLevel(rawLevel) ? rawLevel : "comparativo";
    const reason = String(formData.get("reason") ?? "").trim() || null;
    const arena = String(formData.get("arena") ?? "").trim() || null;
    const sourceRaw = String(formData.get("source") ?? "manual");
    const source = sourceRaw === "ai_suggestion" ? "ai_suggestion" : "manual";
    if (!name) return { ok: false, error: "Falta el nombre del rival" };
    const existing = await repo.listPendingCandidates(candidateId);
    if (hasDuplicatePending(name, existing, candidateId)) {
      return { ok: false, error: `Ya hay un pedido de alta para ${name} en este candidato.` };
    }
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
    return { ok: true, message: `Pedido enviado: ${name} queda pendiente` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/ya hay un pedido|ya está pedido|ya está en Pulso/i.test(msg)) {
      return { ok: false, error: msg };
    }
    return { ok: false, error: "No se pudo guardar el pedido. Probá de nuevo." };
  }
}

export async function approvePendingCandidate(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  try {
    const { repo } = await requireStaff();
    const id = String(formData.get("pending_id") ?? "");
    if (!id) return { ok: false, error: "Falta el pedido" };
    const row = await repo.approvePendingCandidate(id);
    revalidatePath("/admin/rivales");
    return {
      ok: true,
      message: `${row.name} quedó aprobado, listo para recolectar. Todavía no se empezó a recolectar.`,
    };
  } catch {
    return { ok: false, error: "No se pudo aprobar el pedido." };
  }
}

export async function deletePendingCandidate(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  try {
    const { repo } = await requireStaff();
    const id = String(formData.get("pending_id") ?? "");
    const name = String(formData.get("name") ?? "el rival").trim() || "el rival";
    if (!id) return { ok: false, error: "Falta el pedido" };
    await repo.deletePendingCandidate(id);
    revalidatePath("/admin/rivales");
    return { ok: true, message: `Se borró el pedido de alta de ${name}.` };
  } catch {
    return { ok: false, error: "No se pudo borrar el pedido." };
  }
}
