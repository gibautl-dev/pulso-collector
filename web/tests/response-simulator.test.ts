import { afterEach, describe, expect, it, vi } from "vitest";
import { mention } from "./helpers";
import {
  QUOTA_MESSAGE,
  SIMULATOR_LIMITS_DEFAULT,
  buildSimulatorContext,
  buildSimulatorPrompt,
  checkQuota,
  contentTokens,
  estimateMaxCostUsd,
  groundSimulation,
  normalizeStoredContext,
  normalizeStoredOutput,
  outputSchema,
  quotaErrorFrom,
  riskLevel,
  sanitizeDraft,
  signedBalance,
  validateDraft,
} from "@/lib/response-simulator";
import { MemoryRepo, LOCAL_USER_ID, type FixtureData } from "@/lib/data/memory";
import { prepareSimulation, requestSimulation } from "@/lib/response-simulator-llm";
import { sectionAvailable } from "@/lib/candidate-nav";
import type { Mention, Topic } from "@/lib/types";

const NOW = new Date("2026-11-25T14:00:00Z");
const K = { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" };
const M = { id: "c2", slug: "milei", name: "Javier Milei" };
const topics: Topic[] = [
  { id: "t-nacion", candidate_id: "c1", label: "relación con Nación" },
  { id: "t-gestion", candidate_id: "c1", label: "gestión provincial" },
  { id: "t-interna", candidate_id: "c1", label: "interna peronista" },
  { id: "t-otros", candidate_id: "c1", label: "otros" },
];
const rivalTopics: Topic[] = [{ id: "r-nacion", candidate_id: "c2", label: "relación con Nación" }];
const DRAFT =
  "La Provincia va a seguir pagando salarios aunque el Gobierno nacional recorte los fondos de los bonaerenses.";

function at(hoursAgo: number) {
  return new Date(NOW.getTime() - hoursAgo * 3600000).toISOString();
}

function dataset(): Mention[] {
  const out: Mention[] = [];
  for (let i = 0; i < 4; i++) {
    out.push(mention({ candidate_id: "c1", source: "x", outlet: null, author: `fan${i}`, tone: "a_favor", topic_id: "t-gestion", title: `Kicillof paga salarios y defiende fondos bonaerenses ${i}`, content: "La provincia sostiene salarios pese al recorte de fondos nacional", published_at: at(5 + i) }));
  }
  for (let i = 0; i < 5; i++) {
    out.push(mention({ candidate_id: "c1", source: "x", outlet: null, tone: i % 2 ? "insulto" : "critica", topic_id: "t-nacion", title: `No es Nación: la Provincia no tiene fondos por su gestión ${i}`, content: "Recorte de fondos es excusa de Kicillof para salarios atrasados", published_at: at(10 + i) }));
  }
  for (let i = 0; i < 4; i++) {
    out.push(mention({ candidate_id: "c1", source: "google_news", outlet: `Diario ${i}`, tone: i === 0 ? "critica" : "informativo", topic_id: "t-nacion", title: `Fondos nacionales a la Provincia: la discusión por salarios ${i}`, published_at: at(20 + i) }));
  }
  // Fuera de ventana: no cuenta.
  out.push(mention({ candidate_id: "c1", tone: "critica", topic_id: "t-nacion", published_at: at(24 * 30), title: "Vieja crítica fondos salarios" }));
  // Propio: no es un público.
  out.push(mention({ candidate_id: "c1", account_relation: "own", tone: "a_favor", topic_id: "t-gestion", published_at: at(2) }));
  for (let i = 0; i < 3; i++) {
    out.push(mention({ candidate_id: "c2", source: "rss_media", outlet: "Medio R", tone: "critica", topic_id: "r-nacion", title: `Milei recorta fondos a las provincias ${i}`, published_at: at(8 + i) }));
  }
  return out;
}

function ctxFor(draft = DRAFT, withRival = true) {
  const all = dataset();
  return buildSimulatorContext({
    candidate: K,
    draft,
    topics,
    mentions: all,
    rival: withRival ? { candidate: M, mentions: all, topics: rivalTopics } : null,
    now: NOW,
  });
}

describe("texto del borrador", () => {
  it("limpia controles y valida largo", () => {
    expect(sanitizeDraft("  hola\u0000  mundo\n\n\n\nfin ")).toBe("hola mundo\n\nfin");
    expect(validateDraft("corto")).toMatch(/al menos/);
    expect(validateDraft("x".repeat(1501))).toMatch(/hasta/);
    expect(validateDraft(DRAFT)).toBeNull();
  });
  it("tokens sin acentos ni stopwords", () => {
    const t = contentTokens("Relación con la Nación y los salarios");
    expect(t.has("relaci")).toBe(true);
    expect(t.has("nacion")).toBe(true);
    expect(t.has("salari")).toBe(true);
    expect(t.has("con")).toBe(false);
  });
});

describe("contexto", () => {
  it("arma públicos con datos reales y referencias cortas únicas", () => {
    const ctx = ctxFor();
    expect(ctx.segments.map((s) => s.key)).toEqual(["simpatizantes", "criticos", "medios", "rival"]);
    const refs = ctx.mentions.map((m) => m.ref);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs[0]).toBe("M1");
    const crit = ctx.segments.find((s) => s.key === "criticos")!;
    expect(crit.total).toBe(6); // 5 en X + 1 nota crítica; la vieja queda afuera de la ventana
    expect(crit.negative_share).toBeNull(); // 100% por definición: no se muestra
    const med = ctx.segments.find((s) => s.key === "medios")!;
    expect(med.negative_share).toBe(25);
    expect(ctx.rival?.name).toBe("Javier Milei");
    expect(ctx.mentions.every((m) => m.url.startsWith("https://"))).toBe(true);
  });

  it("detecta el tema del borrador por la etiqueta y por las menciones", () => {
    const ctx = ctxFor();
    expect(ctx.topic_detected).toBe(true);
    expect(ctx.matched_topics[0].label).toBe("relación con Nación");
    expect(ctx.matched_topics.some((t) => t.label === "otros")).toBe(false);
  });

  it("sin coincidencias usa los temas de más volumen y lo dice", () => {
    const ctx = ctxFor("Hoy inauguramos un polideportivo en Quilmes con vecinos del barrio.");
    expect(ctx.topic_detected).toBe(false);
    expect(ctx.matched_topics.length).toBeGreaterThan(0);
  });

  it("sin rival asignado no hay bloque de rival (Sánchez)", () => {
    const ctx = ctxFor(DRAFT, false);
    expect(ctx.segments.some((s) => s.key === "rival")).toBe(false);
    expect(ctx.rival).toBeNull();
  });

  it("un público con menos de 3 menciones no aparece", () => {
    const ctx = buildSimulatorContext({ candidate: K, draft: DRAFT, topics, mentions: dataset().slice(0, 2), now: NOW });
    expect(ctx.segments.map((s) => s.key)).not.toContain("criticos");
  });

  it("balance firmado", () => {
    expect(signedBalance([mention({ tone: "a_favor" }), mention({ tone: "critica" }), mention({ tone: "insulto" }), mention({ tone: "informativo" })])).toBe(-25);
    expect(signedBalance([])).toBeNull();
  });
});

