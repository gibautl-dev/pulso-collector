import { describe, expect, it } from "vitest";
import {
  articleUrl,
  computeWikipediaInterest,
  formatDayLabel,
  formatViews,
  shiftDay,
} from "@/lib/wikipedia-pageviews";
import type { WikipediaPageview } from "@/lib/types";

const C = "11111111-0000-0000-0000-000000000001";

function row(day: string, views: number): WikipediaPageview {
  return { candidate_id: C, project: "es.wikipedia", article: "Axel_Kicillof", day, views };
}

describe("computeWikipediaInterest", () => {
  it("toma el último día, compara con 7 días antes y arma la serie", () => {
    const interest = computeWikipediaInterest([
      row("2026-11-17", 800),
      row("2026-11-18", 810),
      row("2026-11-24", 1100),
    ]);
    expect(interest?.lastDay).toBe("2026-11-24");
    expect(interest?.lastViews).toBe(1100);
    expect(interest?.previousViews).toBe(800);
    expect(interest?.changePercent).toBe(38);
    expect(interest?.url).toBe("https://es.wikipedia.org/wiki/Axel_Kicillof");
    expect(interest?.series).toHaveLength(3);
  });

  it("devuelve null sin filas y no inventa una variación sin semana anterior", () => {
    expect(computeWikipediaInterest([])).toBeNull();
    const interest = computeWikipediaInterest([row("2026-11-24", 100)]);
    expect(interest?.previousViews).toBeNull();
    expect(interest?.changePercent).toBeNull();
  });

  it("formatea el día y las visitas en español", () => {
    expect(formatViews(1100)).toMatch(/1.?100/);
    expect(formatDayLabel("2026-11-24").toLowerCase()).toContain("nov");
    expect(shiftDay("2026-11-24", -7)).toBe("2026-11-17");
    expect(articleUrl("es.wikipedia", "Pedro_Sánchez")).toContain("Pedro_S");
  });
});
