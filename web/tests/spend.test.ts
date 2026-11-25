import { describe, expect, it } from "vitest";
import { CLASSIFIER_EST_USD_PER_MENTION, X_USD_PER_POST, fmtUsd, monthRange, summarizeSpend, type SpendReport } from "@/lib/spend";

const K = "k";
const S = "s";
function report(over: Partial<SpendReport> = {}): SpendReport {
  return {
    generated_at: "2026-11-25T20:00:00Z",
    from: "2026-11-01",
    to: "2026-11-25",
    timezone: "America/Argentina/Buenos_Aires",
    candidates: [
      { id: K, slug: "axel-kicillof", name: "Axel Kicillof" },
      { id: S, slug: "pedro-sanchez", name: "Pedro Sánchez" },
    ],
    rows: [
      { day: "2026-11-24", feature: "ia_visibilidad", candidate_id: K, items: 10, calls: 10, cost_usd: 1, calls_without_cost: 0, basis: "registrado" },
      { day: "2026-11-25", feature: "ia_visibilidad", candidate_id: S, items: 10, calls: 10, cost_usd: 0.5, calls_without_cost: 0, basis: "registrado" },
      { day: "2026-11-25", feature: "asistente", candidate_id: K, items: 3, calls: 3, cost_usd: 0.25, calls_without_cost: 1, basis: "registrado" },
      { day: "2026-11-25", feature: "clasificador", candidate_id: K, items: 1000, calls: 1000, cost_usd: null, calls_without_cost: 1000, basis: "sin_costo" },
      { day: "2026-11-25", feature: "anuncios_clasificacion", candidate_id: K, items: 50, calls: 50, cost_usd: null, calls_without_cost: 50, basis: "sin_costo" },
    ],
    x_usage: [
      { quota_date: "2026-11-24", candidate_id: K, posts: 200, requests: 10, runs: 20, items_new: 150 },
      { quota_date: "2026-11-24", candidate_id: S, posts: 100, requests: 5, runs: 20, items_new: 90 },
    ],
    x_caps: [
      { candidate_id: K, enabled: true, max_posts_per_day: 300, max_requests_per_day: 10 },
      { candidate_id: S, enabled: true, max_posts_per_day: 300, max_requests_per_day: 10 },
    ],
    caps: { simulator: { enabled: true, daily_budget_usd: 1, max_request_usd: 0.01 } },
    ...over,
  };
}

describe("summarizeSpend", () => {
  const s = summarizeSpend(report());

  it("separa registrado de estimado y no inventa costo de anuncios", () => {
    expect(s.recordedUsd).toBeCloseTo(1.75, 6);
    expect(s.estimatedUsd).toBeCloseTo(1000 * CLASSIFIER_EST_USD_PER_MENTION, 6);
    const ads = s.features.find((f) => f.feature === "anuncios_clasificacion")!;
    expect(ads.basis).toBe("sin dato");
    expect(ads.usd).toBe(0);
    expect(ads.items).toBe(50);
  });

  it("gasto de hoy por función contra el tope", () => {
    const a = s.features.find((f) => f.feature === "asistente")!;
    expect(a.todayUsd).toBeCloseTo(0.25, 6);
    expect(a.dailyCapUsd).toBe(1);
    expect(a.callsWithoutCost).toBe(1);
    expect(s.features.find((f) => f.feature === "simulador")!.dailyCapUsd).toBe(1);
    expect(s.features.find((f) => f.feature === "ia_visibilidad")!.dailyCapUsd).toBeNull();
  });

  it("X: posts × precio de lista y cupo sumado por día", () => {
    expect(s.xPostsTotal).toBe(300);
    expect(s.xUsd).toBeCloseTo(300 * X_USD_PER_POST, 6);
    expect(s.xDays[0]).toMatchObject({ date: "2026-11-24", posts: 300, maxPosts: 600, requests: 15, maxRequests: 20 });
  });

  it("por candidato y por día", () => {
    const k = s.candidates.find((c) => c.candidate_id === K)!;
    expect(k.recorded).toBeCloseTo(1.25, 6);
    expect(k.x).toBeCloseTo(1, 6);
    expect(s.days).toHaveLength(25);
    expect(s.days.find((d) => d.day === "2026-11-24")!.recorded).toBeCloseTo(1, 6);
  });

  it("proyección CALC = gastado + promedio de 7 días completos × días restantes", () => {
    // Días completos 18..24: IA 1 USD (24/11) + X 1,5 USD (24/11) ⇒ 2,5 / 7 por día; faltan 5 días.
    const spent = s.aiTotalUsd + s.xUsd;
    expect(s.projectionUsd).toBeCloseTo(spent + (2.5 / 7) * 5, 5);
    expect(s.daysInMonth).toBe(30);
  });

  it("sin datos: todo en cero y todas las funciones listadas", () => {
    const e = summarizeSpend(report({ rows: [], x_usage: [] }));
    expect(e.aiTotalUsd).toBe(0);
    expect(e.projectionUsd).toBe(0);
    expect(e.features.length).toBeGreaterThanOrEqual(11);
  });
});

describe("helpers", () => {
  it("monthRange usa la fecha de Buenos Aires", () => {
    // 01:30 UTC del 1/12 todavía es 30/11 en Buenos Aires.
    expect(monthRange(new Date("2026-12-01T01:30:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });
  it("fmtUsd", () => {
    expect(fmtUsd(0)).toBe("USD 0");
    expect(fmtUsd(0.0012)).toBe("USD 0,0012");
    expect(fmtUsd(8.6018)).toBe("USD 8,60");
  });
});
