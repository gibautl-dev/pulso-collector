"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/context";
import type { FormActionState } from "@/lib/form-action";
import { parseDailyCap } from "@/lib/spend";
import { slugifyName } from "@/lib/rival-suggest";
import { isCandidateCountry, isCollectionMode, isRivalLevel } from "@/lib/types";

function splitList(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function setCollectionPausedAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const { repo, candidates } = await requireStaff();
  const id = String(formData.get("candidate_id") ?? "");
  const paused = String(formData.get("paused") ?? "") === "true";
  const candidate = candidates.find((c) => c.id === id);
  if (!candidate) return { ok: false, error: "Candidato inválido." };
  try {
    await repo.setCandidateCollectionPaused(id, paused);
  } catch {
    return { ok: false, error: paused ? "No se pudo pausar la recolección." : "No se pudo reanudar la recolección." };
  }
  revalidatePath("/admin/candidatos");
  return {
    ok: true,
    message: paused
      ? `Pausado: se deja de recolectar datos nuevos para ${candidate.name}.`
      : `Reanudado: ${candidate.name} vuelve a recolectarse en la próxima corrida.`,
  };
}

export async function createCandidateAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const { repo } = await requireStaff();
  const name = String(formData.get("name") ?? "").trim();
  const slugRaw = String(formData.get("slug") ?? "").trim();
  const slug = slugRaw || slugifyName(name);
  const countryRaw = String(formData.get("country") ?? "AR");
  const modeRaw = String(formData.get("collection_mode") ?? "full");
  const office = String(formData.get("office") ?? "").trim() || null;
  const party = String(formData.get("party") ?? "").trim() || null;
  const keywords = splitList(String(formData.get("keywords") ?? ""));
  const excludeKeywords = splitList(String(formData.get("exclude_keywords") ?? ""));
  const xHandle = String(formData.get("x_handle") ?? "").trim() || null;
  const wikipedia = String(formData.get("wikipedia_article") ?? "").trim() || null;
  const rivalId = String(formData.get("rival_candidate_id") ?? "").trim() || null;
  const rivalLevelRaw = String(formData.get("rival_level") ?? "comparativo");
  const budget = parseDailyCap(String(formData.get("daily_budget_usd") ?? "1"));
  const enableIa = String(formData.get("enable_ai_visibility") ?? "") === "true";

  if (!name) return { ok: false, error: "Falta el nombre del candidato." };
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return { ok: false, error: "El slug no es válido. Usá letras minúsculas, números y guiones." };
  }
  if (!isCandidateCountry(countryRaw)) return { ok: false, error: "País inválido." };
  if (!isCollectionMode(modeRaw)) return { ok: false, error: "Modo inválido." };
  if (budget == null) return { ok: false, error: "Ingresá un tope de En la IA entre 0 y 50 USD." };
  const rivalLevel = isRivalLevel(rivalLevelRaw) ? rivalLevelRaw : "comparativo";

  try {
    const created = await repo.createCandidate({
      name,
      slug,
      country: countryRaw,
      collection_mode: modeRaw,
      office,
      party,
      keywords,
      exclude_keywords: excludeKeywords,
      x_handle: xHandle,
      wikipedia_article: wikipedia,
      rival_candidate_id: rivalId,
      rival_level: rivalId ? rivalLevel : null,
      daily_budget_usd: budget,
      enable_ai_visibility: enableIa,
    });
    revalidatePath("/admin/candidatos");
    revalidatePath("/admin/rivales");
    return { ok: true, message: `Alta lista: ${created.name} (/${created.slug}).` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/ya existe|slug no es válido|falta el nombre|país inválido|modo|tope inválido|rival/i.test(msg)) {
      return { ok: false, error: msg };
    }
    if (/todavía no se aplicó/i.test(msg)) {
      return { ok: false, error: "Todavía no se aplicó la migración del panel de candidatos." };
    }
    return { ok: false, error: "No se pudo crear el candidato. Probá de nuevo." };
  }
}
