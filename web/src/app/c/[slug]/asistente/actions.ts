"use server";

import { loadCandidate } from "@/lib/context";
import { askAssistant } from "@/lib/assistant/agent";
import { repoDataSource, rivalNames } from "@/lib/assistant/data";
import { assistantCostCap, assistantLlmConfigured, createLlmClient } from "@/lib/assistant/llm";
import { ASSISTANT_PROMPT_VERSION, sanitizeHistory, sanitizeQuestion } from "@/lib/assistant/prompt";
import { ASSISTANT_ERROR, ASSISTANT_UNAVAILABLE, quotaBlock } from "@/lib/assistant/quota";
import type { AssistantQuestion } from "@/lib/types";

export type AskActionResult = { ok: true; item: AssistantQuestion } | { ok: false; message: string };

export interface AskPayload {
  question: string;
  history?: { question: string; answer: string }[];
  page?: string | null;
  card?: string | null;
  cardInfo?: string | null;
}

function short(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

/**
 * Pregunta al asistente. Corre en el servidor con la sesión del usuario:
 * loadCandidate da 404 si no es miembro del candidato y todas las lecturas
 * pasan por RLS. La clave del modelo nunca sale del servidor.
 */
export async function askAssistantAction(slug: string, payload: AskPayload): Promise<AskActionResult> {
  const question = sanitizeQuestion(payload?.question);
  if (!question) return { ok: false, message: "Escribí una pregunta un poco más larga." };
  const { repo, candidate } = await loadCandidate(String(slug));
  const quota = await repo.assistantQuota();
  if (!quota || !assistantLlmConfigured()) return { ok: false, message: ASSISTANT_UNAVAILABLE };
  const caps = assistantCostCap();
  const blocked = quotaBlock(quota, caps);
  if (blocked) return { ok: false, message: blocked };

  const page = short(payload.page, 60);
  let started: { id: string; created_at: string };
  try {
    started = await repo.startAssistantQuestion({ candidate_id: candidate.id, question, page, prompt_version: ASSISTANT_PROMPT_VERSION });
  } catch (e) {
    if (e instanceof Error && e.message === "assistant_limit") {
      return { ok: false, message: "Llegaste al máximo de preguntas por ahora. Probá de nuevo más tarde." };
    }
    console.error("assistant start failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, message: ASSISTANT_ERROR };
  }

  const ts = await repo.dataTimestamp();
  const now = repo.mode === "fixture" && ts ? new Date(ts) : new Date();
  try {
    const { record } = await askAssistant(
      {
        question,
        history: sanitizeHistory(payload.history),
        page,
        card: short(payload.card, 80),
        cardInfo: short(payload.cardInfo, 300),
      },
      repoDataSource(repo, candidate, now),
      createLlmClient(),
      { costCap: caps.perQuestion, rivalNames: await rivalNames(repo, candidate.id) },
    );
    await repo.finishAssistantQuestion(started.id, record);
    return {
      ok: true,
      item: { id: started.id, candidate_id: candidate.id, question, status: record.status, answer: record.answer, page, created_at: started.created_at },
    };
  } catch (e) {
    console.error("assistant failed", e instanceof Error ? e.message : "unknown");
    await repo
      .finishAssistantQuestion(started.id, { status: "error", answer: null, tools: [], model: null, cost_usd: null, usage: {} })
      .catch(() => undefined);
    return { ok: false, message: ASSISTANT_ERROR };
  }
}