describe("prompt", () => {
  it("marca datos no confiables, pide refs y no compara volúmenes con el rival", () => {
    const ctx = ctxFor();
    const { system, user } = buildSimulatorPrompt(ctx, DRAFT);
    expect(system).toMatch(/no confiable/);
    expect(system).toMatch(/nunca publiques/);
    expect(system).toMatch(/No compares volúmenes/);
    expect(user).toContain("<datos>");
    expect(user).toContain("<borrador>");
    expect(user).toContain("M1 (");
    expect(user).toContain(DRAFT);
  });
  it("el schema solo acepta los públicos disponibles", () => {
    const schema = outputSchema(["criticos", "medios"]);
    expect(schema.properties.segments.items.properties.key.enum).toEqual(["criticos", "medios"]);
  });
  it("costo máximo estimado chico", () => {
    const ctx = ctxFor();
    const p = prepareSimulation(ctx, DRAFT);
    expect(p.reserveUsd).toBeGreaterThan(0);
    expect(p.reserveUsd).toBeLessThan(SIMULATOR_LIMITS_DEFAULT.maxRequestUsd);
    // 20.000 caracteres de prompt + 2.000 tokens de salida ≈ USD 0,0016.
    expect(estimateMaxCostUsd(20000)).toBeCloseTo(0.001571, 5);
  });
});

