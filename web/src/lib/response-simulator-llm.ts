import "server-only";
import {
  MAX_OUTPUT_TOKENS,
  SIMULATOR_DEFAULT_MODEL,
  SIMULATOR_PROMPT_VERSION,
  buildSimulatorPrompt,
  estimateMaxCostUsd,
  groundSimulation,
  outputSchema,
  usageCostUsd,
  type SimulationOutput,
  type SimulatorContext,
} from "@/lib/response-simulator";
import { postChatCompletion } from "@/lib/llm-compat";

/** Misma configuración del proveedor que el resto de la web (solo servidor). */
export function simulatorLlmConfigured(): boolean {
  return Boolean((process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim());
}

function config(): { key: string; base: string; model: string; effort: string } {
  const key = (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("Falta LLM_API_KEY u OPENAI_API_KEY en el servidor para el simulador.");
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = (process.env.PULSO_SIMULATOR_MODEL || process.env.LLM_MODEL || SIMULATOR_DEFAULT_MODEL).trim();
  const effort = (process.env.LLM_REASONING_EFFORT || "").trim();
  return { key, base, model, effort };
}

export interface PreparedSimulation {
  system: string;
  user: string;
  reserveUsd: number;
}

/** Arma el prompt y su costo máximo (antes de reservar cupo). */
export function prepareSimulation(ctx: SimulatorContext, draft: string): PreparedSimulation {
  const { system, user } = buildSimulatorPrompt(ctx, draft);
  return { system, user, reserveUsd: estimateMaxCostUsd(system.length + user.length) };
}

export interface SimulationLlmResult {
  /** null si la respuesta no pasó los controles (igual se anota el costo). */
  output: SimulationOutput | null;
  error: string | null;
  model: string;
  cost_usd: number | null;
  usage: Record<string, unknown>;
  prompt_version: string;
}

export async function requestSimulation(
  prepared: PreparedSimulation,
  ctx: SimulatorContext,
  draft: string,
  maxRequestUsd: number,
): Promise<SimulationLlmResult> {
  const cfg = config();
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: "system", content: prepared.system },
      { role: "user", content: prepared.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "response_simulation",
        strict: true,
        schema: outputSchema(ctx.segments.map((s) => s.key)),
      },
    },
    max_completion_tokens: MAX_OUTPUT_TOKENS,
  };
  if (cfg.effort) body.reasoning_effort = cfg.effort;
  const res = await postChatCompletion({ base: cfg.base, key: cfg.key, body, timeoutMs: 60_000, label: "simulator" });
  if (!res.ok) throw new Error(`El modelo no respondió (${res.status}).`);
  const raw = (await res.json()) as {
    model?: string;
    usage?: Record<string, unknown>;
    choices?: { message?: { content?: unknown } }[];
  };
  let content = raw.choices?.[0]?.message?.content ?? "{}";
  if (Array.isArray(content)) {
    content = content
      .map((p) => (typeof p === "object" && p && "text" in p ? String((p as { text?: string }).text ?? "") : String(p)))
      .join("");
  }
  const usedModel = String(raw.model || cfg.model);
  const usage = (raw.usage ?? {}) as Record<string, unknown>;
  const cost = usageCostUsd(usedModel, usage as { prompt_tokens?: number; completion_tokens?: number });
  const base = { model: usedModel, cost_usd: cost, usage, prompt_version: SIMULATOR_PROMPT_VERSION };
  if (cost != null && cost > maxRequestUsd) {
    return { ...base, output: null, error: "over_request_cap" };
  }
  let json: unknown = null;
  try {
    json = JSON.parse(typeof content === "string" ? content || "{}" : "{}");
  } catch {
    return { ...base, output: null, error: "invalid_json" };
  }
  const parsed = groundSimulation(json, ctx, draft);
  if (!parsed) return { ...base, output: null, error: "ungrounded" };
  return { ...base, output: parsed, error: null };
}
