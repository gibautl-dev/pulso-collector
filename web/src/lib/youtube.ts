import type { Mention } from "./types";

const WATCH_RE = /[?&]v=([A-Za-z0-9_-]{11})/;
const SHORT_RE = /(?:youtu\.be\/|youtube\.com\/(?:embed|shorts|live)\/)([A-Za-z0-9_-]{11})/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function metricNumber(metrics: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!metrics) return null;
  const v = metrics[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function youtubeVideoId(m: Pick<Mention, "url" | "metrics">): string | null {
  const fromMetrics = m.metrics?.video_id;
  if (typeof fromMetrics === "string" && VIDEO_ID_RE.test(fromMetrics)) return fromMetrics;
  const url = m.url ?? "";
  return url.match(WATCH_RE)?.[1] ?? url.match(SHORT_RE)?.[1] ?? null;
}

/** Un comentario de YouTube apunta al video padre (metrics.video_id o ?lc= en la URL). */
export function isYoutubeComment(m: Pick<Mention, "source" | "url" | "metrics">): boolean {
  if (m.source !== "youtube") return false;
  if (typeof m.metrics?.video_id === "string" && VIDEO_ID_RE.test(m.metrics.video_id)) return true;
  return /[?&]lc=/.test(m.url ?? "");
}

export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Formato compacto en español (29.761, 1,2 M). */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) {
    const compact = new Intl.NumberFormat("es-AR", {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: 1,
    }).format(n);
    return compact;
  }
  return new Intl.NumberFormat("es-AR").format(Math.round(n));
}

export interface YoutubeStats {
  views: number | null;
  likes: number | null;
  comments: number | null;
  replies: number | null;
}

export function youtubeStats(m: Pick<Mention, "metrics">): YoutubeStats {
  return {
    views: metricNumber(m.metrics, "view_count"),
    likes: metricNumber(m.metrics, "like_count"),
    comments: metricNumber(m.metrics, "comment_count"),
    replies: metricNumber(m.metrics, "reply_count"),
  };
}