function sampleOutput(ctx: ReturnType<typeof ctxFor>) {
  const crit = ctx.segments.find((s) => s.key === "criticos")!;
  return {
    risk_score: 61.6,
    summary: "Los críticos van a contestar que la falta de fondos es de la gestión.",
    suggested_version: "La Provincia va a seguir pagando salarios.",
    segments: [
      {
        key: "criticos",
        reception: "desfavorable",
        reception_text: "Público hostil en estos temas.",
        risks: ["Invita a la respuesta “no es Nación”.", "Un 87% lo rechaza."],
        counter_arguments: [
          { text: "La falta de fondos sería de la Provincia.", refs: [crit.refs[0], "M999"] },
          { text: "Inventado sin referencia.", refs: ["M999"] },
        ],
        tweaks: ["Sumar un dato verificable."],
      },
      { key: "simpatizantes", reception: "rara", reception_text: "", risks: [], counter_arguments: [], tweaks: [] },
      { key: "criticos", reception: "mixta", reception_text: "duplicado", risks: [], counter_arguments: [], tweaks: [] },
      { key: "jubilados", reception: "mixta", reception_text: "no existe", risks: [], counter_arguments: [], tweaks: [] },
    ],
  };
}

describe("control de la salida", () => {
  it("descarta refs inventadas, cifras sin respaldo, públicos duplicados o desconocidos", () => {
    const ctx = ctxFor();
    const out = groundSimulation(sampleOutput(ctx), ctx, DRAFT)!;
    expect(out.risk_score).toBe(62);
    expect(out.risk_level).toBe("medio");
    expect(out.segments.map((s) => s.key)).toEqual(["simpatizantes", "criticos"]);
    const crit = out.segments.find((s) => s.key === "criticos")!;
    expect(crit.counter_arguments).toHaveLength(1);
    expect(crit.counter_arguments[0].refs).toEqual([ctx.segments.find((s) => s.key === "criticos")!.refs[0]]);
    expect(crit.risks).toEqual(["Invita a la respuesta “no es Nación”."]); // el 87% no está en los datos
    expect(out.segments.find((s) => s.key === "simpatizantes")!.reception).toBe("mixta");
    expect(out.dropped).toBeGreaterThanOrEqual(4);
  });
  it("acepta cifras que sí están en los datos", () => {
    const ctx = ctxFor();
    const raw = sampleOutput(ctx);
    raw.segments[0].risks = ["El 25% de las notas de medios en estos temas son negativas."];
    const out = groundSimulation(raw, ctx, DRAFT)!;
    expect(out.segments.find((s) => s.key === "criticos")!.risks).toHaveLength(1);
  });
  it("nada usable → null", () => {
    const ctx = ctxFor();
    expect(groundSimulation({ segments: [{ key: "jubilados" }] }, ctx, DRAFT)).toBeNull();
    expect(groundSimulation("hola", ctx, DRAFT)).toBeNull();
  });
  it("niveles de riesgo", () => {
    expect(riskLevel(10)).toBe("bajo");
    expect(riskLevel(35)).toBe("medio");
    expect(riskLevel(65)).toBe("alto");
  });
  it("lee defensivamente lo guardado", () => {
    const ctx = ctxFor();
    const out = groundSimulation(sampleOutput(ctx), ctx, DRAFT)!;
    const back = normalizeStoredOutput(JSON.parse(JSON.stringify(out)))!;
    expect(back.segments).toHaveLength(2);
    expect(normalizeStoredOutput({})).toBeNull();
    const c = normalizeStoredContext(JSON.parse(JSON.stringify(ctx)));
    expect(c.mentions).toHaveLength(ctx.mentions.length);
    expect(c.rival?.name).toBe("Javier Milei");
    expect(normalizeStoredContext({ mentions: [{ ref: "M1", url: "javascript:alert(1)" }] }).mentions).toHaveLength(0);
  });
});

