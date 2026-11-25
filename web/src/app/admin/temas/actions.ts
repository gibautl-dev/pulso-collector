"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/context";
import { splitTerms } from "@/lib/custom-topics";

export async function saveCustomTopicAction(formData: FormData) {
  const { repo, candidates } = await requireStaff();
  const candidateId = String(formData.get("candidate_id") ?? "");
  if (!candidates.some((c) => c.id === candidateId)) throw new Error("Candidato no válido");
  const sourcesRaw = String(formData.get("sources") ?? "").trim();
  const sources = sourcesRaw ? splitTerms(sourcesRaw.replace(/\s+/g, ",")) : null;
  await repo.upsertCustomTopic({
    id: String(formData.get("id") ?? "") || undefined,
    candidate_id: candidateId,
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? "").trim() || null,
    keywords: splitTerms(String(formData.get("keywords") ?? "")),
    include_terms: splitTerms(String(formData.get("include_terms") ?? "")),
    exclude_terms: splitTerms(String(formData.get("exclude_terms") ?? "")),
    sources,
    enabled: formData.get("enabled") === "on",
  });
  revalidatePath("/admin/temas");
  const slug = candidates.find((c) => c.id === candidateId)?.slug;
  if (slug) {
    revalidatePath(`/c/${slug}/temas`);
  }
}
