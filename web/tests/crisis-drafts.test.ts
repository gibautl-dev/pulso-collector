import { describe, expect, it } from "vitest";
import { draftAudience } from "@/lib/crisis-drafts";

describe("draftAudience", () => {
  it("marca X y comunicado para la cuenta oficial, con el nombre del candidato", () => {
    const x = draftAudience("x", "Pedro Sánchez");
    expect(x.kind).toBe("oficial");
    expect(x.label).toBe("Para la cuenta oficial del candidato");
    expect(x.hint).toContain("Pedro Sánchez");
    expect(x.hint.toLowerCase()).not.toContain("kicillof");

    const press = draftAudience("comunicado", "Axel Kicillof");
    expect(press.kind).toBe("oficial");
    expect(press.label).toBe("Para la cuenta oficial del candidato");
    expect(press.hint).toContain("Axel Kicillof");
  });

  it("marca argumento oral y vocero para un vocero, sin hardcodear un nombre", () => {
    const oral = draftAudience("argumento_oral", "Pedro Sánchez");
    expect(oral.kind).toBe("vocero");
    expect(oral.label).toBe("Para un vocero");
    expect(oral.hint).toContain("Pedro Sánchez");

    const typed = draftAudience("x", "Nombre Genérico", { type: "vocero" });
    expect(typed.kind).toBe("vocero");
    expect(typed.label).toBe("Para un vocero");
  });
});
