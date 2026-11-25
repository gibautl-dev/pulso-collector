import { describe, expect, it } from "vitest";
import { Evidence, compareRivals, countMentions, resolveFilters, resolvePeriod, searchMentions, topicsOverview, adsOverview, dailyBriefsTool, type MentionsData } from "@/lib/assistant/tools";
import { cleanTerms, termMatcher } from "@/lib/assistant/text";
import { DEFAULT_CLOCK } from "@/lib/time";
import type { Candidate, DailyBrief, Topic } from "@/lib/types";
import { mention } from "./helpers";

const NOW = new Date("2026-11-25T15:00:00Z");
const K: Candidate = { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" };
const M: Candidate = { id: "c2", slug: "milei", name: "Javier Milei" };
const topics: Topic[] = [
  { id: "t-eco", candidate_id: "c1", label: "economía" },
  { id: "t-edu", candidate_id: "c1", label: "educación" },
];
const day = (d: number, h = 15) => new Date(Date.UTC(2026, 10, d, h)).toISOString();

function data(mentions = baseMentions(), coverage: Record<string, string> = { google_news: day(1), x: day(20) }): MentionsData {
  return { candidate: K, mentions, topics, coverage, now: NOW, clock: DEFAULT_CLOCK };
}
function baseMentions() {
  return [
    mention({ published_at: day(24), topic_id: "t-eco", title: "Kicillof habló de inflación y salarios", tone: "critica", target: "candidate", relevance: "alta" }),
    mention({ published_at: day(23), topic_id: "t-eco", title: "Economía bonaerense: nuevo plan", tone: "a_favor", target: "candidate" }),
    mention({ published_at: day(22), topic_id: "t-edu", title: "Paritaria docente", tone: "informativo" }),
    mention({ published_at: day(21), source: "x", topic_id: "t-eco", title: "post sobre precios", tone: "insulto", target: "candidate" }),
    // período anterior
    mention({ published_at: day(15), topic_id: "t-eco", title: "Economía: tarifas", tone: "critica" }),
    mention({ published_at: day(14), topic_id: "t-eco", title: "Otra de economía", tone: "informativo" }),
    // propia (no entra con autoría por defecto)
    mention({ published_at: day(24), account_relation: "own", title: "Mensaje oficial sobre economía" }),
  ];
}

describe("texto", () => {
  it("normaliza acentos y matchea al inicio de palabra", () => {
    const t = cleanTerms(["Economía", "inflación", "x", "  "]);
    expect(t).toEqual(["economia", "inflacion"]);
    const match = termMatcher(t)!;
    expect(match("La ECONOMÍA crece")).toBe(true);
    expect(match("macroeconomia")).toBe(false);
  });
});

describe("período", () => {
  it("últimos N días con tope de 30", () => {
    const p = resolvePeriod({ periodo_dias: 90 }, NOW, DEFAULT_CLOCK);
    expect(p.days).toBe(30);
  });
  it("un día concreto en hora local", () => {
    const p = resolvePeriod({ desde: "2026-11-24", hasta: "2026-11-24" }, NOW, DEFAULT_CLOCK);
    expect(p.start.toISOString()).toBe("2026-11-24T03:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-11-25T03:00:00.000Z");
  });
});

describe("contar_menciones", () => {
  it("cuenta terceros del período con filtro de tema y calcula balance", () => {
    const out = countMentions({ periodo_dias: 7, tema: "economia" }, data());
    expect(out.result.total).toBe(3);
    const tono = out.result.tono as { a_favor: number; en_contra: number; balance: number };
    expect(tono.a_favor).toBe(1);
    expect(tono.en_contra).toBe(2);
    expect(tono.balance).toBe(-33);
  });

  it("variación solo con fuentes medidas en los dos períodos y aviso de cobertura", () => {
    const out = countMentions({ periodo_dias: 7, tema: "economía" }, data());
    const v = out.result.variacion_vs_periodo_anterior as { actual: number; anterior: number; porcentaje: number; fuentes_comparadas: string[] };
    // X arrancó el 20/11: no entra en la variación (2 de Google News vs 2 antes).
    expect(v.actual).toBe(2);
    expect(v.anterior).toBe(2);
    expect(v.porcentaje).toBe(0);
    expect(v.fuentes_comparadas).toEqual(["Google News"]);
    expect(out.notes.join(" ")).toMatch(/X se mide desde/);
  });

  it("tema inexistente: avisa y lista los temas disponibles", () => {
    const out = countMentions({ periodo_dias: 7, tema: "seguridad" }, data());
    expect((out.result.filtros as { tema_no_encontrado: string }).tema_no_encontrado).toBe("seguridad");
    expect(out.result.temas_disponibles).toEqual(["economía", "educación"]);
  });

  it("autoría propia", () => {
    const out = countMentions({ periodo_dias: 7, autoria: "propias" }, data());
    expect(out.result.total).toBe(1);
  });

  it("parámetros fuera de rango se acotan", () => {
    const f = resolveFilters({ fuente: "DROP TABLE", tono: "x", autoria: 3 }, topics);
    expect(f.source).toBe("todas");
    expect(f.tone).toBe("todas");
    expect(f.authorship).toBe("terceros");
  });
});

describe("buscar_menciones", () => {
  it("devuelve referencias citables, sin duplicados y con tope", () => {
    const ev = new Evidence();
    const dup = mention({ published_at: day(24), title: "Kicillof habló de inflación y salarios", tone: "critica" });
    const out = searchMentions({ periodo_dias: 7, texto: ["inflación", "salarios", "precios"], limite: 50 }, data([...baseMentions(), dup]), ev);
    const items = out.result.menciones as { ref: string; titulo: string }[];
    expect(items.map((i) => i.ref)).toEqual(["m1", "m2"]);
    expect(ev.get("m1")?.title).toMatch(/inflación/);
    expect(ev.size).toBe(2);
  });
});

describe("temas", () => {
  it("rankea temas con balance", () => {
    const out = topicsOverview({ periodo_dias: 7 }, data());
    const rows = out.result.temas as { tema: string; menciones: number }[];
    expect(rows[0]).toMatchObject({ tema: "economía", menciones: 3 });
  });
});

describe("comparar_rivales", () => {
  it("usa la ventana común: período y fuentes de los dos", () => {
    const rivalMentions = [
      mention({ candidate_id: "c2", published_at: day(25, 3), title: "Milei 1" }),
      mention({ candidate_id: "c2", published_at: day(25, 4), title: "Milei 2" }),
      mention({ candidate_id: "c2", published_at: day(20), title: "Milei antes de medirse" }),
    ];
    const kMentions = [
      mention({ published_at: day(25, 5) }),
      mention({ published_at: day(23) }), // antes de que se mida al rival: no cuenta
      mention({ source: "x", published_at: day(25, 6) }), // X no se mide para el rival: no cuenta
    ];
    const out = compareRivals(
      { periodo_dias: 7 },
      data(kMentions, { google_news: day(1), x: day(1) }),
      [{ rival: M, level: "principal" as never, mentions: rivalMentions, coverage: { google_news: day(24, 23) } }],
    );
    const c = (out.result.comparaciones as Record<string, unknown>[])[0];
    expect(c.menciones_candidato).toBe(1);
    expect(c.menciones_rival).toBe(2);
    expect(c.participacion_candidato_pct).toBe(33);
    expect((c.ventana as { recortada: boolean }).recortada).toBe(true);
    expect(out.notes[0]).toMatch(/solo desde que se miden los dos/);
  });

  it("sin rivales", () => {
    const out = compareRivals({}, data(), []);
    expect(out.result.sin_rivales).toBeTruthy();
  });
});

describe("anuncios y resúmenes", () => {
  it("anuncios no medidos se dicen como tales", () => {
    const out = adsOverview({ periodo_dias: 7 }, { candidate: K, meta: null, google: [], now: NOW, clock: DEFAULT_CLOCK });
    expect(out.result.meta).toEqual({ no_medido: expect.any(String) });
    expect(out.result.google).toEqual({ no_medido: expect.any(String) });
  });
  it("resúmenes ok, más recientes primero", () => {
    const b = { id: "b", candidate_id: "c1", brief_date: "2026-11-24", timezone: "x", status: "ok", headline: "H", metrics: {}, created_at: "", output: { headline: "Titular", highlight: null, what_changed: [{ text: "Subió", mention_ids: [] }], why_it_matters: [], what_to_do: [], sources: [] } } as DailyBrief;
    const out = dailyBriefsTool({ dias: 3 }, [b], K);
    expect((out.result.resumenes as { titular: string }[])[0].titular).toBe("Titular");
  });
});
