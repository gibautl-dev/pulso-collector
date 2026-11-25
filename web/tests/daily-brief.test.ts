import { describe, expect, it } from "vitest";
import { briefDateLabel, briefKpis, normalizeOutput, parseBriefDate, pickBrief } from "@/lib/daily-brief";
import { MemoryRepo } from "@/lib/data/memory";
import { CANDIDATE_SECTIONS, hrefForCandidate } from "@/lib/candidate-nav";
import type { DailyBrief } from "@/lib/types";

const src = (id: string) => ({ id, url: `https://example.org/${id}`, title: `T ${id}`, outlet: "Medio", source: "google_news", tone: "critica", time: "12:00" });

const brief = (day: string, extra: Partial<DailyBrief> = {}): DailyBrief => ({
  id: `b-${day}`,
  candidate_id: "c1",
  brief_date: day,
  timezone: "America/Argentina/Buenos_Aires",
  status: "ok",
  headline: "H",
  metrics: {},
  output: { headline: "H", highlight: null, what_changed: [], why_it_matters: [], what_to_do: [], sources: [] },
  created_at: `${day}T11:00:00Z`,
  ...extra,
});

describe("normalizeOutput", () => {
  it("descarta puntos sin una fuente conocida y fuentes sin URL válida", () => {
    const out = normalizeOutput({
      headline: "Titular",
      highlight: { key: "criticas", value: "94", label: "críticas", delta: "+24% vs. promedio de 7 días", tone: "negative" },
      what_changed: [
        { text: "Con fuente", mention_ids: ["a"] },
        { text: "Fuente desconocida", mention_ids: ["zzz"] },
        { text: "", mention_ids: ["a"] },
      ],
      why_it_matters: "no es una lista",
      what_to_do: [{ action: "Aclarar", why: "Porque", priority: "alta", area: "comunicacion", mention_ids: ["a", "b"] }],
      sources: [src("a"), { ...src("b"), url: "javascript:alert(1)" }],
    });
    expect(out.what_changed.map((p) => p.text)).toEqual(["Con fuente"]);
    expect(out.why_it_matters).toEqual([]);
    expect(out.what_to_do[0].mention_ids).toEqual(["a"]);
    expect(out.sources.map((s) => s.id)).toEqual(["a"]);
    expect(out.highlight?.value).toBe("94");
  });

  it("tolera un JSON vacío o roto", () => {
    expect(normalizeOutput(null).what_changed).toEqual([]);
    expect(normalizeOutput({ highlight: { value: "" } }).highlight).toBeNull();
  });
});

describe("pickBrief y fechas", () => {
  it("elige el más reciente o la fecha pedida", () => {
    const list = [brief("2026-11-23"), brief("2026-11-24")];
    expect(pickBrief(list, null)?.brief_date).toBe("2026-11-24");
    expect(pickBrief(list, "2026-11-23")?.brief_date).toBe("2026-11-23");
    expect(pickBrief(list, "2026-11-01")).toBeNull();
    expect(pickBrief([], null)).toBeNull();
  });

  it("valida la fecha del query y la escribe en castellano", () => {
    expect(parseBriefDate("2026-11-24")).toBe("2026-11-24");
    expect(parseBriefDate("24/11")).toBeNull();
    expect(parseBriefDate(["2026-11-24"])).toBeNull();
    expect(briefDateLabel("2026-11-24")).toBe("Martes 24 de noviembre");
    expect(briefDateLabel("2026-11-24", { capital: false })).toBe("martes 24 de noviembre");
  });
});

describe("briefKpis", () => {
  const metrics = {
    menciones: { dia: 1292 },
    comparacion: {
      fiable: true, var_vs_promedio_pct: -4, criticas_var_pct: 24, a_favor_dia: 29, a_favor_promedio_7d: 35.4,
      balance_dia: -27, balance_7d: -15,
    },
    sobre_candidato: { dia: { criticas: 94, a_favor: 29, balance: -27 } },
  };
  it("muestra variaciones solo con base fiable", () => {
    const k = briefKpis(metrics);
    expect(k.map((x) => x.value)).toEqual(["1.292", "94", "29", "−27"]);
    expect(k[0].hint).toBe("−4% vs. promedio 7 días");
    expect(k[1].tone).toBe("negative");
    expect(k[2].hint).toBe("−18% vs. promedio 7 días");
    expect(k[3].hint).toBe("−12 pts vs. 7 días");
    const unreliable = briefKpis({ ...metrics, comparacion: { ...metrics.comparacion, fiable: false } });
    expect(unreliable.every((x) => x.hint === null)).toBe(true);
  });
});

describe("repo y navegación", () => {
  it("MemoryRepo lista solo los resúmenes del candidato, del más nuevo al más viejo", async () => {
    const repo = new MemoryRepo({
      candidate: { id: "c1", slug: "axel-kicillof", name: "A" } as never,
      topics: [], mentions: [], source_runs: [], candidate_sources: [],
      daily_briefs: [brief("2026-11-23"), brief("2026-11-24"), brief("2026-11-24", { id: "x", candidate_id: "c2" })],
    });
    const list = await repo.listDailyBriefs("c1", 5);
    expect(list.map((b) => b.brief_date)).toEqual(["2026-11-24", "2026-11-23"]);
    expect(await repo.listDailyBriefs("c1", 1)).toHaveLength(1);
  });

  it("la sección existe para cualquier candidato, también en España", () => {
    expect(CANDIDATE_SECTIONS).toContain("resumen");
    expect(hrefForCandidate("pedro-sanchez", "/c/axel-kicillof/resumen")).toBe("/c/pedro-sanchez/resumen");
    expect(hrefForCandidate("milei", "/c/pedro-sanchez/resumen")).toBe("/c/milei/resumen");
  });
});
