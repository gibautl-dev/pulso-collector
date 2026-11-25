import Link from "next/link";
import { RelevanceBadge, ToneBadge } from "@/components/ui";
import { cleanTitle } from "@/components/mention-row";
import { sourceLabel } from "@/lib/labels";
import { relativeTime } from "@/lib/time";
import type { Mention } from "@/lib/types";

function SourceGlyph({ source }: { source: string }) {
  if (source === "x") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900 text-[10px] font-bold text-white" title="X">
        X
      </span>
    );
  }
  if (source === "youtube") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-red-600 text-white" title="YouTube">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <path d="M8 6.5v11l10-5.5-10-5.5z" />
        </svg>
      </span>
    );
  }
  const letter = sourceLabel(source).slice(0, 1).toUpperCase();
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-200 text-[11px] font-bold text-slate-700" title={sourceLabel(source)}>
      {letter}
    </span>
  );
}

function authorLine(m: Mention): string {
  if (m.source === "x") {
    const handle = (m.author_handle || "").replace(/^@/, "");
    if (handle) return `@${handle}`;
    return m.author || m.outlet || "X";
  }
  if (m.source === "youtube") return m.author || m.outlet || "YouTube";
  return m.outlet || m.author || sourceLabel(m.source);
}

export function MentionFeedItem({
  m,
  slug,
  now,
}: {
  m: Mention;
  slug: string;
  now: Date;
}) {
  const when = relativeTime(m.published_at, now);
  const minutesAgo = when.startsWith("hace ") && when.endsWith(" min") ? Number(when.split(" ")[1]) : null;
  const label = when === "recién" || (minutesAgo != null && minutesAgo < 10) ? "ahora" : when;
  const toneBg =
    m.tone && ["critica", "acusacion", "insulto"].includes(m.tone)
      ? "bg-rose-50/70"
      : m.tone === "a_favor"
        ? "bg-emerald-50/60"
        : "bg-transparent";

  return (
    <li className={`rounded-xl px-3 py-3 ${toneBg}`}>
      <div className="flex items-start gap-3">
        <SourceGlyph source={m.source} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{authorLine(m)}</span>
            <ToneBadge tone={m.tone} />
            {m.relevance === "alta" ? <RelevanceBadge relevance="alta" /> : null}
            <span className="ml-auto shrink-0 tabular-nums text-slate-400">{label}</span>
          </div>
          <Link href={`/c/${slug}/menciones/${m.id}`} className="mt-1 block text-sm font-medium text-slate-900 hover:text-indigo-700">
            {cleanTitle(m)}
          </Link>
        </div>
      </div>
    </li>
  );
}
