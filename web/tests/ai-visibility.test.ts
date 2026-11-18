import { describe, expect, it } from "vitest";
import { MemoryRepo } from "@/lib/data/memory";
import {
  answersOnDay,
  balanceTone,
  dailyScores,
  domainRanking,
  formatBalance,
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
