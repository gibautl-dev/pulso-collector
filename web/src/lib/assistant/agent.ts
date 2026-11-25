/**
 * Bucle del asistente: el modelo elige herramientas de Pulso (parámetros
 * acotados), el código las ejecuta sobre datos leídos con la sesión del
 * usuario y el modelo redacta con citas. El servidor valida citas y cifras.
 */
import type { AssistantAnswer, AssistantRunRecord, Candidate, DailyBrief, Topic } from "@/lib/types";
import { formatDate, type Clock } from "@/lib/time";
import {
  ANSWER_SCHEMA,
  ASSISTANT_PROMPT_VERSION,
  LIMITS,
  TOOL_SCHEMAS,
  checkAnswer,
  clipToolResult,
  systemPrompt,
  tokenCostUsd,
  worstCaseCallUsd,
  type HistoryTurn,
} from "./prompt";
import {
  Evidence,
  adsOverview,
  compareRivals,
  countMentions,
  dailyBriefsTool,
  searchMentions,
  topicsOverview,
  type AdsData,
  type Fact,
  type MentionsData,
  type RivalData,
  type ToolOutput,
} from "./tools";

const TOOLS_CHARS = JSON.stringify(TOOL_SCHEMAS).length;

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface ChatRequest {
  messages: ChatMessage[];
  tools?: unknown[];
  tool_choice?: "auto" | "none";
  parallel_tool_calls?: boolean;
  response_format?: unknown;
  max_completion_tokens: number;
}
export interface ChatResponse {
  model: string;
  usage: Record<string, number>;
  message: ChatMessage;
}
export interface LlmClient {
  model: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export interface AssistantDataSource {
  candidate: Candidate;
  now: Date;
  clock: Clock;
  topics(): Promise<Topic[]>;
  mentions(): Promise<MentionsData>;
  briefs(): Promise<DailyBrief[]>;
  ads(): Promise<AdsData>;
  rivals(): Promise<RivalData[]>;
}

export interface AskInput {
  question: string;
  history: HistoryTurn[];
  page?: string | null;
  card?: string | null;
  cardInfo?: string | null;
}

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
}

/** Ejecuta una herramienta por nombre. Nombres o argumentos inválidos devuelven un error para el modelo. */
export async function runTool(name: string, rawArgs: string, data: AssistantDataSource, evidence: Evidence): Promise<{ out: ToolOutput | null; args: Record<string, unknown>; error?: string }> {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawArgs || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch {
    return { out: null, args, error: "Argumentos inválidos." };
  }
  switch (name) {
    case "contar_menciones":
      return { out: countMentions(args, await data.mentions()), args };
    case "buscar_menciones":
      return { out: searchMentions(args, await data.mentions(), evidence), args };
    case "temas":
      return { out: topicsOverview(args, await data.mentions()), args };
    case "resumen_diario":
      return { out: dailyBriefsTool(args, await data.briefs(), data.candidate), args };
    case "anuncios":
      return { out: adsOverview(args, await data.ads()), args };
    case "comparar_rivales":
      return { out: compareRivals(args, await data.mentions(), await data.rivals()), args };
    default:
      return { out: null, args, error: `Herramienta desconocida: ${name}` };
  }
}

function dedupeFacts(facts: Fact[], max = 6): Fact[] {
  const seen = new Set<string>();
  const out: Fact[] = [];
  for (const f of facts) {
    if (seen.has(f.label)) continue;
    seen.add(f.label);
    out.push(f);
    if (out.length >= max) break;
  }
  return out;
}

function parseAnswer(content: string | null): { respuesta: string; sin_datos: boolean; seguimiento: string[] } | null {
  if (!content) return null;
  try {
    const p = JSON.parse(content);
    if (typeof p?.respuesta !== "string") return null;
    return {
      respuesta: p.respuesta,
      sin_datos: p.sin_datos === true,
      seguimiento: Array.isArray(p.seguimiento) ? p.seguimiento.filter((s: unknown) => typeof s === "string").slice(0, 3) : [],
    };
  } catch {
    return null;
  }
}

/** Respuesta segura cuando el texto del modelo no pasa los controles: solo los datos calculados. */
function factsOnlyText(facts: Fact[]): string {
  if (!facts.length) return "No encontré datos en Pulso para responder esto con precisión.";
  return `Esto es lo que muestran los datos de Pulso:\n${facts.map((f) => `- ${f.label}: ${f.value}${f.hint ? ` (${f.hint})` : ""}`).join("\n")}`;
}

export interface AskResult {
  record: AssistantRunRecord;
}

/**
 * Responde una pregunta. Nunca supera `costCap` (corta antes de una llamada
 * que podría pasarse, estimando la entrada por caracteres).
 */
