import { describe, expect, it } from "vitest";
import {
  collectSearchTerms,
  computeTopicStats,
  detectTopicSpike,
  estimateClassificationCost,
  mentionMatchesTopic,
  parseSummaryOutput,
  termMatches,
  CUSTOM_TOPIC_CLASSIFY_USD_PER_MENTION,
} from "@/lib/custom-topics";
import type { CustomTopic, Mention } from "@/lib/types";

const topic: CustomTopic = {
  id: "t1",
  candidate_id: "c1",
  name: "Salud pública",
  description: "Hospitales y salud en la provincia",
  keywords: ["salud", "hospital"],
  include_terms: ["médicos"],
  exclude_terms: ["salud mental animal"],
  sources: null,
  enabled: true,
  created_at: "2026-11-24T00:00:00-03:00",
  updated_at: "2026-11-24T00:00:00-03:00",
};

function mention(partial: Partial<Mention> & Pick<Mention, "id" | "title" | "published_at">): Mention {
  return {
    candidate_id: "c1",
    source: "rss_media",
    url: `https://example.com/${partial.id}`,
    content: null,
    author: null,
    outlet: "Diario",
    collected_at: partial.published_at,
    account_relation: "third_party",
    tone: "critica",
    tone_reason: null,
    tone_confidence: 0.8,
    target: "candidate",
    topic_id: null,
    relevance: "alta",
    classified_at: partial.published_at,
    classification_model: null,
    classification_prompt_version: null,
    metrics: null,
    ...partial,
  };
}

describe("matching de temas a medida", () => {
  it("recorta por palabra completa, con y sin acento, y respeta exclusiones", () => {
    expect(termMatches("salud", " se discute la salud publica ")).toBe(true);
    expect(termMatches("salud", " se discute la salutacion ")).toBe(false);
    expect(collectSearchTerms(topic)).toEqual(["salud", "hospital", "médicos"]);
    expect(
      mentionMatchesTopic(topic, mention({ id: "1", title: "Crisis en los hospitales bonaerenses", published_at: "2026-11-24T12:00:00-03:00" })),
    ).toBe(true);
    expect(
      mentionMatchesTopic(topic, mention({ id: "2", title: "Salud mental animal en una feria", published_at: "2026-11-24T12:00:00-03:00" })),
    ).toBe(false);
    expect(
      mentionMatchesTopic(topic, mention({ id: "3", title: "Otro candidato, otra agenda", published_at: "2026-11-24T12:00:00-03:00" })),
    ).toBe(false);
  });

  it("si hay filtro de fuentes, no mezcla X con medios", () => {
    const mediaOnly = { ...topic, sources: ["rss_media", "google_news"] };
    expect(
      mentionMatchesTopic(
        mediaOnly,
        mention({ id: "x", title: "Hospital desbordado", published_at: "2026-11-24T12:00:00-03:00", source: "x" }),
      ),
    ).toBe(false);
  });
});

describe("métricas y pico", () => {
  it("calcula volumen, tendencia y un pico sin inventar costos de recolección", () => {
    const now = new Date("2026-11-24T18:00:00-03:00");
    const mentions = [
      mention({ id: "a", title: "Hospital de La Plata", published_at: "2026-11-24T10:00:00-03:00" }),
      mention({ id: "b", title: "Salud en el conurbano", published_at: "2026-11-23T10:00:00-03:00" }),
      mention({ id: "c", title: "Salud: nuevo anuncio", published_at: "2026-11-22T10:00:00-03:00" }),
      mention({ id: "d", title: "Hospitales", published_at: "2026-11-21T10:00:00-03:00" }),
      mention({ id: "e", title: "Salud pública", published_at: "2026-11-20T10:00:00-03:00" }),
      mention({ id: "f", title: "Un hospital la semana pasada", published_at: "2026-11-14T10:00:00-03:00" }),
    ];
    const stats = computeTopicStats(topic, mentions, { now, days: 7, timeZone: "America/Argentina/Buenos_Aires" });
    expect(stats.volume).toBe(5);
    expect(stats.previousVolume).toBe(1);
    expect(stats.trendPct).toBeGreaterThan(0);
    expect(stats.balance.negativo).toBe(5);
    expect(stats.balance.score).toBe(-100);
    expect(stats.balance.label).toBe("En contra");
    expect(stats.topMentions[0].id).toBe("a");
    expect(detectTopicSpike({ recent3d: 6, previous7d: 3 })).toBe(true);
    expect(detectTopicSpike({ recent3d: 2, previous7d: 20 })).toBe(false);
    const cost = estimateClassificationCost(stats.volume, { days: 7 });
    expect(cost.classifyPerMentionUsd).toBe(CUSTOM_TOPIC_CLASSIFY_USD_PER_MENTION);
    expect(cost.classifyCurrentWindowUsd).toBeCloseTo(5 * CUSTOM_TOPIC_CLASSIFY_USD_PER_MENTION);
    expect(cost.detail).toMatch(/no tiene costo de API/);
  });
});

describe("parseSummaryOutput", () => {
  it("exige un texto usable, no un objeto vacío", () => {
    expect(parseSummaryOutput({})).toBeNull();
    const ok = parseSummaryOutput({
      happening: "Hay tensión en los hospitales.",
      risks: ["Se instala el recorte como narrativa."],
      opportunities: ["Mostrar números de gestión, con fuente."],
      angles: [{ title: "Cifras de camas", body: "Un posteo con el dato y el recaudo de no pelear en X." }],
    });
    expect(ok?.angles).toHaveLength(1);
  });
});
