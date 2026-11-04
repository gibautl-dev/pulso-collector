import { describe, expect, it } from "vitest";
import { bucketFor, computeDashboard, computeSourceHealth, dayRange } from "@/lib/analytics";
import { mention } from "./helpers";

const NOW = new Date("2026-11-04T13:00:00Z"); // 10:00 ART
const topics = [
  { id: "t1", candidate_id: "c1", label: "interna peronista" },
  { id: "t2", candidate_id: "c1", label: "educación" },
];

describe("bucketFor", () => {
  it("una crítica a otro NO cuenta como negativa para el candidato", () => {
    expect(bucketFor({ tone: "critica", target: "other" })).toBe("neutral");
    expect(bucketFor({ tone: "critica", target: "unclear" })).toBe("neutral");
    expect(bucketFor({ tone: "critica", target: "candidate" })).toBe("negativo");
    expect(bucketFor({ tone: "acusacion", target: "candidate" })).toBe("negativo");
    expect(bucketFor({ tone: "a_favor", target: "candidate" })).toBe("positivo");
    expect(bucketFor({ tone: null, target: null })).toBe("pendiente");
  });
});

describe("computeDashboard", () => {
  const ms = [
    mention({ tone: "critica", target: "candidate", relevance: "media", topic_id: "t1", published_at: "2026-11-03T12:00:00Z" }),
    mention({ tone: "acusacion", target: "candidate", relevance: "alta", topic_id: "t1", published_at: "2026-11-02T12:00:00Z" }),
    mention({ tone: "critica", target: "other", topic_id: "t2", published_at: "2026-11-04T12:00:00Z" }),
    mention({ tone: "a_favor", target: "candidate", topic_id: "t2", outlet: "Otro medio", published_at: "2026-11-04T12:30:00Z" }),
    mention({ tone: null, target: null, relevance: null, classified_at: null, published_at: "2026-11-04T12:40:00Z" }),
    mention({ tone: "critica", target: "candidate", account_relation: "own", published_at: "2026-11-04T12:00:00Z" }),
    mention({ tone: "critica", target: "candidate", published_at: "2026-10-01T12:00:00Z" }), // fuera del período
  ];
  const d = computeDashboard(ms, topics, { days: 7, now: NOW });

  it("filtra período y cuentas propias", () => {
    expect(d.total).toBe(5);
  });
  it("el tono solo cuenta target=candidate", () => {
    const by = Object.fromEntries(d.toneAboutCandidate.map((t) => [t.tone, t.count]));
    expect(by.critica).toBe(1);
    expect(by.acusacion).toBe(1);
    expect(by.a_favor).toBe(1);
    expect(d.negativeAboutCandidate).toBe(2);
    expect(d.criticismOfOthers).toBe(1);
    expect(d.aboutOthers).toBe(1);
    expect(d.pending).toBe(1);
  });
  it("destacados: solo negativas sobre él, alta relevancia primero", () => {
    expect(d.highlights.map((m) => m.tone)).toEqual(["acusacion", "critica"]);
    expect(d.highlights.every((m) => m.target === "candidate")).toBe(true);
  });
  it("volumen por día en hora argentina, con días en cero", () => {
    expect(d.volume).toHaveLength(7);
    expect(d.volume.at(-1)?.day).toBe("2026-11-04");
    expect(d.volume.reduce((s, v) => s + v.total, 0)).toBe(5);
    expect(d.volume.find((v) => v.day === "2026-11-04")?.pendiente).toBe(1);
  });
  it("temas y medios", () => {
    expect(d.topTopics[0]).toMatchObject({ label: "interna peronista", count: 2, negative: 2 });
    expect(d.topOutlets[0]).toMatchObject({ outlet: "Medio", count: 4 });
  });
});

describe("dayRange", () => {
  it("usa la fecha argentina (00:30 UTC sigue siendo el día anterior en ART)", () => {
    expect(dayRange(1, new Date("2026-11-04T00:30:00Z"))).toEqual(["2026-11-03"]);
  });
});

describe("computeSourceHealth", () => {
  it("toma la última corrida y cuenta las de 24 h", () => {
    const h = computeSourceHealth(
      [
        { source: "rss_media", status: "partial", started_at: "2026-11-04T12:40:00Z", finished_at: "2026-11-04T12:40:05Z", error: "feed_9", items_new: 1 },
        { source: "rss_media", status: "ok", started_at: "2026-11-04T12:20:00Z", finished_at: "2026-11-04T12:20:05Z", error: null, items_new: 2 },
        { source: "rss_media", status: "error", started_at: "2026-11-01T12:20:00Z", finished_at: "2026-11-01T12:20:05Z", error: "x", items_new: 0 },
      ],
      NOW,
    );
    expect(h[0]).toMatchObject({ source: "rss_media", runs24h: 2, ok24h: 1, partial24h: 1, error24h: 0, new24h: 3 });
    expect(h[0].lastRun?.status).toBe("partial");
  });
});
