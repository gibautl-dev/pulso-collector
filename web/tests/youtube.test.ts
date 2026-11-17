import { describe, expect, it } from "vitest";
import {
  formatCount,
  isYoutubeComment,
  metricNumber,
  youtubeStats,
  youtubeThumbnailUrl,
  youtubeVideoId,
  youtubeWatchUrl,
} from "@/lib/youtube";
import { mention } from "./helpers";

describe("youtubeVideoId", () => {
  it("lee el id de un watch?v=", () => {
    const m = mention({ url: "https://www.youtube.com/watch?v=abcdefghijk" });
    expect(youtubeVideoId(m)).toBe("abcdefghijk");
  });
  it("lee el id de youtu.be y shorts", () => {
    expect(youtubeVideoId(mention({ url: "https://youtu.be/abcdefghijk" }))).toBe("abcdefghijk");
    expect(youtubeVideoId(mention({ url: "https://www.youtube.com/shorts/abcdefghijk" }))).toBe("abcdefghijk");
  });
  it("prioriza metrics.video_id (comentarios)", () => {
    const m = mention({
      url: "https://www.youtube.com/watch?v=abcdefghijk&lc=Ugx123",
      metrics: { video_id: "lmnopqrstuv" },
    });
    expect(youtubeVideoId(m)).toBe("lmnopqrstuv");
  });
  it("ignora ids inválidos", () => {
    expect(youtubeVideoId(mention({ url: "https://medio.com/nota", metrics: { video_id: "corto" } }))).toBeNull();
  });
});

describe("isYoutubeComment", () => {
  it("detecta comentarios por video_id o lc=", () => {
    expect(
      isYoutubeComment(
        mention({ source: "youtube", url: "https://www.youtube.com/watch?v=abcdefghijk", metrics: { video_id: "abcdefghijk" } }),
      ),
    ).toBe(true);
    expect(
      isYoutubeComment(
        mention({ source: "youtube", url: "https://www.youtube.com/watch?v=abcdefghijk&lc=Ugx1", metrics: null }),
      ),
    ).toBe(true);
    expect(
      isYoutubeComment(
        mention({ source: "youtube", url: "https://www.youtube.com/watch?v=abcdefghijk", metrics: { view_count: 10 } }),
      ),
    ).toBe(false);
    expect(isYoutubeComment(mention({ source: "google_news", url: "https://www.youtube.com/watch?v=abcdefghijk&lc=x" }))).toBe(
      false,
    );
  });
});

describe("youtube helpers", () => {
  it("arma URLs públicas de miniatura y watch", () => {
    expect(youtubeThumbnailUrl("abcdefghijk")).toBe("https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
    expect(youtubeWatchUrl("abcdefghijk")).toBe("https://www.youtube.com/watch?v=abcdefghijk");
  });
  it("parsea métricas numéricas o string", () => {
    expect(metricNumber({ view_count: 29761 }, "view_count")).toBe(29761);
    expect(metricNumber({ view_count: "12" }, "view_count")).toBe(12);
    expect(metricNumber({ view_count: "no" }, "view_count")).toBeNull();
    expect(youtubeStats(mention({ metrics: { view_count: 100, like_count: 3, comment_count: 2 } }))).toEqual({
      views: 100,
      likes: 3,
      comments: 2,
      replies: null,
    });
  });
  it("formatea cantidades en español", () => {
    expect(formatCount(29761)).toBe("29.761");
    expect(formatCount(0)).toBe("0");
  });
});
