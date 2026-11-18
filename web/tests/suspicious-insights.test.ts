import { describe, expect, it } from "vitest";
import { mention } from "./helpers";
import type { SuspiciousAccount, Topic } from "@/lib/types";
import {
  MIN_FLAGGED_ACCOUNTS,
  MIN_FLAGGED_POSTS,
  computeSuspiciousInsights,
  flaggedLookupKey,
  formatPercent,
  isConversationMention,
  mentionLookupKey,
  parseTupleAccountKey,
  signalCategory,
} from "@/lib/suspicious-insights";

const CANDIDATE = "c1";
const TOPIC_ELECCIONES = "11111111-0000-4000-8000-000000000001";
const TOPIC_GESTION = "22222222-0000-4000-8000-000000000002";
const TOPICS: Topic[] = [
  { id: TOPIC_ELECCIONES, candidate_id: CANDIDATE, label: "elecciones 2027" },
  { id: TOPIC_GESTION, candidate_id: CANDIDATE, label: "gestión provincial" },
];

function account(over: Partial<SuspiciousAccount> = {}): SuspiciousAccount {
  return {
    id: over.id ?? "aaaaaaaa-0000-4000-8000-000000000001",
    candidate_id: CANDIDATE,
    platform: "x",
    account_key: "(2c4f83ed-f2bd-4afe-89a3-fa6263cc5b7e,x,genkicillof)",
    handle: "GenKicillof",
    display_name: "GENERACION KICILLOF",
    profile_url: "https://x.com/GenKicillof",
    score: 40,
    signals: [
      {
        type: "new_account",
        weight: 25,
        summary: "Cuenta creada hace 0 días",
        evidence: [
          {
            mention_id: "m-flag",
            url: "https://x.com/GenKicillof/status/1",
            published_at: "2026-11-18T17:41:34+00:00",
            excerpt: "Texto de ejemplo",
          },
        ],
      },
    ],
    mention_count: 1,
    first_seen_at: "2026-11-18T17:41:34+00:00",
    last_seen_at: "2026-11-18T17:41:34+00:00",
    account_created_at: "2026-11-18T17:18:03+00:00",
    status: "pending",
    status_note: null,
    status_updated_at: null,
    detected_at: "2026-11-18T19:04:35+00:00",
    ...over,
  };
}

function xPost(over: Parameters<typeof mention>[0] = {}) {
  const handle = over.author_handle ?? "vecino";
  return mention({
    candidate_id: CANDIDATE,
    source: "x",
    author: "Vecino",
    author_handle: handle,
    url: `https://x.com/${handle}/status/1`,
    published_at: "2026-11-18T15:00:00-03:00",
    tone: "informativo",
    target: "candidate",
    topic_id: TOPIC_ELECCIONES,
    account_relation: "third_party",
    ...over,
  });
}

const now = new Date("2026-11-18T21:00:00-03:00");

describe("claves y categorías", () => {
  it("arma la clave a pesar del account_key en forma de tupla", () => {
    expect(parseTupleAccountKey("(2c4f83ed-f2bd-4afe-89a3-fa6263cc5b7e,x,genkicillof)")).toEqual({
      platform: "x",
      key: "genkicillof",
    });
    expect(flaggedLookupKey(account())).toBe("x:genkicillof");
    expect(flaggedLookupKey(account({ handle: null }))).toBe("x:genkicillof");
    expect(mentionLookupKey(xPost({ author_handle: "GenKicillof" }))).toBe("x:genkicillof");
    expect(signalCategory("group_burst")).toBe("automated");
    expect(signalCategory("coordination")).toBe("spam");
    expect(signalCategory("digit_name")).toBe("profile");
    expect(signalCategory("no_existe")).toBe("other");
  });

  it("incluye posts de X y comentarios de YouTube, no videos ni notas", () => {
    expect(isConversationMention(xPost())).toBe(true);
    expect(
      isConversationMention(
        mention({ source: "youtube", metrics: { video_id: "abcdefghijk" }, url: "https://www.youtube.com/watch?v=abcdefghijk&lc=1" }),
      ),
    ).toBe(true);
    expect(isConversationMention(mention({ source: "youtube", metrics: { view_count: 10 }, url: "https://www.youtube.com/watch?v=abcdefghijk" }))).toBe(false);
    expect(isConversationMention(mention({ source: "google_news" }))).toBe(false);
    expect(isConversationMention(xPost({ account_relation: "own" }))).toBe(false);
  });
});