describe("cupos", () => {
  const limits = { ...SIMULATOR_LIMITS_DEFAULT, perUserWindow: 2, perUserDaily: 3, dailyBudgetUsd: 0.01 };
  const dayStart = new Date("2026-11-25T03:00:00Z");
  const row = (min: number, user = "u1", reserved = 0.001) => ({
    user_id: user,
    created_at: new Date(NOW.getTime() - min * 60000).toISOString(),
    reserved_usd: reserved,
    cost_usd: null,
  });
  it("ráfaga, diario por usuario, presupuesto global y tope por pedido", () => {
    expect(checkQuota({ rows: [], userId: "u1", now: NOW, reserveUsd: 0.002, limits, dayStart })).toBeNull();
    expect(checkQuota({ rows: [row(1), row(2)], userId: "u1", now: NOW, reserveUsd: 0.002, limits, dayStart })).toBe("rate_limited");
    expect(checkQuota({ rows: [row(1), row(2)], userId: "u2", now: NOW, reserveUsd: 0.002, limits, dayStart })).toBeNull();
    expect(checkQuota({ rows: [row(30), row(40), row(50)], userId: "u1", now: NOW, reserveUsd: 0.002, limits, dayStart })).toBe("user_daily_limit");
    expect(checkQuota({ rows: [row(30, "u2", 0.009)], userId: "u1", now: NOW, reserveUsd: 0.002, limits, dayStart })).toBe("daily_budget");
    // Lo de ayer no cuenta para el día.
    expect(checkQuota({ rows: [row(60 * 20, "u2", 0.009)], userId: "u1", now: NOW, reserveUsd: 0.002, limits, dayStart })).toBeNull();
    expect(checkQuota({ rows: [], userId: "u1", now: NOW, reserveUsd: 0.02, limits, dayStart })).toBe("request_too_expensive");
  });
  it("traduce el error de la base a un mensaje sin detalles técnicos", () => {
    const q = quotaErrorFrom('P0001: pulso:rate_limited');
    expect(q).toBe("rate_limited");
    expect(QUOTA_MESSAGE[q!]).not.toMatch(/USD|API|token/i);
    expect(quotaErrorFrom("otra cosa")).toBeNull();
  });
});

