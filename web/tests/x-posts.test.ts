import { describe, expect, it } from "vitest";
import { mention } from "./helpers";
import {
  balanceTone,
  computeXView,
  formatBalance,
  xEngagement,
  xHandle,
  xPostText,
  xProfileUrl,
} from "@/lib/x-posts";

function xMention(over: Parameters<typeof mention>[0] = {}) {
  const id = over.id ?? "x-1";
  const handle = over.author_handle ?? "periodista";
  return mention({
    id,
    source: "x",
    url: `https://x.com/${handle}/status/1`,
    title: "Un post sobre el candidato",
    content: "Un post sobre el candidato",
    author: "Periodista",
    author_handle: handle,
    outlet: "Periodista",
    published_at: "2026-11-18T18:00:00-03:00",
    metrics: {
      like_count: 4,
      repost_count: 1,
      reply_count: 0,
      quote_count: 0,
      bookmark_count: 0,
      impression_count: 80,
      author_followers: 1200,
      is_reply: false,
      is_quote: false,
      is_retweet: false,
    },
    tone: "a_favor",
    target: "candidate",
    relevance: "alta",
    ...over,
  });
}

describe("helpers de posts de X", () => {
  it("saca el handle de author_handle o de la URL", () => {
    expect(xHandle(xMention({ author_handle: "AnaPerez" }))).toBe("AnaPerez");
    expect(xHandle(xMention({ author_handle: "@AnaPerez" }))).toBe("AnaPerez");
    expect(
      xHandle(
        xMention({
          author_handle: null,
          url: "https://x.com/cuenta_demo/status/123",
        }),
      ),
    ).toBe("cuenta_demo");
    expect(xHandle(xMention({ author_handle: null, url: "https://x.com/i/status/123" }))).toBeNull();
    expect(xProfileUrl("AnaPerez")).toBe("https://x.com/AnaPerez");
    expect(xPostText(xMention({ title: "título", content: "texto del post" }))).toBe("texto del post");
    expect(xPostText(xMention({ title: "título", content: "  " }))).toBe("título");
  });

  it("suma la interacción y tolera métricas ausentes", () => {
    expect(xEngagement(xMention()).score).toBe(5);
    expect(xEngagement(xMention({ metrics: { like_count: "3", repost_count: 2 } })).score).toBe(5);
    expect(xEngagement(xMention({ metrics: null })).score).toBe(0);
    expect(formatBalance(-14)).toBe("-14");
    expect(formatBalance(8)).toBe("+8");
    expect(balanceTone(-3)).toBe("negative");
    expect(balanceTone(0)).toBe("default");
  });
});

describe("agregados de la vista de X", () => {
  const now = new Date("2026-11-18T21:00:00-03:00");

  it("cuenta por día, arma el balance y no mezcla otras fuentes", () => {
    const rows = [
      xMention({
        id: "1",
        author_handle: "ana",
        author: "Ana",
        published_at: "2026-11-18T15:00:00-03:00",
        tone: "a_favor",
        target: "candidate",
        metrics: { like_count: 10, repost_count: 2, author_followers: 500 },
      }),
      xMention({
        id: "2",
        author_handle: "ana",
        author: "Ana",
        published_at: "2026-11-18T16:00:00-03:00",
        tone: "critica",
        target: "candidate",
        metrics: { like_count: 1, author_followers: 500 },
      }),
      xMention({
        id: "3",
        author_handle: "juan",
        author: "Juan",
        published_at: "2026-11-18T17:00:00-03:00",
        tone: "informativo",
        target: "candidate",
        metrics: { like_count: 40, repost_count: 5, reply_count: 3 },
      }),
      xMention({
        id: "4",
        author_handle: "otro",
        published_at: "2026-11-18T18:00:00-03:00",
        tone: "insulto",
        target: "other",
      }),
      mention({
        id: "5",
        source: "google_news",
        published_at: "2026-11-18T18:00:00-03:00",
        tone: "a_favor",
        target: "candidate",
      }),
      xMention({
        id: "6",
        author_handle: "propia",
        account_relation: "own",
        published_at: "2026-11-18T18:00:00-03:00",
        tone: "a_favor",
        target: "candidate",
        metrics: { like_count: 99 },
      }),
    ];

    const view = computeXView(rows, { days: 7, now });
    expect(view.total).toBe(4);
    expect(view.authors).toBe(3);
    expect(view.aboutCandidate).toBe(3);
    expect(view.positiveAboutCandidate).toBe(1);
    expect(view.negativeAboutCandidate).toBe(1);
    expect(view.classifiedAboutCandidate).toBe(3);
    // (1 a favor − 1 crítica) / 3 clasificadas sobre él
    expect(view.balance).toBe(0);
    expect(formatBalance(view.balance ?? 0)).toBe("0");
    expect(view.last24h).toBe(4);

    const today = view.volume.find((d) => d.day === "2026-11-18");
    expect(today).toMatchObject({ total: 4, positivo: 1, negativo: 1, neutral: 2, pendiente: 0 });
    expect(view.volume.filter((d) => d.day !== "2026-11-18").every((d) => d.total === 0)).toBe(true);

    expect(view.topAuthors.map((a) => a.handle)).toEqual(["ana", "juan", "otro"]);
    expect(view.topAuthors[0]).toMatchObject({ posts: 2, name: "Ana", followers: 500 });
    expect(view.mostEngaged[0].id).toBe("3");
    expect(view.recent[0].id).toBe("4");
  });

  it("deja el balance vacío si no hay posts clasificados sobre el candidato", () => {
    const view = computeXView(
      [
        xMention({
          id: "1",
          tone: null,
          target: null,
          classified_at: null,
          published_at: "2026-11-18T15:00:00-03:00",
        }),
      ],
      { days: 7, now },
    );
    expect(view.total).toBe(1);
    expect(view.balance).toBeNull();
    expect(view.classifiedAboutCandidate).toBe(0);
    expect(balanceTone(view.balance)).toBe("default");
  });

  it("calcula un balance negativo o positivo según el tono sobre él", () => {
    const neg = computeXView(
      [
        xMention({ id: "1", tone: "critica", target: "candidate" }),
        xMention({ id: "2", tone: "acusacion", target: "candidate" }),
        xMention({ id: "3", tone: "a_favor", target: "candidate" }),
      ],
      { days: 7, now },
    );
    expect(neg.balance).toBe(-33);
    expect(balanceTone(neg.balance)).toBe("negative");

    const pos = computeXView(
      [
        xMention({ id: "1", tone: "a_favor", target: "candidate" }),
        xMention({ id: "2", tone: "a_favor", target: "candidate" }),
        xMention({ id: "3", tone: "informativo", target: "candidate" }),
      ],
      { days: 7, now },
    );
    expect(pos.balance).toBe(67);
    expect(balanceTone(pos.balance)).toBe("positive");
  });
});
