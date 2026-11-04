import { describe, expect, it } from "vitest";
import { applyFilters, dateBounds, filtersToSearch, parseFilters, sanitizeSearch } from "@/lib/filters";
import { mention } from "./helpers";

describe("parseFilters", () => {
  it("ignora valores fuera de la lista blanca", () => {
    const f = parseFilters({ tone: "drop table", target: "x", topic: "no-uuid", source: "A;B", relevance: "max", from: "ayer", page: "-3" });
    expect(f).toEqual({ page: 1, tone: undefined, target: undefined, topic: undefined, source: undefined, relevance: undefined, from: undefined, to: undefined, q: undefined });
  });
  it("acepta valores válidos", () => {
    const f = parseFilters({ tone: "negativas", target: "candidate", relevance: "alta", from: "2026-11-01", to: "2026-11-03", page: "2", q: "reelección" });
    expect(f).toMatchObject({ tone: "negativas", target: "candidate", relevance: "alta", from: "2026-11-01", to: "2026-11-03", page: 2, q: "reelección" });
  });
});

describe("sanitizeSearch", () => {
  it("saca la sintaxis de filtros de PostgREST", () => {
    expect(sanitizeSearch('a,tone.eq.critica),(x"')).toBe("a tone eq critica x");
    expect(sanitizeSearch("%_*")).toBeUndefined();
    expect(sanitizeSearch("x".repeat(200))?.length).toBe(80);
  });
});

describe("dateBounds", () => {
  it("convierte días argentinos a límites UTC", () => {
    expect(dateBounds(parseFilters({ from: "2026-11-03", to: "2026-11-03" }))).toEqual({
      gte: "2026-11-03T03:00:00.000Z",
      lt: "2026-11-04T03:00:00.000Z",
    });
  });
});

describe("applyFilters", () => {
  const ms = [
    mention({ tone: "critica", target: "candidate", title: "Reelección indefinida", source: "rss_media", published_at: "2026-11-03T12:00:00Z" }),
    mention({ tone: "acusacion", target: "candidate", relevance: "alta", published_at: "2026-11-04T02:00:00Z" }), // 03/11 23:00 ART
    mention({ tone: null, target: null, relevance: null, published_at: "2026-11-04T12:00:00Z" }),
    mention({ tone: "informativo", content: "habló de la reeleccion", published_at: "2026-11-02T12:00:00Z" }),
  ];
  it("negativas, pendientes y tono puntual", () => {
    expect(applyFilters(ms, parseFilters({ tone: "negativas" }))).toHaveLength(2);
    expect(applyFilters(ms, parseFilters({ tone: "pendiente" }))).toHaveLength(1);
    expect(applyFilters(ms, parseFilters({ tone: "acusacion", relevance: "alta" }))).toHaveLength(1);
    expect(applyFilters(ms, parseFilters({ source: "rss_media" }))).toHaveLength(1);
  });
  it("fecha en hora argentina", () => {
    expect(applyFilters(ms, parseFilters({ from: "2026-11-03", to: "2026-11-03" }))).toHaveLength(2);
  });
  it("búsqueda sin acentos ni mayúsculas, en título y texto", () => {
    expect(applyFilters(ms, parseFilters({ q: "REELECCION" }))).toHaveLength(2);
  });
  it("ordena por fecha descendente", () => {
    const r = applyFilters(ms, parseFilters({}));
    expect(r[0].published_at).toBe("2026-11-04T12:00:00Z");
  });
});

describe("filtersToSearch", () => {
  it("arma la query string", () => {
    const f = parseFilters({ tone: "critica", q: "kicillof" });
    expect(filtersToSearch(f, { page: 2 })).toBe("?tone=critica&q=kicillof&page=2");
    expect(filtersToSearch(parseFilters({}))).toBe("");
  });
});