describe("repo en memoria", () => {
  function repo(over: Partial<FixtureData> = {}) {
    return new MemoryRepo({
      candidate: K,
      candidates: [K],
      topics,
      mentions: [],
      source_runs: [],
      candidate_sources: [],
      ...over,
    });
  }
  it("start → finish y la lista muestra solo las propias", async () => {
    const r = repo({
      response_simulations: [
        { id: "ajena", candidate_id: "c1", user_id: "otro", draft: DRAFT, status: "ok", output: {}, context: {}, model: null, prompt_version: null, reserved_usd: 0.001, cost_usd: null, error: null, origin: "ai", created_at: NOW.toISOString(), finished_at: null },
      ],
    });
    const id = await r.startResponseSimulation("c1", DRAFT, 0.002);
    await r.finishResponseSimulation(id, { status: "ok", output: { risk_score: 20 }, context: {}, model: "gpt-6-luna", prompt_version: "v1", cost_usd: 0.001, usage: {}, error: null });
    const list = await r.listResponseSimulations("c1", 10);
    expect(list.map((s) => s.id)).toEqual([id]);
    expect(list[0].user_id).toBe(LOCAL_USER_ID);
    expect(list[0].status).toBe("ok");
    await expect(r.finishResponseSimulation(id, { status: "ok", output: {}, context: {}, model: null, prompt_version: "v1", cost_usd: null, usage: {}, error: null })).rejects.toThrow(/pulso:not_found/);
    expect(await r.getResponseSimulation("c1", "ajena")).toBeNull();
  });
  it("respeta la ráfaga y la migración sin aplicar", async () => {
    const r = repo({ simulator_limits: { ...SIMULATOR_LIMITS_DEFAULT, perUserWindow: 1 } });
    await r.startResponseSimulation("c1", DRAFT, 0.002);
    await expect(r.startResponseSimulation("c1", DRAFT, 0.002)).rejects.toThrow(/pulso:rate_limited/);
    const off = repo({ simulator_limits: null });
    expect(await off.getSimulatorLimits()).toBeNull();
    await expect(off.startResponseSimulation("c1", DRAFT, 0.002)).rejects.toThrow(/pulso:disabled/);
    await expect(repo().startResponseSimulation("zz", DRAFT, 0.002)).rejects.toThrow(/pulso:forbidden/);
  });
});

describe("llamada al modelo (fetch simulado)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  function stub(content: unknown, usage = { prompt_tokens: 5000, completion_tokens: 1500 }) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: "gpt-6-luna", usage, choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  it("manda el schema estricto con los públicos, valida y calcula el costo", async () => {
    vi.stubEnv("LLM_API_KEY", "test-key-not-real");
    const ctx = ctxFor();
    const fetchMock = stub(sampleOutput(ctx));
    const prepared = prepareSimulation(ctx, DRAFT);
    const res = await requestSimulation(prepared, ctx, DRAFT, 0.01);
    expect(res.output?.segments.map((s) => s.key)).toEqual(["simpatizantes", "criticos"]);
    expect(res.cost_usd).toBeCloseTo(0.00125, 6);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties.segments.items.properties.key.enum).toEqual(["simpatizantes", "criticos", "medios", "rival"]);
    expect(body.max_completion_tokens).toBe(2000);
  });
  it("si supera el tope por pedido no devuelve salida, pero informa el costo", async () => {
    vi.stubEnv("LLM_API_KEY", "test-key-not-real");
    const ctx = ctxFor();
    stub(sampleOutput(ctx), { prompt_tokens: 5000, completion_tokens: 1500 });
    const res = await requestSimulation(prepareSimulation(ctx, DRAFT), ctx, DRAFT, 0.001);
    expect(res.output).toBeNull();
    expect(res.error).toBe("over_request_cap");
    expect(res.cost_usd).toBeGreaterThan(0.001);
  });
  it("salida inválida → sin resultado", async () => {
    vi.stubEnv("LLM_API_KEY", "test-key-not-real");
    const ctx = ctxFor();
    stub({ segments: [] });
    const res = await requestSimulation(prepareSimulation(ctx, DRAFT), ctx, DRAFT, 0.01);
    expect(res.output).toBeNull();
    expect(res.error).toBe("ungrounded");
  });
  it("sin clave en el servidor, falla sin llamar", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = stub({});
    const ctx = ctxFor();
    await expect(requestSimulation(prepareSimulation(ctx, DRAFT), ctx, DRAFT, 0.01)).rejects.toThrow(/LLM_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("navegación", () => {
  it("el simulador está para todos los candidatos", () => {
    for (const slug of ["axel-kicillof", "pedro-sanchez", "milei"]) expect(sectionAvailable("simulador", slug)).toBe(true);
  });
});
