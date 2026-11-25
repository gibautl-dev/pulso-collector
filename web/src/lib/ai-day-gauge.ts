import { answerPolarity, answersOnDay, computeAiDashboard, type AnswerPolarity } from "./ai-visibility";
import type { AiAnswer } from "./types";

/**
 * Balance del día: promedio de los `balance` ya guardados (de −100 a +100)
 * de las respuestas de la última foto diaria (`asked_on` más reciente).
 * Las tarjetas A favor / En contra / Neutrales son la proporción de esas
 * mismas respuestas, con el umbral existente: >5 a favor, <−5 en contra,
 * el resto neutrales. Si no hay foto diaria, se devuelve null (estado vacío).
 */
export function dayBalanceGauge(answers: AiAnswer[]): {
  day: string;
  balance: number | null;
  positiveShare: number | null;
  negativeShare: number | null;
  neutralShare: number | null;
  answers: number;
  classified: number;
} | null {
  const view = computeAiDashboard(answers);
  if (!view.latestDay) return null;
  const latest = answersOnDay(answers, view.latestDay);
  const scored = latest.filter((a) => typeof a.balance === "number");
  if (scored.length === 0) {
    return {
      day: view.latestDay,
      balance: null,
      positiveShare: null,
      negativeShare: null,
      neutralShare: null,
      answers: latest.length,
      classified: 0,
    };
  }
  const counts: Record<AnswerPolarity, number> = { positive: 0, negative: 0, neutral: 0 };
  for (const a of scored) {
    const p = answerPolarity(a.balance);
    if (p) counts[p]++;
  }
  const classified = scored.length;
  const avg = Math.round((scored.reduce((s, a) => s + (a.balance as number), 0) / classified) * 10) / 10;
  return {
    day: view.latestDay,
    balance: avg,
    positiveShare: counts.positive / classified,
    negativeShare: counts.negative / classified,
    neutralShare: counts.neutral / classified,
    answers: latest.length,
    classified,
  };
}
