import "server-only";
import { tokenCostUsd } from "@/lib/rival-suggest";
import {
  CUSTOM_TOPIC_DEFAULT_MODEL,
  CUSTOM_TOPIC_SUMMARY_MAX_COST_USD,
  CUSTOM_TOPIC_SUMMARY_PROMPT_VERSION,
  buildSummaryPrompt,
  parseSummaryOutput,
  type TopicStats,
} from "@/lib/custom-topics";
import type { CustomTopic, CustomTopicSummaryOutput } from "@/lib/types";

export function topicLlmConfigured(): boolean {
  return Boolean((process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim());
}

function config(): { key: string; base: string; model: string; maxCost: number } {
  const key = (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("Falta LLM_API_KEY u OPENAI_API_KEY en el servidor para el analista del tema.");
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = (process.env.LLM_MODEL || process.env.PULSO_TOPIC_SUMMARY_MODEL || CUSTOM_TOPIC_DEFAULT_MODEL).trim();
  const maxCost = Number(process.env.PULSO_TOPIC_SUMMARY_MAX_COST_USD || CUSTOM_TOPIC_SUMMARY_MAX_COST_USD);
  return { key, base, model, maxCost: Number.isFinite(maxCost) && maxCost > 0 ? maxCost : CUSTOM_TOPIC_SUMMARY_MAX_COST_USD };
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["happening", "risks", "opportunities", "angles"],
  properties: {
    happening: { type: "string" },
    risks: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
    opportunities: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
    angles: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body"],
        properties: { title: { type: "string" }, body: { type: "string" } },
      },
    },
  },
};

export interface TopicSummaryLlmResult {
  output: CustomTopicSummaryOutput;
  model: string;
  cost_usd: number | null;
  usage: Record<string, unknown>;
  prompt_version: string;
}

export async function requestTopicSummary(opts: {
  candidateName: string;
  countryName: string;
  topic: CustomTopic;
  stats: TopicStats;
  headlines: string[];
}): Promise<TopicSummaryLlmResult> {
  const { key, base, model, maxCost } = config();
  const { system, user } = buildSummaryPrompt(opts);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "topic_summary", strict: true, schema: SCHEMA },
      },
      max_completion_tokens: 1200,
    }),
  });
  if (!res.ok) {
    throw new Error(`El modelo no respondió (${res.status}).`);
  }
  const raw = (await res.json()) as {
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
    choices?: { message?: { content?: unknown } }[];
  };
  let content = raw.choices?.[0]?.message?.content ?? "{}";
  if (Array.isArray(content)) {
    content = content.map((p) => (typeof p === "object" && p && "text" in p ? String((p as { text?: string }).text ?? "") : String(p))).join("");
  }
  const parsed = parseSummaryOutput(typeof content === "string" ? JSON.parse(content) : content);
  if (!parsed) throw new Error("El modelo no devolvió un resumen usable.");
  const usedModel = raw.model || model;
  const cost = tokenCostUsd(usedModel, raw.usage ?? null);
  if (cost != null && cost > maxCost) {
    throw new Error(`El resumen superó el tope de USD ${maxCost.toFixed(2)}.`);
  }
  return {
    output: parsed,
    model: usedModel,
    cost_usd: cost,
    usage: (raw.usage ?? {}) as Record<string, unknown>,
    prompt_version: CUSTOM_TOPIC_SUMMARY_PROMPT_VERSION,
  };
}
