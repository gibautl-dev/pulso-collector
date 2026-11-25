import { describe, expect, it } from "vitest";
import { balanceCaption, balanceTone } from "@/lib/balance";

describe("balanceTone y leyenda", () => {
  it("sigue el signo con umbral ±5 y la leyenda coincide", () => {
    expect(balanceTone(6)).toBe("positive");
    expect(balanceCaption(6)).toBe("A favor");
    expect(balanceTone(-6)).toBe("negative");
    expect(balanceCaption(-6)).toBe("En contra");
    expect(balanceTone(5)).toBe("default");
    expect(balanceTone(-5)).toBe("default");
    expect(balanceTone(0)).toBe("default");
    expect(balanceTone(2)).toBe("default");
    expect(balanceTone(-3)).toBe("default");
    expect(balanceCaption(0)).toBe("Neutro");
    expect(balanceCaption(-5)).toBe("Neutro");
    expect(balanceTone(null)).toBe("default");
    expect(balanceCaption(null)).toBe("Sin tono clasificado");
  });
});
