import "server-only";
import { ASSISTANT_DEFAULT_MODEL, LIMITS } from "./prompt";
import { postChatCompletion } from "@/lib/llm-compat";
import type { ChatRequest, ChatResponse, LlmClient } from "./agent";

/** La clave vive solo en el servidor (Render). Nunca en el navegador ni en el repo. */
export function assistantLlmConfigured(): boolean {
  return Boolean((process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim());
}

/** Tope por pregunta: el env solo puede bajarlo. */
export function assistantCostCap(): { perQuestion: number; perDay: number } {
  const q = Number(process.env.PULSO_ASSISTANT_MAX_COST_USD);
  const d = Number(process.env.PULSO_ASSISTANT_MAX_DAILY_COST_USD);
  return {
    perQuestion: Number.isFinite(q) && q > 0 ? Math.min(q, LIMITS.maxCostPerQuestionUsd) : LIMITS.maxCostPerQuestionUsd,
    perDay: Number.isFinite(d) && d > 0 ? Math.min(d, LIMITS.maxCostPerDayUsd) : LIMITS.maxCostPerDayUsd,
  };
}

export function createLlmClient(): LlmClient {
  const key = (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("assistant_llm_missing");
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = (process.env.PULSO_ASSISTANT_MODEL || process.env.LLM_MODEL || ASSISTANT_DEFAULT_MODEL).trim();
  return {
    model,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const body: Record<string, unknown> = { model, ...req };
      // Sin esto el proveedor responde 400 en el primer pedido con tools.
      if (Array.isArray(req.tools) && req.tools.length > 0) {
        body.reasoning_effort = "none";
      }
      const res = await postChatCompletion({ base, key, body, timeoutMs: 25000, label: "assistant" });
      if (!res.ok) throw new Error(`El modelo devolvió HTTP ${res.status}.`);
      const raw = (await res.json()) as {
        model?: string;
        usage?: Record<string, number>;
        choices?: { message?: ChatResponse["message"] }[];
      };
      return { model: String(raw.model || model), usage: raw.usage ?? {}, message: raw.choices?.[0]?.message ?? { role: "assistant", content: "" } };
    },
  };
}
