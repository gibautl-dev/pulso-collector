import { describe, expect, it } from "vitest";
import { MemoryRepo } from "@/lib/data/memory";
import {
  answersOnDay,
  balanceTone,
  computeAiDashboard,
  dailyScores,
  domainRanking,
  formatBalance,
  formatShare,
  cleanQuote,
  extractQuote,
  groupClaims,
  latestDay,
} from "@/lib/ai-visibility";
import type { AiAnswer } from "@/lib/types";

function answer(over: Partial<AiAnswer> = {}): AiAnswer {
  return {
    id: over.id ?? "a1",
    candidate_id: over.candidate_id ?? "c1",
    provider: "openai",
    model: "chat-latest",
    prompt_key: over.prompt_key ?? "quien_es",
    prompt: over.prompt ?? "¿Quién es Axel Kicillof?",
    answer: over.answer ?? "Texto de ejemplo.",
    citations: over.citations ?? [
      { url: "https://www.lanacion.com.ar/nota", title: "LA NACION", domain: "lanacion.com.ar", kept: true },
      { url: "https://los40.com/x", title: "LOS40", domain: "los40.com", kept: false, filter_reason: "fuera_de_argentina" },
    ],
    balance: over.balance ?? 10,
    balance_reason: "Saldo levemente favorable.",
    positives: over.positives ?? ["Reelección"],
    negatives: over.negatives ?? ["Inflación"],
    topics: over.topics ?? ["gestión provincial"],
    other_politicians: over.other_politicians ?? ["Javier Milei"],
    asked_at: over.asked_at ?? "2026-11-18T13:50:00-03:00",
    asked_on: over.asked_on ?? "2026-11-18",
    cost: 0.08,
    classification_model: "gpt-6-luna",
  };
}

describe("agregados de visibilidad en IA", () => {
  it("promedia el balance por día y no cuenta las citas filtradas", () => {
    const rows = [
      answer({ id: "1", prompt_key: "quien_es", balance: 10, asked_on: "2026-11-17" }),
      answer({ id: "2", prompt_key: "seguridad", balance: -20, asked_on: "2026-11-17" }),
      answer({
        id: "3",
        prompt_key: "quien_es",
        balance: 4,
        asked_on: "2026-11-18",
        citations: [
          { url: "https://www.clarin.com/a", title: "Clarín", domain: "clarin.com", kept: true },
          { url: "https://www.lanacion.com.ar/a", title: "LA NACION", domain: "lanacion.com.ar", kept: true },
        ],
      }),
    ];
    const scores = dailyScores(rows);
    expect(scores).toEqual([
      { day: "2026-11-17", balance: -5, answers: 2 },
      { day: "2026-11-18", balance: 4, answers: 1 },
    ]);
    expect(latestDay(rows)).toBe("2026-11-18");
    expect(answersOnDay(rows, "2026-11-17")).toHaveLength(2);
    expect(domainRanking(rows).map((d) => d.domain)).toEqual(["lanacion.com.ar", "clarin.com"]);
    expect(formatBalance(-5)).toBe("-5");
    expect(formatBalance(12)).toBe("+12");
    expect(balanceTone(-8)).toBe("negative");
    expect(balanceTone(2)).toBe("default");
  });
});

describe("MemoryRepo listAiAnswers", () => {
  it("filtra por candidato y no mezcla filas", async () => {
    const repo = new MemoryRepo({
      candidate: { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" },
      topics: [],
      mentions: [],
      source_runs: [],
      candidate_sources: [],
      ai_answers: [
        answer({ id: "a1", candidate_id: "c1" }),
        answer({ id: "a2", candidate_id: "c2", prompt_key: "otra" }),
      ],
    });
    const rows = await repo.listAiAnswers("c1");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("a1");
  });
});

describe("tablero de En la IA", () => {
  it("calcula el balance general, las proporciones y agrupa lo bueno y lo malo", () => {
    const rows = [
      answer({ id: "1", prompt_key: "quien_es", prompt: "¿Quién es?", balance: 12, asked_on: "2026-11-17", positives: ["Reelección en 2023"], negatives: ["Inflación"], answer: "Fue reelegido gobernador en 2023. Lo critican por la inflación." }),
      answer({ id: "2", prompt_key: "economia", prompt: "¿Cómo está la economía?", balance: -18, asked_on: "2026-11-17", positives: [], negatives: ["Déficit y presión tributaria"], answer: "Persistió el déficit y se cuestiona la presión tributaria." }),
      answer({ id: "3", prompt_key: "quien_es", prompt: "¿Quién es?", balance: 10, asked_on: "2026-11-18", positives: ["Reelegido gobernador en 2023"], negatives: ["Inflación y controles"], answer: "Lo reelegido como gobernador en 2023 convive con críticas por inflación." }),
    ];
    const view = computeAiDashboard(rows);
    expect(view.insufficient).toBe(false);
    expect(view.classified).toBe(3);
    expect(view.positive).toBe(2);
    expect(view.negative).toBe(1);
    expect(view.neutral).toBe(0);
    expect(formatShare(view.positiveShare)).toBe("67%");
    expect(view.overallBalance).toBeCloseTo(1.3, 1);
    expect(view.trendInsufficient).toBe(false);
    expect(view.trend).toBe(13); // 10 - (-3)
    expect(view.positives[0].count).toBe(2);
    expect(view.positives[0].text.toLowerCase()).toContain("reeleg");
    expect(view.positives[0].examples[0].quote.length).toBeGreaterThan(10);
    expect(view.questions[0].promptKey).toBe("economia"); // worst first
    expect(view.questions.at(-1)?.promptKey).toBe("quien_es");
  });

  it("marca datos insuficientes sin respuestas o con menos de tres clasificadas", () => {
    expect(computeAiDashboard([]).insufficient).toBe(true);
    expect(computeAiDashboard([answer({ balance: 4 }), answer({ id: "x", prompt_key: "otra", balance: -2 })]).insufficient).toBe(true);
  });

  it("agrupa afirmaciones parecidas sin una llamada extra al modelo", () => {
    const groups = groupClaims([
      { text: "Reelegido gobernador en 2023", promptKey: "quien_es", prompt: "¿Quién es?", answer: "Fue reelegido gobernador en 2023 con un discurso de gestión.", askedOn: "2026-11-18" },
      { text: "Reelección en 2023", promptKey: "presidente", prompt: "¿Puede ser presidente?", answer: "Su reelección en 2023 fortaleció el liderazgo.", askedOn: "2026-11-18" },
      { text: "Construcción de escuelas", promptKey: "educacion", prompt: "¿Educación?", answer: "Destaca la construcción de escuelas.", askedOn: "2026-11-18" },
    ]);
    const reelect = groups.find((g) => /reeleg|reels/i.test(g.text) || /2023/.test(g.text) && /reele/i.test(g.text));
    expect(groups[0].count).toBeGreaterThanOrEqual(2);
    expect(groups.some((g) => g.count === 2)).toBe(true);
  });
});

describe("citas de lo bueno y lo malo", () => {
  it("limpia markdown y URLs de las citas", () => {
    const raw = "Su gestión se caracteriza por priorizar la inversión ([axelkicillof.com.ar](https://axelkicillof.com.ar/bio)). **Educación** y salud.";
    expect(cleanQuote(raw)).toBe("Su gestión se caracteriza por priorizar la inversión (axelkicillof.com.ar). Educación y salud.");
    const quote = extractQuote(raw, "priorizar la inversión en educación");
    expect(quote).not.toContain("https://");
    expect(quote).not.toContain("**");
  });
});
