import { describe, expect, it } from "vitest";
import {
  estimateOnboardingCosts,
  matchExistingCandidate,
  parseSuggestions,
  projectMonthly,
  slugifyName,
  tokenCostUsd,
} from "@/lib/rival-suggest";
import { regionFor } from "@/lib/region";

const kici = { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" };
const pedro = { id: "c2", slug: "pedro-sanchez", name: "Pedro Sánchez" };

describe("slugifyName y match", () => {
  it("arma slugs y reconoce un candidato ya medido", () => {
    expect(slugifyName("Pedro Sánchez")).toBe("pedro-sanchez");
    expect(matchExistingCandidate("Pedro Sánchez", [kici, pedro])?.slug).toBe("pedro-sanchez");
    expect(matchExistingCandidate("Alberto Fernández", [kici, pedro])).toBeNull();
  });
});

describe("parseSuggestions", () => {
  it("deja entre 5 y 8, marca los que ya están en Pulso y no inventa un match flojo", () => {
    const parsed = parseSuggestions(
      {
        suggestions: [
          { name: "Pedro Sánchez", arena: "España", reason: "Ya se mide." },
          { name: "Alberto Núñez Feijóo", arena: "España", reason: "Lidera la oposición." },
          { name: "Yolanda Díaz", arena: "España", reason: "Espacio a la izquierda." },
          { name: "Santiago Abascal", arena: "España", reason: "Vox." },
          { name: "Isabel Díaz Ayuso", arena: "España", reason: "Madrid." },
          { name: "  ", arena: "España", reason: "vacío" },
        ],
      },
      [kici, pedro],
    );
    expect(parsed).toHaveLength(5);
    expect(parsed[0]).toMatchObject({ already_in_pulso: true, matched_candidate_slug: "pedro-sanchez" });
    expect(parsed[1].already_in_pulso).toBe(false);
  });
});

describe("estimación de costo", () => {
  it("no inventa un total si no hay costos de medios o X, y proyecta solo En la IA", () => {
    const rows = [
      { candidate_id: "c1", source: "ia", date: "2026-11-18", cost_usd: 0.88 },
      { candidate_id: "c1", source: "ia", date: "2026-11-19", cost_usd: 0.88 },
    ];
    const estimates = estimateOnboardingCosts(regionFor("axel-kicillof"), rows, { measured: [kici, pedro] });
    expect(estimates[0].level).toBe("radar");
    expect(estimates[0].monthly_usd).toBeNull();
    expect(estimates[0].detail.toLowerCase()).toContain("desconocido");
    expect(estimates[1].monthly_usd).toBeNull();
    expect(estimates[2].level).toBe("completo");
    expect(estimates[2].monthly_usd).toBeCloseTo(0.88 * 30, 5);
    expect(estimates[2].complete).toBe(false);
    expect(estimates[2].detail.toLowerCase()).toContain("en la ia");
  });

  it("no usa costos de otra arena", () => {
    const rows = [{ candidate_id: "c1", source: "ia", date: "2026-11-18", cost_usd: 0.88 }];
    const estimates = estimateOnboardingCosts(regionFor("pedro-sanchez"), rows, { measured: [kici, pedro] });
    expect(estimates[2].monthly_usd).toBeNull();
    expect(estimates[2].detail.toLowerCase()).toContain("no hay costos registrados comparables");
  });

  it("admite que un solo día es una proyección frágil", () => {
    const snap = projectMonthly([{ date: "2026-11-24", cost_usd: 0.85 }]);
    expect(snap?.days).toBe(1);
    expect(snap?.monthly_usd).toBeCloseTo(25.5, 5);
  });
});

describe("tokenCostUsd", () => {
  it("usa los precios de gpt-6-luna y no inventa otro modelo", () => {
    expect(tokenCostUsd("gpt-6-luna", { input_tokens: 1_000_000, output_tokens: 0 })).toBe(0.1);
    expect(tokenCostUsd("chat-latest", { input_tokens: 1000, output_tokens: 1000 })).toBeNull();
  });
});