describe("agregados de la lectura", () => {
  it("calcula la participación, el balance y los temas, e ignora las descartadas", () => {
    const mentions = [
      xPost({
        id: "1",
        author_handle: "GenKicillof",
        tone: "a_favor",
        target: "candidate",
        topic_id: TOPIC_ELECCIONES,
      }),
      xPost({
        id: "2",
        author_handle: "norbrisa54753",
        tone: "a_favor",
        target: "candidate",
        topic_id: TOPIC_ELECCIONES,
      }),
      xPost({
        id: "3",
        author_handle: "ana",
        tone: "critica",
        target: "candidate",
        topic_id: TOPIC_GESTION,
      }),
      xPost({
        id: "4",
        author_handle: "juan",
        tone: "informativo",
        target: "candidate",
        topic_id: TOPIC_GESTION,
      }),
      mention({
        id: "5",
        source: "youtube",
        author_handle: "UCvideo",
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        metrics: { view_count: 100 },
        tone: "critica",
        target: "candidate",
        published_at: "2026-11-18T15:00:00-03:00",
      }),
      mention({
        id: "6",
        source: "google_news",
        tone: "a_favor",
        target: "candidate",
        published_at: "2026-11-18T15:00:00-03:00",
      }),
      xPost({
        id: "7",
        author_handle: "descartada",
        tone: "insulto",
        target: "candidate",
        topic_id: TOPIC_GESTION,
      }),
    ];
    const accounts = [
      account({ id: "a1", handle: "GenKicillof", account_key: "(x,x,genkicillof)", signals: [{ type: "new_account", weight: 25, summary: "nueva", evidence: [] }, { type: "group_burst", weight: 15, summary: "ráfaga", evidence: [] }] }),
      account({ id: "a2", handle: "norbrisa54753", account_key: "norbrisa54753", score: 25, signals: [{ type: "digit_name", weight: 10, summary: "dígitos", evidence: [] }] }),
      account({ id: "a3", handle: "descartada", status: "discarded", signals: [{ type: "coordination", weight: 25, summary: "spam", evidence: [] }] }),
    ];

    // Con 2 cuentas no alcanza el umbral.
    const low = computeSuspiciousInsights(mentions, accounts, TOPICS, { days: 7, now });
    expect(low.posts).toBe(5);
    expect(low.authors).toBe(5);
    expect(low.flaggedPosts).toBe(2);
    expect(low.flaggedAuthors).toBe(2);
    expect(low.sufficient).toBe(false);
    expect(low.insufficientReason).toMatch(/2 cuentas marcadas/);

    // Completamos el umbral con más cuentas marcadas y posts propios.
    const extraMentions = Array.from({ length: 3 }, (_, i) =>
      xPost({
        id: `f${i}`,
        author_handle: `cuenta${i}`,
        tone: "a_favor",
        target: "candidate",
        topic_id: TOPIC_ELECCIONES,
      }),
    );
    const extraAccounts = Array.from({ length: 3 }, (_, i) =>
      account({
        id: `b${i}`,
        handle: `cuenta${i}`,
        account_key: `cuenta${i}`,
        score: 20,
        signals: [{ type: "coordination", weight: 25, summary: "mismo texto", evidence: [] }],
      }),
    );
    const view = computeSuspiciousInsights([...mentions, ...extraMentions], [...accounts, ...extraAccounts], TOPICS, {
      days: 7,
      now,
    });
    expect(view.sufficient).toBe(true);
    expect(view.flaggedAuthors).toBe(5);
    expect(view.flaggedPosts).toBe(5);
    expect(view.posts).toBe(8);
    expect(view.authors).toBe(8);
    expect(view.authorShare).toBeCloseTo((5 / 8) * 100);
    expect(view.postShare).toBeCloseTo((5 / 8) * 100);
    expect(view.sentiment.flagged.balance).toBe(100);
    expect(view.sentiment.without.balance).toBe(-67);
    expect(view.topics[0]).toMatchObject({ label: "elecciones 2027", flagged: 5 });
    expect(view.reasons.find((r) => r.id === "profile")?.accounts.map((a) => a.account.handle)).toEqual([
      "GenKicillof",
      "norbrisa54753",
    ]);
    expect(view.reasons.find((r) => r.id === "spam")?.accounts).toHaveLength(3);
    expect(view.reasons.find((r) => r.id === "automated")?.accounts).toHaveLength(1);
    expect(view.flaggedAccounts.some((a) => a.status === "discarded")).toBe(false);
    expect(formatPercent(7.258)).toBe("7,3%");
  });

  it("declara datos insuficientes si no llega al mínimo de cuentas o de posts", () => {
    expect(MIN_FLAGGED_ACCOUNTS).toBe(3);
    expect(MIN_FLAGGED_POSTS).toBe(5);
    const empty = computeSuspiciousInsights([], [], TOPICS, { days: 7, now });
    expect(empty.sufficient).toBe(false);
    expect(empty.insufficientReason).toMatch(/Todavía no hay cuentas marcadas/);
  });
});
