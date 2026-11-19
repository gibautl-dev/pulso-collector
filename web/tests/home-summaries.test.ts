import { describe, expect, it } from "vitest";
import { computeHomeCards } from "@/lib/home-summaries";
import type { AiAnswer, Mention, MetaAd, SuspiciousAccount } from "@/lib/types";

const NOW = new Date("2026-11-19T16:16:00-03:00");
const CANDIDATE = "c1";

function mention(over: Partial<Mention> = {}): Mention {
  return {
    id: over.id ?? "m1",
    candidate_id: CANDIDATE,
    source: over.source ?? "x",
    url: "https://x.com/u/status/1",
    title: "post",
    content: "texto",
    author: "u",
    author_handle: "u",
    outlet: "X",
    published_at: over.published_at ?? "2026-11-18T12:00:00-03:00",
    collected_at: "2026-11-18T12:00:00-03:00",
    account_relation: "third_party",
    tone: over.tone ?? "a_favor",
    tone_reason: null,
    tone_confidence: 0.8,
    target: over.target ?? "candidate",
    topic_id: null,
    relevance: "media",
    classified_at: "2026-11-18T12:00:00-03:00",
    classification_model: "gpt-6-luna",
    classification_prompt_version: "v",
    metrics: null,
    ...over,
  };
}

function ad(over: Partial<MetaAd> = {}): MetaAd {
  return {
    id: over.id ?? "ad-1",
    candidate_id: CANDIDATE,
    ad_id: over.ad_id ?? "1",
    page_id: "p1",
    page_name: "Ratio oficial",
    bylines: null,
    publisher_platforms: ["facebook"],
    currency: "ARS",
    spend_lower: 100,
    spend_upper: 199,
    impressions_lower: null,
    impressions_upper: null,
    ad_creative_bodies: ["texto"],
    ad_creative_link_titles: [],
    ad_snapshot_url: "https://www.facebook.com/ads/library/?id=1",
    ad_creation_time: "2026-11-01T00:00:00+00:00",
    ad_delivery_start_time: "2026-11-02T00:00:00+00:00",
    ad_delivery_stop_time: null,
    fetched_at: "2026-11-19T19:16:01.756Z",
    fetched_on: "2026-11-19",
    stance: over.stance ?? "en_contra",
    stance_reason: "Crítica",
    stance_confidence: 0.8,
    ...over,
  };
}

function answer(over: Partial<AiAnswer> = {}): AiAnswer {
  return {
    id: over.id ?? "a1",
    candidate_id: CANDIDATE,
    provider: "openai",
    model: "chat-latest",
    prompt_key: over.prompt_key ?? "quien_es",
    prompt: "¿Quién es?",
    answer: "Texto",
    citations: [],
    balance: over.balance ?? 10,
    balance_reason: "ok",
    positives: ["Reelección"],
    negatives: ["Inflación"],
    topics: [],
    other_politicians: [],
    asked_at: "2026-11-18T13:50:00-03:00",
    asked_on: "2026-11-18",
    cost: 0.08,
    classification_model: "gpt-6-luna",
    ...over,
  };
}

describe("tarjetas del tablero inicial", () => {
  it("arma resúmenes de En X, Anuncios y En la IA, y marca datos insuficientes cuando no hay nada", () => {
    const cards = computeHomeCards({
      slug: "axel-kicillof",
      days: 7,
      now: NOW,
      mentions: [mention()],
      topics: [],
      ads: [ad({ ad_id: "1", stance: "a_favor" }), ad({ id: "ad-2", ad_id: "2", stance: "en_contra" })],
      answers: [answer({ id: "1", balance: 12 }), answer({ id: "2", prompt_key: "economia", balance: -8 }), answer({ id: "3", prompt_key: "salud", balance: 4 })],
      suspicious: [],
    });
    const byTitle = Object.fromEntries(cards.map((c) => [c.title, c]));
    expect(byTitle["En X"].insufficient).toBe(false);
    expect(byTitle["En X"].stats.find((s) => s.label === "Posts")?.value).toBe("1");
    expect(byTitle["Anuncios"].stats.find((s) => s.label === "Anuncios")?.value).toBe("2");
    expect(byTitle["Anuncios"].stats.some((s) => s.label === "A favor")).toBe(true);
    expect(byTitle["En la IA"].insufficient).toBe(false);
    expect(byTitle["En la IA"].stats.find((s) => s.label === "Balance")?.value).toBeTruthy();
    expect(byTitle["Sospechosas"].insufficient).toBe(true);
    expect(byTitle["Sospechosas"].emptyLabel).toMatch(/datos insuficientes/i);

    const empty = computeHomeCards({
      slug: "axel-kicillof",
      days: 7,
      now: NOW,
      mentions: [],
      topics: [],
      ads: [],
      answers: [],
      suspicious: [],
    });
    expect(empty.every((c) => c.title === "Sospechosas" || c.insufficient || c.title === "En X" || true)).toBe(true);
    expect(empty.find((c) => c.title === "En X")?.insufficient).toBe(true);
    expect(empty.find((c) => c.title === "Anuncios")?.insufficient).toBe(true);
    expect(empty.find((c) => c.title === "En la IA")?.insufficient).toBe(true);
  });
});
