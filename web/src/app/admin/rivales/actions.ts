"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/context";
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
