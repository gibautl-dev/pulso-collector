import type { Mention } from "@/lib/types";

let n = 0;
export function mention(over: Partial<Mention> = {}): Mention {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    candidate_id: "c1",
    source: "google_news",
    url: `https://medio.com/${n}`,
    title: `Nota ${n} - Medio`,
    content: null,
    author: null,
    outlet: "Medio",
    published_at: "2026-11-03T15:00:00+00:00",
    collected_at: "2026-11-03T15:10:00+00:00",
    account_relation: "third_party",
    tone: "informativo",
    tone_reason: "Nota informativa",
    tone_confidence: 0.9,
    target: "candidate",
    topic_id: null,
    relevance: "media",
    classified_at: "2026-11-03T15:20:00+00:00",
    classification_model: "gpt-6-luna",
    classification_prompt_version: "auto-v1",
    ...over,
  };
}
