"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/context";
import type { FormActionState } from "@/lib/form-action";
import { parseDailyCap } from "@/lib/spend";

export async function saveAiVisibilityCapAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { repo } = await requireStaff();
  const usd = parseDailyCap(String(formData.get("daily_budget_usd") ?? ""));
  if (usd == null) return { ok: false, error: "Ingresá un monto entre 0 y 50 USD." };
  try {
    await repo.updateAiVisibilityDailyCap(usd);
  } catch {
    return { ok: false, error: "No se pudo guardar el tope. Probá de nuevo." };
  }
  revalidatePath("/admin/gasto");
  return { ok: true, message: `Tope guardado: USD ${usd.toFixed(2).replace(".", ",")} por día.` };
}
