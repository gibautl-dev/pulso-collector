import Link from "next/link";
import { RelevanceBadge, SourceBadge, ToneBadge } from "@/components/ui";
import { TARGET_LABEL } from "@/lib/labels";
import { clockFor, formatDateTime } from "@/lib/time";
import { mentionHeadline } from "@/lib/mention-excerpt";
import type { Mention } from "@/lib/types";
import { xEngagement, xHandle } from "@/lib/x-posts";
import {
  formatCount,
  isYoutubeComment,
  youtubeStats,
  youtubeThumbnailUrl,
  youtubeVideoId,
} from "@/lib/youtube";

export function cleanTitle(m: Pick<Mention, "title" | "content" | "outlet">): string {
  return mentionHeadline(m);
}

function YoutubeKindBadge({ comment }: { comment: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
        comment ? "bg-slate-100 text-slate-600" : "bg-red-50 text-red-800"
      }`}
    >
      {comment ? "Comentario" : "Video"}
    </span>
  );
}

function YoutubeMeta({ m }: { m: Mention }) {
  const comment = isYoutubeComment(m);
  const stats = youtubeStats(m);
  const parts: string[] = [];
  if (comment) {
    if (m.author) parts.push(m.author);
    if (m.outlet && m.outlet !== m.author) parts.push(m.outlet);
  } else if (m.author || m.outlet) {
    parts.push(m.author ?? m.outlet!);
  }
  if (!comment && stats.views != null) parts.push(`${formatCount(stats.views)} vistas`);
  if (stats.likes != null) parts.push(`${formatCount(stats.likes)} me gusta`);
  if (!comment && stats.comments != null) parts.push(`${formatCount(stats.comments)} comentarios`);
  if (comment && stats.replies != null) parts.push(`${formatCount(stats.replies)} respuestas`);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
    </>
  );
}

function XMeta({ m }: { m: Mention }) {
  const handle = xHandle(m);
  const e = xEngagement(m);
  const parts: string[] = [];
  const name = (m.author ?? "").trim();
  if (name && handle) parts.push(`${name} @${handle}`);
  else if (handle) parts.push(`@${handle}`);
  else if (name) parts.push(name);
  else if (m.outlet) parts.push(m.outlet);
  if (e.likes != null) parts.push(`${formatCount(e.likes)} me gusta`);
  if (e.reposts != null) parts.push(`${formatCount(e.reposts)} reposts`);
  if (e.impressions != null) parts.push(`${formatCount(e.impressions)} impresiones`);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className={i === 0 ? "font-medium text-slate-700" : undefined}>{p}</span>
      ))}
    </>
  );
}

export function MentionRow({ m, slug, topicLabel, compact = false }: {
  m: Mention;
  slug: string;
  topicLabel?: string;
  compact?: boolean;
}) {
  const clock = clockFor(slug);
  const isYt = m.source === "youtube";
  const videoId = isYt ? youtubeVideoId(m) : null;
  const thumb = videoId ? youtubeThumbnailUrl(videoId) : null;
  const comment = isYt && isYoutubeComment(m);

  return (
    <li className="group py-4 first:pt-0 last:pb-0">
      <div className={isYt && thumb ? "flex gap-3" : undefined}>
        {isYt && thumb && (
          <a
            href={m.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="relative mt-0.5 shrink-0 overflow-hidden rounded-md bg-slate-200"
            aria-label="Ver en YouTube"
          >
            {/* Miniatura pública de i.ytimg.com, derivada del ID del video (no se guarda en la base). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt=""
              width={128}
              height={72}
              className="h-[72px] w-[128px] object-cover"
            />
            {comment && (
              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-medium text-white">
                Comentario
              </span>
            )}
          </a>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <ToneBadge tone={m.tone} />
            <RelevanceBadge relevance={m.relevance} />
            <SourceBadge source={m.source} />
            {isYt && <YoutubeKindBadge comment={comment} />}
            {m.target && m.target !== "candidate" && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{TARGET_LABEL[m.target]}</span>
            )}
            {topicLabel && <span className="text-slate-600">· {topicLabel}</span>}
          </div>
          <Link href={`/c/${slug}/menciones/${m.id}`} className="mt-1.5 block text-sm font-medium text-slate-900 hover:text-indigo-700">
            {cleanTitle(m)}
          </Link>
          {!compact && m.tone_reason && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{m.tone_reason}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {isYt ? (
              <YoutubeMeta m={m} />
            ) : m.source === "x" ? (
              <XMeta m={m} />
            ) : (
              <span className="font-medium text-slate-700">{m.outlet ?? "Sin medio"}</span>
            )}
            <span>{formatDateTime(m.published_at, clock)}</span>
            <a href={m.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500">
              {isYt ? "Ver en YouTube" : m.source === "x" ? "Ver en X" : "Ver fuente"}
              <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor" aria-hidden><path d="M11 3h6v6h-2V6.4l-6.3 6.3-1.4-1.4L13.6 5H11V3zM5 5h4v2H5v8h8v-4h2v6H3V5h2z" /></svg>
            </a>
          </div>
        </div>
      </div>
    </li>
  );
}
