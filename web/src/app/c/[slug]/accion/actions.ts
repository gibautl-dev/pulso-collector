"use server";

import { revalidatePath } from "next/cache";
import { loadCandidate } from "@/lib/context";
import { isCrisisStatus } from "@/lib/types";

export async function updateCrisisAlertStatus(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const rawNote = String(formData.get("status_note") ?? "").trim();
  if (!slug || !id || !isCrisisStatus(status)) {
    throw new Error("Pedido de revisión inválido");
  }
  const note = rawNote ? rawNote.slice(0, 500) : null;
  const { repo, candidate } = await loadCandidate(slug);
  await repo.updateCrisisAlertStatus(candidate.id, id, status, note);
  revalidatePath(`/c/${slug}/accion`);
  revalidatePath(`/c/${slug}/accion/${id}`);
}
