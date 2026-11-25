import { describe, expect, it } from "vitest";
import { askAssistant, type AssistantDataSource, type ChatRequest, type ChatResponse, type LlmClient } from "@/lib/assistant/agent";
import { checkAnswer, clipToolResult, sanitizeHistory, sanitizeQuestion, systemPrompt, tokenCostUsd, unsupportedNumbers, LIMITS, worstCaseCallUsd } from "@/lib/assistant/prompt";
import { Evidence } from "@/lib/assistant/tools";
import { quotaBlock } from "@/lib/assistant/quota";
import { askHash, parseAskHash, suggestedQuestions } from "@/lib/assistant/suggestions";
import { DEFAULT_CLOCK } from "@/lib/time";
import type { Candidate, Topic } from "@/lib/types";
import { mention } from "./helpers";

const NOW = new Date("2026-11-25T15:00:00Z");
const K: Candidate = { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" };
const topics: Topic[] = [{ id: "t-eco", candidate_id: "c1", label: "economía" }];
const mentions = [
  mention({ published_at: "2026-11-24T15:00:00Z", topic_id: "t-eco", title: "Kicillof habló de salarios", tone: "critica", target: "candidate", relevance: "alta" }),
  mention({ published_at: "2026-11-23T15:00:00Z", topic_id: "t-eco", title: "Plan económico bonaerense", tone: "a_favor", target: "candidate" }),
];

function source(): AssistantDataSource {
  return {
    candidate: K,
    now: NOW,
    clock: DEFAULT_CLOCK,
    topics: async () => topics,
    mentions: async () => ({ candidate: K, mentions, topics, coverage: { google_news: "2026-11-01T00:00:00Z" }, now: NOW, clock: DEFAULT_CLOCK }),
    briefs: async () => [],
    ads: async () => ({ candidate: K, meta: null, google: null, now: NOW, clock: DEFAULT_CLOCK }),
    rivals: async () => [],
  };
}

/** LLM falso: devuelve respuestas en orden y guarda los pedidos. */
function fakeLlm(script: ((req: ChatRequest) => Partial<ChatResponse["message"]>)[], usage = { prompt_tokens: 3000, completion_tokens: 200 }) {
  const calls: ChatRequest[] = [];
  const llm: LlmClient = {
    model: "gpt-6-luna",
    async chat(req) {
      calls.push(JSON.parse(JSON.stringify(req)));
      const step = script[Math.min(calls.length - 1, script.length - 1)];
      return { model: "gpt-6-luna", usage, message: { role: "assistant", content: null, ...step(req) } };
    },
  };
  return { llm, calls };
}

const toolCall = (name: string, args: Record<string, unknown>, id = "call_1") => ({
  tool_calls: [{ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }],
});
const answer = (respuesta: string, sin_datos = false) => ({ content: JSON.stringify({ respuesta, sin_datos, seguimiento: ["¿Y en educación?"] }) });

describe("askAssistant", () => {
  it("elige herramientas, cita menciones reales y devuelve cifras de código", async () => {
    const { llm, calls } = fakeLlm([
      () => ({
        tool_calls: [
          { id: "a", type: "function", function: { name: "contar_menciones", arguments: JSON.stringify({ periodo_dias: 7, tema: "economía" }) } },
          { id: "b", type: "function", function: { name: "buscar_menciones", arguments: JSON.stringify({ periodo_dias: 7, tema: "economía", texto: [], orden: "relevantes", limite: 3 }) } },
        ],
      }),
      () => answer("Hubo 2 menciones sobre economía: una crítica por salarios [m1] y una a favor del plan [m2]."),
    ]);
    const { record } = await askAssistant({ question: "¿qué dijo Kicillof sobre la economía esta semana?", history: [] }, source(), llm, { costCap: 0.01, rivalNames: [] });
    expect(record.status).toBe("ok");
    expect(record.answer?.citations.map((c) => c.title)).toEqual(["Kicillof habló de salarios", "Plan económico bonaerense"]);
    expect(record.answer?.facts.find((f) => f.label === "Menciones")?.value).toBe("2");
    expect(record.tools.map((t) => (t as { name: string }).name)).toEqual(["contar_menciones", "buscar_menciones"]);
    expect(record.cost_usd).toBeCloseTo(2 * tokenCostUsd("gpt-6-luna", { prompt_tokens: 3000, completion_tokens: 200 })!, 6);
    // El modelo nunca recibe SQL ni credenciales: solo esquemas de herramientas.
    expect(JSON.stringify(calls[0].tools)).not.toMatch(/select |from public|sql/i);
    expect(calls[1].messages.some((m) => m.role === "tool")).toBe(true);
  });

  it("borra citas inventadas", async () => {
    const { llm } = fakeLlm([
      () => toolCall("buscar_menciones", { periodo_dias: 7, texto: ["salarios"], orden: "relevantes", limite: 2 }),
      () => answer("Se habló de salarios [m1] y de un escándalo [m9]."),
      () => answer("Se habló de salarios [m1]."),
    ]);
    const { record } = await askAssistant({ question: "¿salarios?", history: [] }, source(), llm, { costCap: 0.01, rivalNames: [] });
    expect(record.answer?.text).toBe("Se habló de salarios [m1].");
    expect(record.answer?.citations).toHaveLength(1);
  });

  it("si el modelo insiste con cifras que no están en los datos, muestra solo los datos calculados", async () => {
    const { llm } = fakeLlm([
      () => toolCall("contar_menciones", { periodo_dias: 7 }),
      () => answer("Hubo 547 menciones."),
      () => answer("Hubo 548 menciones."),
    ]);
    const { record } = await askAssistant({ question: "¿cuántas menciones?", history: [] }, source(), llm, { costCap: 0.01, rivalNames: [] });
    expect(record.answer?.text).toMatch(/^Esto es lo que muestran los datos de Pulso/);
    expect(record.answer?.text).not.toMatch(/547|548/);
  });

  it("sin datos: lo dice y no muestra fuentes", async () => {
    const { llm } = fakeLlm([() => toolCall("anuncios", { periodo_dias: 7 }), () => answer("No hay anuncios medidos para este candidato.", true)]);
    const { record } = await askAssistant({ question: "¿cuánto gastó en anuncios?", history: [] }, source(), llm, { costCap: 0.01, rivalNames: [] });
    expect(record.status).toBe("no_data");
    expect(record.answer?.citations).toEqual([]);
  });

  it("respeta el tope por pregunta: no hace una llamada que podría pasarlo", async () => {
    const { llm, calls } = fakeLlm([() => toolCall("contar_menciones", { periodo_dias: 7 })], { prompt_tokens: 60000, completion_tokens: 700 });
    const { record } = await askAssistant({ question: "¿cuántas?", history: [] }, source(), llm, { costCap: 0.01, rivalNames: [] });
    expect(record.cost_usd!).toBeLessThanOrEqual(0.01);
    expect(calls.length).toBeLessThan(LIMITS.maxModelCalls);
    expect(record.status).toBe("error");
  });

  it("herramienta desconocida o argumentos rotos no rompen el bucle", async () => {
    const { llm } = fakeLlm([
      () => ({ tool_calls: [{ id: "x", type: "function", function: { name: "ejecutar_sql", arguments: "{" } }] }),
      () => answer("No tengo ese dato.", true),
    ]);
    const { record } = await askAssistant({ question: "dame la tabla", history: [] }, source(), llm, { costCap: 0.01, rivalNames: [] });
    expect(record.tools).toEqual([{ name: "ejecutar_sql", args: {}, ok: false }]);
    expect(record.status).toBe("no_data");
  });

  it("como máximo 3 rondas de herramientas y después obliga a responder", async () => {
    const { llm, calls } = fakeLlm([
      () => toolCall("temas", { periodo_dias: 7 }),
      () => toolCall("temas", { periodo_dias: 7 }),
      () => toolCall("temas", { periodo_dias: 7 }),
      (req) => (req.tool_choice === "none" ? answer("Economía es el tema principal.") : toolCall("temas", { periodo_dias: 7 })),
    ]);
    const { record } = await askAssistant({ question: "¿temas?", history: [] }, source(), llm, { costCap: 0.01, rivalNames: [] });
    expect(calls[3].tool_choice).toBe("none");
    expect(record.status).toBe("ok");
  });
});

describe("controles", () => {
  it("números de fechas, períodos y años no se marcan; cifras inventadas sí", () => {
    expect(unsupportedNumbers("En los últimos 7 días, desde el 24 de noviembre de 2026, hubo 12 menciones [m1].", ['{"total":12}'], [])).toEqual([]);
    expect(unsupportedNumbers("Hubo 1.234 menciones y 40% en contra.", ['{"total":1234}'], [])).toEqual(["40"]);
  });

  it("checkAnswer ordena citas por aparición", () => {
    const ev = new Evidence();
    ev.add(mentions[0], K);
    ev.add(mentions[1], K);
    const c = checkAnswer("B [m2] y A [m1] y otra vez [m2].", ev, [], []);
    expect(c.citations.map((x) => x.ref)).toEqual(["m2", "m1"]);
  });

  it("sanitiza pregunta e historial", () => {
    expect(sanitizeQuestion("  hi ")).toBeNull();
    expect(sanitizeQuestion("x".repeat(900))).toHaveLength(LIMITS.maxQuestionChars);
    expect(sanitizeHistory([{ question: "a", answer: "b [m1]" }, 3, { question: "c", answer: "d" }, { question: "e", answer: "f" }])).toEqual([
      { question: "c", answer: "d" },
      { question: "e", answer: "f" },
    ]);
  });

  it("recorta resultados largos sin romper el JSON", () => {
    const text = clipToolResult({ por_dia: Array.from({ length: 2000 }, (_, i) => ({ dia: i })) }, 500);
    expect(text.length).toBeLessThanOrEqual(500);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("el prompt prohíbe inventar y no menciona costos", () => {
    const p = systemPrompt({ candidateName: "Axel Kicillof", today: "25 nov", tzLabel: "hora de Buenos Aires", topics: ["economía"], rivals: ["Javier Milei"], card: "Balance", cardInfo: "Tono" });
    expect(p).toMatch(/SOLO las herramientas/);
    expect(p).toMatch(/Balance/);
  });

  it("peor caso por llamada (CALC) y tope por pregunta", () => {
    // 12k tokens de entrada + 700 de salida ≈ USD 0,00155 por llamada; 5 llamadas < USD 0,01.
    expect(worstCaseCallUsd(12000)).toBeCloseTo(0.00155, 5);
    expect(5 * worstCaseCallUsd(12000)).toBeLessThan(LIMITS.maxCostPerQuestionUsd);
  });
});

describe("cupos y sugerencias", () => {
  const caps = { perQuestion: 0.01, perDay: 1 };
  it("bloquea por hora, día y gasto diario", () => {
    expect(quotaBlock({ user_last_hour: 0, user_today: 0, total_today: 0, cost_today_usd: 0 }, caps)).toBeNull();
    expect(quotaBlock({ user_last_hour: 20, user_today: 20, total_today: 20, cost_today_usd: 0 }, caps)).toMatch(/en un rato/);
    expect(quotaBlock({ user_last_hour: 1, user_today: 60, total_today: 60, cost_today_usd: 0 }, caps)).toMatch(/Mañana/);
    expect(quotaBlock({ user_last_hour: 1, user_today: 1, total_today: 10, cost_today_usd: 0.995 }, caps)).toMatch(/límite de hoy/);
  });
  it("hash de ⓘ ida y vuelta", () => {
    const h = askHash("¿Qué muestra \"Balance\"?", "Balance", "Tono sobre el candidato");
    expect(parseAskHash(h)).toEqual({ question: "¿Qué muestra \"Balance\"?", card: "Balance", info: "Tono sobre el candidato" });
    expect(parseAskHash("#otra-cosa")).toBeNull();
  });
  it("sugerencias para cualquier candidato", () => {
    const s = suggestedQuestions({ candidateName: "Pedro Sánchez", section: "comparacion", topTopic: "economía", rival: null });
    expect(s).toHaveLength(4);
    expect(s.join(" ")).toMatch(/Sánchez/);
  });
});