export async function askAssistant(input: AskInput, data: AssistantDataSource, llm: LlmClient, opts: { costCap: number; rivalNames: string[] }): Promise<AskResult> {
  const topics = await data.topics();
  const evidence = new Evidence();
  const facts: Fact[] = [];
  const notes: string[] = [];
  const toolTexts: string[] = [];
  const trace: ToolTrace[] = [];
  const usageTotals = { prompt_tokens: 0, completion_tokens: 0, calls: 0 };
  let spent = 0;
  let model = llm.model;
  // Tokens por carácter enviado: arranca conservador y se calibra con el uso real.
  let tokensPerChar = 0.5;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt({
        candidateName: data.candidate.name,
        today: formatDate(data.now.toISOString(), data.clock),
        tzLabel: data.clock.tzLabel,
        topics: topics.map((t) => t.label),
        rivals: opts.rivalNames,
        page: input.page,
        card: input.card,
        cardInfo: input.cardInfo,
      }),
    },
  ];
  for (const turn of input.history) {
    messages.push({ role: "user", content: turn.question });
    messages.push({ role: "assistant", content: JSON.stringify({ respuesta: turn.answer, sin_datos: false, seguimiento: [] }) });
  }
  messages.push({ role: "user", content: input.question });

  const call = async (req: Omit<ChatRequest, "messages" | "max_completion_tokens">): Promise<ChatResponse | null> => {
    if (usageTotals.calls >= LIMITS.maxModelCalls) return null;
    const chars = JSON.stringify(messages).length + (req.tools ? TOOLS_CHARS : 0);
    const approxInput = Math.ceil(chars * tokensPerChar);
    if (spent + worstCaseCallUsd(approxInput) > opts.costCap) return null;
    const res = await llm.chat({ ...req, messages, max_completion_tokens: LIMITS.maxOutputTokens });
    usageTotals.calls++;
    const promptTokens = Number(res.usage.prompt_tokens ?? res.usage.input_tokens ?? 0);
    if (promptTokens > 0) tokensPerChar = Math.max(tokensPerChar, promptTokens / chars);
    usageTotals.prompt_tokens += Number(res.usage.prompt_tokens ?? res.usage.input_tokens ?? 0);
    usageTotals.completion_tokens += Number(res.usage.completion_tokens ?? res.usage.output_tokens ?? 0);
    const cost = tokenCostUsd(res.model, res.usage);
    // Modelo sin precio conocido: se cuenta como el peor caso para no pasar el tope a ciegas.
    spent += cost ?? worstCaseCallUsd(approxInput);
    model = res.model;
    return res;
  };

  const responseFormat = { type: "json_schema", json_schema: { name: "respuesta_asistente", strict: true, schema: ANSWER_SCHEMA } };
  let final: ChatResponse | null = null;
  for (let round = 0; round <= LIMITS.maxToolRounds; round++) {
    const allowTools = round < LIMITS.maxToolRounds;
    const res = await call({
      tools: TOOL_SCHEMAS,
      tool_choice: allowTools ? "auto" : "none",
      parallel_tool_calls: true,
      response_format: responseFormat,
    });
    if (!res) break;
    const calls = (res.message.tool_calls ?? []).slice(0, LIMITS.maxToolCallsPerRound);
    if (!allowTools || calls.length === 0) {
      final = res;
      break;
    }
    messages.push({ role: "assistant", content: res.message.content ?? null, tool_calls: calls });
    for (const tc of calls) {
      const { out, args, error } = await runTool(tc.function.name, tc.function.arguments, data, evidence);
      trace.push({ name: tc.function.name, args, ok: !error });
      const text = out ? clipToolResult(out.result) : JSON.stringify({ error });
      if (out) {
        facts.push(...out.facts);
        notes.push(...out.notes);
        toolTexts.push(text);
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: text });
    }
  }

  const base = { tools: trace, model, usage: { ...usageTotals, prompt_version: ASSISTANT_PROMPT_VERSION } };
  let parsed = parseAnswer(final?.message.content ?? null);
  if (!parsed) {
    return {
      record: {
        ...base,
        status: "error",
        cost_usd: round6(spent),
        answer: { text: "No pude completar la respuesta. Probá reformular la pregunta.", no_data: true, followups: [], citations: [], facts: [], notes: [] },
      },
    };
  }

  let checked = checkAnswer(parsed.respuesta, evidence, toolTexts, facts);
  if (checked.droppedRefs.length || checked.unsupportedNumbers.length) {
    // Una sola corrección: le decimos qué no está en los datos.
    messages.push({ role: "assistant", content: final!.message.content });
    messages.push({
      role: "user",
      content: `Revisá tu respuesta: ${
        checked.unsupportedNumbers.length ? `estas cifras no están en los resultados: ${checked.unsupportedNumbers.join(", ")}. ` : ""
      }${checked.droppedRefs.length ? `estas citas no existen: ${checked.droppedRefs.join(", ")}. ` : ""}Reescribila usando solo cifras y citas de los resultados.`,
    });
    const fix = await call({ response_format: responseFormat });
    const fixed = parseAnswer(fix?.message.content ?? null);
    if (fixed) {
      const again = checkAnswer(fixed.respuesta, evidence, toolTexts, facts);
      if (!again.unsupportedNumbers.length) {
        parsed = fixed;
        checked = again;
      }
    }
  }
  const factsOut = dedupeFacts(facts);
  const safe = checked.unsupportedNumbers.length === 0;
  const answer: AssistantAnswer = {
    text: safe ? checked.text : factsOnlyText(factsOut),
    no_data: parsed.sin_datos,
    followups: parsed.seguimiento,
    citations: safe && !parsed.sin_datos ? checked.citations : [],
    facts: parsed.sin_datos ? [] : factsOut,
    notes: [...new Set(notes)].slice(0, 3),
  };
  return {
    record: {
      ...base,
      usage: { ...base.usage, dropped_refs: checked.droppedRefs, unsupported_numbers: checked.unsupportedNumbers },
      status: parsed.sin_datos ? "no_data" : "ok",
      cost_usd: round6(spent),
      answer,
    },
  };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
