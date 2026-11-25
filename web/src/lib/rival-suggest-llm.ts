import "server-only";
import {
  RIVAL_SUGGEST_DEFAULT_MODEL,
  RIVAL_SUGGEST_MAX_COST_USD,
  RIVAL_SUGGEST_PROMPT_VERSION,
  buildSuggestPrompt,
  parseSuggestions,
  tokenCostUsd,
  type SuggestContext,
} from "./rival-suggest";
import type { Candidate, RivalSuggestion } from "./types";

export function llmConfigured(): boolean {
  return Boolean((process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim());
}

function llmConfig(): { key: string; base: string; model: string; maxCost: number } {
  const key = (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("Falta LLM_API_KEY u OPENAI_API_KEY en el servidor para sugerir rivales.");
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = (process.env.LLM_MODEL || process.env.PULSO_RIVAL_SUGGEST_MODEL || RIVAL_SUGGEST_DEFAULT_MODEL).trim();
  const maxCost = Number(process.env.PULSO_RIVAL_SUGGEST_MAX_COST_USD || RIVAL_SUGGEST_MAX_COST_USD);
  return { key, base, model, maxCost: Number.isFinite(maxCost) && maxCost > 0 ? maxCost : RIVAL_SUGGEST_MAX_COST_USD };
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      minItems: 5,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "arena", "reason"],
        properties: {
          name: { type: "string" },
          arena: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

export interface SuggestionLlmResult {
  suggestions: RivalSuggestion[];
  model: string;
  cost_usd: number | null;
  usage: Record<string, unknown>;
  prompt_version: string;
}

export async function requestRivalSuggestions(
  ctx: SuggestContext,
  measured: Candidate[],
): Promise<SuggestionLlmResult> {
  const cfg = llmConfig();
  const { system, user } = buildSuggestPrompt(ctx);
  const body = {
    model: cfg.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "rival_suggestions", strict: true, schema: OUTPUT_SCHEMA },
    },
    max_completion_tokens: 1200,
  };
  const res = await fetch(`${cfg.base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`El modelo devolvió HTTP ${res.status}.`);
  }
  const raw = (await res.json()) as {
    model?: string;
    usage?: Record<string, unknown>;
    choices?: { message?: { content?: string | unknown[] } }[];
  };
  let content = raw.choices?.[0]?.message?.content ?? "{}";
  if (Array.isArray(content)) {
    content = content
      .map((part) => (typeof part === "object" && part && "text" in part ? String((part as { text?: string }).text ?? "") : String(part)))
      .join("");
  }
  const parsed = JSON.parse(String(content || "{}"));
  const suggestions = parseSuggestions(parsed, measured);
  if (suggestions.length < 5) {
    throw new Error("El modelo no devolvió suficientes sugerencias para revisar.");
  }
  const usage = raw.usage ?? {};
  const model = String(raw.model || cfg.model);
  const cost = tokenCostUsd(model, usage as { input_tokens?: number; output_tokens?: number });
  if (cost != null && cost > cfg.maxCost) {
    throw new Error(
      `La corrida salió ${cost} USD y supera el tope de ${cfg.maxCost} USD. No se guarda.`,
    );
  }
  return {
    suggestions,
    model,
    cost_usd: cost,
    usage,
    prompt_version: RIVAL_SUGGEST_PROMPT_VERSION,
  };
}
