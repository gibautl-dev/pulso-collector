"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loadCandidate } from "@/lib/context";
import { LLM_NOT_CONFIGURED_MESSAGE, isMissingLlmKeyError } from "@/lib/form-action";
import {
  QUOTA_MESSAGE,
  SIMULATOR_PROMPT_VERSION,
  SIMULATOR_WINDOW_DAYS,
  buildSimulatorContext,
  quotaErrorFrom,
  sanitizeDraft,
  validateDraft,
} from "@/lib/response-simulator";
import { prepareSimulation, requestSimulation, simulatorLlmConfigured } from "@/lib/response-simulator-llm";
import type { Candidate, Mention, Topic } from "@/lib/types";

export type SimulateState = { ok: false; error: string } | null;

const LEVEL_ORDER = { completo: 0, comparativo: 1, radar: 2 } as const;

/**
 * Simula la recepción de un borrador. Nunca publica nada: guarda la estimación
 * para el autor (RLS) y redirige a la vista del resultado.
 */
export async function simulateResponseAction(_prev: SimulateState, formData: FormData): Promise<SimulateState> {
  const slug = String(formData.get("slug") ?? "");
  const draft = sanitizeDraft(formData.get("draft"));
  let simId: string | null = null;
  try {
    const { repo, candidate } = await loadCandidate(slug);
    const invalid = validateDraft(draft);
    if (invalid) return { ok: false, error: invalid };
    const limits = await repo.getSimulatorLimits();
    if (!limits) return { ok: false, error: QUOTA_MESSAGE.disabled };
    if (!simulatorLlmConfigured()) return { ok: false, error: LLM_NOT_CONFIGURED_MESSAGE };

    const ts = await repo.dataTimestamp();
    const now = ts ? new Date(ts) : new Date();
    const since = new Date(now.getTime() - SIMULATOR_WINDOW_DAYS * 86400000).toISOString();
    const [topics, mentions, rivals] = await Promise.all([
      repo.listTopics(candidate.id),
      repo.mentionsSince(candidate.id, since),
      repo.listRivals(candidate.id),
    ]);
    let rival: { candidate: Candidate; mentions: Mention[]; topics: Topic[] } | null = null;
    const first = rivals.slice().sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])[0];
    if (first) {
      const rc = await repo.getCandidateById(first.rival_id);
      if (rc) {
        const [rm, rt] = await Promise.all([repo.mentionsSince(rc.id, since), repo.listTopics(rc.id)]);
        rival = { candidate: rc, mentions: rm, topics: rt };
      }
    }
    const ctx = buildSimulatorContext({ candidate, draft, topics, mentions, rival, now });
    if (ctx.segments.length === 0) {
      return { ok: false, error: "Todavía no hay suficientes menciones recientes para estimar la recepción." };
    }
    const prepared = prepareSimulation(ctx, draft);
    if (prepared.reserveUsd > limits.maxRequestUsd) {
      return { ok: false, error: QUOTA_MESSAGE.request_too_expensive };
    }

    simId = await repo.startResponseSimulation(candidate.id, draft, prepared.reserveUsd);
    try {
      const result = await requestSimulation(prepared, ctx, draft, limits.maxRequestUsd);
      await repo.finishResponseSimulation(simId, {
        status: result.output ? "ok" : "error",
        output: (result.output ?? {}) as unknown as Record<string, unknown>,
        context: ctx as unknown as Record<string, unknown>,
        model: result.model,
        prompt_version: result.prompt_version,
        cost_usd: result.cost_usd,
        usage: result.usage,
        error: result.error,
      });
      if (!result.output) {
        return { ok: false, error: "No salió una estimación confiable con estos datos. Probá reformular el borrador." };
      }
    } catch (err) {
      await repo
        .finishResponseSimulation(simId, {
          status: "error",
          output: {},
          context: ctx as unknown as Record<string, unknown>,
          model: null,
          prompt_version: SIMULATOR_PROMPT_VERSION,
          cost_usd: null,
          usage: {},
          error: err instanceof Error ? err.message.slice(0, 200) : "error",
        })
        .catch(() => undefined);
      throw err;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    const quota = quotaErrorFrom(msg);
    if (quota) return { ok: false, error: QUOTA_MESSAGE[quota] };
    if (isMissingLlmKeyError(err)) return { ok: false, error: LLM_NOT_CONFIGURED_MESSAGE };
    // notFound()/redirect() de loadCandidate se propagan.
    if (msg === "NEXT_NOT_FOUND" || msg === "NEXT_REDIRECT" || (err as { digest?: string })?.digest) throw err;
    return { ok: false, error: "No se pudo simular ahora. Probá de nuevo en unos minutos." };
  }
  revalidatePath(`/c/${slug}/simulador`);
  redirect(`/c/${slug}/simulador?sim=${simId}`);
}
