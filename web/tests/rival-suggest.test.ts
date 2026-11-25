import { describe, expect, it } from "vitest";
import {
  buildOnboardingCostTable,
  COST_REPORT,
  hasDuplicatePending,
  matchExistingCandidate,
  namesMatchPending,
  parseSuggestions,
  projectMonthly,
  keywordsFromPendingName,
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

  it("arma keywords con el apellido como alias", () => {
    expect(keywordsFromPendingName("Javier Milei")).toEqual(["Javier Milei", "Milei"]);
    expect(keywordsFromPendingName("Milei")).toEqual(["Milei"]);
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

describe("tabla de costo de un alta", () => {
  it("usa las cifras del informe, con EST/CALC, y no aplica En la IA de Argentina a España", () => {
    const ar = buildOnboardingCostTable(regionFor("axel-kicillof"));
    expect(ar.map((r) => r.level)).toEqual(["radar", "comparativo", "completo"]);
    expect(ar[0].amount).toContain("1–2 EST");
    expect(ar[1].note.toLowerCase()).toContain("sin dato");
    expect(ar[2].amount).toContain(`USD ${COST_REPORT.iaVisibilityUsdMonth}`);
    expect(ar[2].amount).toContain("63 CALC");
    const es = buildOnboardingCostTable(regionFor("pedro-sanchez"));
    expect(es[2].amount).not.toContain(`USD ${COST_REPORT.iaVisibilityUsdMonth}`);
    expect(es[2].note.toLowerCase()).toContain("sin dato");
    expect(es[2].amount).toContain("63 CALC");
  });

  it("trata Milei y mileí como el mismo pedido de alta", () => {
    expect(namesMatchPending("Milei", "mileí")).toBe(true);
    expect(namesMatchPending("Javier Milei", "javier   milei")).toBe(true);
    expect(
      hasDuplicatePending("MILEÍ", [{ name: "Milei", status: "pendiente_de_alta", requested_for_candidate_id: "c1" }], "c1"),
    ).toBe(true);
    expect(
      hasDuplicatePending("Milei", [{ name: "Milei", status: "borrado", requested_for_candidate_id: "c1" }], "c1"),
    ).toBe(false);
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
