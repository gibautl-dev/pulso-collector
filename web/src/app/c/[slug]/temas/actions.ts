"use server";

import { revalidatePath } from "next/cache";
import { loadCandidate } from "@/lib/context";
import { CUSTOM_TOPIC_SUMMARY_PROMPT_VERSION, computeTopicStats } from "@/lib/custom-topics";
import { requestTopicSummary, topicLlmConfigured } from "@/lib/custom-topics-llm";
import { regionFor } from "@/lib/region";
import { llmActionError, LLM_NOT_CONFIGURED_MESSAGE, type FormActionState } from "@/lib/form-action";
import type { CustomTopicSummaryStatus } from "@/lib/types";

export async function requestTopicSummaryAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  try {
    const slug = String(formData.get("slug") ?? "");
    const topicId = String(formData.get("topic_id") ?? "");
    const { repo, candidate } = await loadCandidate(slug);
    const topic = await repo.getCustomTopic(candidate.id, topicId);
    if (!topic || !topic.enabled) return { ok: false, error: "No está ese tema" };
    if (!topicLlmConfigured()) {
      return { ok: false, error: LLM_NOT_CONFIGURED_MESSAGE };
    }
    const now = new Date();
    const since = new Date(now.getTime() - 14 * 86400000);
    const mentions = await repo.mentionsSince(candidate.id, since.toISOString());
    const stats = computeTopicStats(topic, mentions, { now, days: 14, timeZone: regionFor(slug, candidate?.country).timezone });
    const headlines = stats.topMentions.map((m) =>
      [m.outlet, m.title].filter(Boolean).join(": "),
    ).filter(Boolean);
    const result = await requestTopicSummary({
      candidateName: candidate.name,
      countryName: regionFor(slug, candidate?.country).countryName,
      topic,
      stats,
      headlines,
    });
    await repo.saveCustomTopicSummary({
      topic_id: topic.id,
      candidate_id: candidate.id,
      status: "draft",
      period_start: since.toISOString(),
      period_end: now.toISOString(),
      output: result.output,
      model: result.model,
      cost_usd: result.cost_usd,
      usage: result.usage,
      prompt_version: result.prompt_version || CUSTOM_TOPIC_SUMMARY_PROMPT_VERSION,
      origin: "ai",
      note: null,
    });
    revalidatePath(`/c/${slug}/temas`);
    revalidatePath(`/c/${slug}/temas/${topic.id}`);
    return { ok: true, message: "Resumen listo para revisar. Pulso no publica nada." };
  } catch (err) {
    return llmActionError(err);
  }
}

export async function updateTopicSummaryStatusAction(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  const topicId = String(formData.get("topic_id") ?? "");
  const summaryId = String(formData.get("summary_id") ?? "");
  const status = String(formData.get("status") ?? "") as CustomTopicSummaryStatus;
  if (status !== "approved" && status !== "discarded" && status !== "draft") {
    throw new Error("Estado no válido");
  }
  const { repo, candidate } = await loadCandidate(slug);
  await repo.updateCustomTopicSummaryStatus(candidate.id, topicId, summaryId, status);
  revalidatePath(`/c/${slug}/temas`);
  revalidatePath(`/c/${slug}/temas/${topicId}`);
}

