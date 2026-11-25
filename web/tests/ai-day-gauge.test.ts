import { describe, expect, it } from "vitest";
import { dayBalanceGauge } from "@/lib/ai-day-gauge";
import type { AiAnswer } from "@/lib/types";

function answer(over: Partial<AiAnswer> = {}): AiAnswer {
  return {
    id: "1",
    candidate_id: "c1",
    provider: "openai",
    model: "chat-latest",
    prompt_key: "quien",
    prompt: "¿Quién es?",
    answer: "Un candidato.",
    citations: [],
    balance: 10,
    balance_reason: null,
    positives: [],
    negatives: [],
    topics: [],
    other_politicians: [],
    asked_at: "2026-11-25T12:00:00Z",
    asked_on: "2026-11-25",
    cost: null,
    classification_model: null,
    ...over,
  };
}

describe("dayBalanceGauge", () => {
  it("promedia los balances del último día y parte las polaridades con el umbral ±5", () => {
    const g = dayBalanceGauge([
      answer({ id: "a", balance: 20, prompt_key: "q1" }),
      answer({ id: "b", balance: -10, prompt_key: "q2" }),
      answer({ id: "c", balance: 0, prompt_key: "q3" }),
      answer({ id: "old", balance: 90, asked_on: "2026-11-20", asked_at: "2026-11-20T12:00:00Z" }),
    ]);
    expect(g?.day).toBe("2026-11-25");
    expect(g?.balance).toBe(3.3);
    expect(g?.classified).toBe(3);
    expect(g?.positiveShare).toBeCloseTo(1 / 3);
    expect(g?.negativeShare).toBeCloseTo(1 / 3);
    expect(g?.neutralShare).toBeCloseTo(1 / 3);
  });
  it("devuelve null si no hay respuestas", () => {
    expect(dayBalanceGauge([])).toBeNull();
  });
});
