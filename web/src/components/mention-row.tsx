import Link from "next/link";
import { RelevanceBadge, ToneBadge } from "@/components/ui";
import { sourceLabel, TARGET_LABEL } from "@/lib/labels";
import { formatDateTime } from "@/lib/time";
import type { Mention } from "@/lib/types";

export function cleanTitle(m: Pick<Mention, "title" | "outlet">): string {
  const t = (m.title ?? "").trim();
  // Google News agrega " - Medio" al final del título.
  if (m.outlet && t.endsWith(` - ${m.outlet}`)) return t.slice(0, -(m.outlet.length + 3));
  return t || "(sin título)";
}

export function MentionRow({ m, slug, topicLabel, compact = false }: {
  m: Mention;
  slug: string;
  topicLabel?: string;
  compact?: boolean;
}) {
  return (
    <li className="group py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <ToneBadge tone={m.tone} />
        <RelevanceBadge relevance={m.relevance} />
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
        <span className="font-medium text-slate-700">{m.outlet ?? "Sin medio"}</span>
        <span>{sourceLabel(m.source)}</span>
        <span>{formatDateTime(m.published_at)}</span>
        <a href={m.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500">
          Ver fuente
          <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor" aria-hidden><path d="M11 3h6v6h-2V6.4l-6.3 6.3-1.4-1.4L13.6 5H11V3zM5 5h4v2H5v8h8v-4h2v6H3V5h2z" /></svg>
        </a>
      </div>
    </li>
  );
}
