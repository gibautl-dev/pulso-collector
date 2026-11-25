import { describe, expect, it } from "vitest";
import {
  alertHeadline,
  comparisonSpotlight,
  formatShareDeltaPp,
  pickHighestRiskAlert,
  pickMainRival,
  pickTopCustomTopic,
  shareDeltaPp,
} from "@/lib/home-spotlights";

describe("comparación en el tablero", () => {
  it("elige el rival con más menciones y calcula el delta en puntos porcentuales", () => {
    const main = pickMainRival([
      { id: "a", mentions: 10 },
      { id: "b", mentions: 40 },
    ]);
    expect(main?.id).toBe("b");
    expect(shareDeltaPp(0.45, 0.41)).toBe(4);
    expect(formatShareDeltaPp(4, 7)).toBe("+4 pp vs semana anterior");
    expect(formatShareDeltaPp(null, 7)).toBe("sin base anterior");

    const spot = comparisonSpotlight({
      candidate: { id: "c", name: "Axel Kicillof", slug: "axel-kicillof" },
      rivals: [{ id: "r", name: "Javier Milei", slug: "milei", mentions: 40, previousMentions: 50 }],
      candidateMentions: 60,
      candidatePreviousMentions: 50,
      days: 7,
    });
    expect(spot.kind).toBe("ready");
    expect(spot.headline).toBe("60% vs 40%");
    expect(spot.rivalName).toBe("Javier Milei");
    // 60/100 vs 50/100 → +10 pp
    expect(spot.deltaPp).toBe(10);
    expect(spot.deltaLabel).toBe("+10 pp vs semana anterior");
  });

  it("queda vacío sin rivales y sin menciones si la ventana no tiene datos", () => {
    const empty = comparisonSpotlight({
      candidate: { id: "c", name: "Pedro Sánchez", slug: "pedro-sanchez" },
      rivals: [],
      candidateMentions: 12,
      candidatePreviousMentions: 8,
      days: 7,
    });
    expect(empty.kind).toBe("empty");
    const none = comparisonSpotlight({
      candidate: { id: "c", name: "Axel Kicillof", slug: "axel-kicillof" },
      rivals: [{ id: "r", name: "Javier Milei", slug: "milei", mentions: 0, previousMentions: 0 }],
      candidateMentions: 0,
      candidatePreviousMentions: 0,
      days: 7,
    });
    expect(none.kind).toBe("no_mentions");
  });
});

describe("equipo de acción", () => {
  it("toma la alerta pendiente de mayor riesgo y un título usable", () => {
    const top = pickHighestRiskAlert([
      { id: "1", status: "resolved", severity: "alto", last_detected_at: "2026-11-25T10:00:00Z", trigger_type: "rising_topic" },
      { id: "2", status: "new", severity: "medio", last_detected_at: "2026-11-25T12:00:00Z", trigger_type: "rising_topic" },
      { id: "3", status: "in_review", severity: "alto", last_detected_at: "2026-11-24T10:00:00Z", trigger_type: "negative_spike" },
      { id: "4", status: "new", severity: "alto", last_detected_at: "2026-11-25T11:00:00Z", trigger_type: "rising_topic" },
    ]);
    expect(top?.id).toBe("4");
    expect(pickHighestRiskAlert([{ id: "x", status: "resolved", severity: "alto", last_detected_at: "2026-11-25T10:00:00Z", trigger_type: "rising_topic" }])).toBeNull();
    expect(
      alertHeadline({
        cluster_label: "Cómo buscar trabajo en la Provincia: Kicillof presentó el nuevo portal",
        trigger_type: "rising_topic",
      }),
    ).toContain("portal");
  });
});

describe("temas a medida", () => {
  it("elige el tema con más menciones y, en empate, el que tiene pico", () => {
    const top = pickTopCustomTopic([
      { id: "a", stats: { volume: 3, spike: true } },
      { id: "b", stats: { volume: 10, spike: false } },
      { id: "c", stats: { volume: 10, spike: true } },
    ]);
    expect(top?.id).toBe("c");
    expect(pickTopCustomTopic([])).toBeNull();
  });
});
