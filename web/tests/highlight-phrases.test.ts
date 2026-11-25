import { describe, expect, it } from "vitest";
import { highlightCoverage, highlightSegments } from "@/lib/highlight-phrases";

describe("highlightSegments", () => {
  const text = "Se lo conoce por la obra del acueducto y por su plan de seguridad. Los críticos señalan demoras en las tarifas.";
  it("marca frases positivas y negativas que aparecen en el texto", () => {
    const segs = highlightSegments(text, ["la obra del acueducto", "plan de seguridad"], ["demoras en las tarifas"]);
    const marked = segs.filter((s) => s.tone);
    expect(marked.map((s) => [s.tone, s.text])).toEqual([
      ["positive", "la obra del acueducto"],
      ["positive", "plan de seguridad"],
      ["negative", "demoras en las tarifas"],
    ]);
  });
  it("ignora mayúsculas y tildes", () => {
    const segs = highlightSegments("Demoras en las tarifas de agua.", [], ["demoras en las tarifas"]);
    expect(segs.some((s) => s.tone === "negative" && s.text.toLowerCase().includes("demoras"))).toBe(true);
  });
  it("no inventa un subrayado si la frase no está", () => {
    const segs = highlightSegments("Una respuesta genérica.", ["la obra del acueducto"], ["costo de la obra"]);
    expect(segs).toEqual([{ text: "Una respuesta genérica.", tone: null }]);
    expect(highlightCoverage("Una respuesta genérica.", ["la obra del acueducto"], []).missed).toEqual([
      "la obra del acueducto",
    ]);
  });
});
