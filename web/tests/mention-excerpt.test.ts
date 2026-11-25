import { describe, expect, it } from "vitest";
import { cleanMentionText, mentionHeadline } from "@/lib/mention-excerpt";

describe("cleanMentionText", () => {
  it("convierte una lista de capítulos de YouTube en un extracto legible", () => {
    const raw =
      "| 0:00 | Presentación y temas sobre Argentina |\n| 0:33 | Visita del señor Puertas |\n| 2:17 | Bienes, inversiones y salud |";
    const out = cleanMentionText(raw, { maxLength: 80 });
    expect(out).not.toMatch(/\d:\d{2}/);
    expect(out).not.toContain("|");
    expect(out).toContain("Presentación y temas sobre Argentina");
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(80);
  });

  it("saca URLs y recorta con elipsis", () => {
    const out = cleanMentionText(
      "El hospital de niños necesita fondos https://t.co/abc123 y no hay que joder más con los nenes enfermos en la guardia esta semana",
      { maxLength: 60 },
    );
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).not.toContain("t.co");
    expect(out.endsWith("…")).toBe(true);
  });

  it("deja un título normal intacto si entra en el recorte", () => {
    expect(cleanMentionText("El Gobierno reconoció fondos pendientes")).toBe(
      "El Gobierno reconoció fondos pendientes",
    );
  });
});

describe("mentionHeadline", () => {
  it("saca el sufijo de Google News y usa el contenido si el título queda vacío", () => {
    expect(
      mentionHeadline({ title: "Nuevo hospital - Diario Demo", outlet: "Diario Demo" }),
    ).toBe("Nuevo hospital");
    expect(mentionHeadline({ title: "   ", content: "Guardia colapsada en el hospital." })).toBe(
      "Guardia colapsada en el hospital.",
    );
  });
});
