import Link from "next/link";
import { RelevanceBadge, ToneBadge } from "@/components/ui";
import { TARGET_LABEL } from "@/lib/labels";
import { formatDateTime } from "@/lib/time";
import type { Mention } from "@/lib/types";
import { xEngagement, xFlag, xHandle, xPostText, xProfileUrl } from "@/lib/x-posts";
import { formatCount } from "@/lib/youtube";

function KindBadge({ m }: { m: Mention }) {
  if (xFlag(m, "is_retweet")) {
    return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">Repost</span>;
  }
  if (xFlag(m, "is_reply")) {
    return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">Respuesta</span>;
  }
  if (xFlag(m, "is_quote")) {
    return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">Cita</span>;
  }
  return null;
}

function EngagementMeta({ m }: { m: Mention }) {
  const e = xEngagement(m);
  const parts: { key: string; label: string }[] = [];
  if (e.likes != null) parts.push({ key: "likes", label: `${formatCount(e.likes)} me gusta` });
  if (e.reposts != null) parts.push({ key: "reposts", label: `${formatCount(e.reposts)} reposts` });
  if (e.replies != null) parts.push({ key: "replies", label: `${formatCount(e.replies)} respuestas` });
  if (e.quotes != null) parts.push({ key: "quotes", label: `${formatCount(e.quotes)} citas` });
  if (e.impressions != null) parts.push({ key: "impr", label: `${formatCount(e.impressions)} impresiones` });
  if (parts.length === 0) return null;
  return (
    <>
      {parts.map((p) => (
        <span key={p.key}>{p.label}</span>
      ))}
    </>
  );
}

export function XPostCard({ m, slug }: { m: Mention; slug: string }) {
  const handle = xHandle(m);
  const name = (m.author ?? "").trim() || (handle ? `@${handle}` : "Cuenta en X");
  const profile = handle ? xProfileUrl(handle) : null;

  return (
    <li className="border-b border-slate-100 py-4 last:border-b-0 last:pb-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <ToneBadge tone={m.tone} />
        <RelevanceBadge relevance={m.relevance} />
        <KindBadge m={m} />
        {m.target && m.target !== "candidate" && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{TARGET_LABEL[m.target]}</span>
        )}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-900">{xPostText(m)}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {profile ? (
          <a href={profile} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-slate-700 hover:text-indigo-700">
            {name}
            {handle ? <span className="font-normal text-slate-500"> @{handle}</span> : null}
          </a>
        ) : (
          <span className="font-medium text-slate-700">{name}</span>
        )}
        <span>{formatDateTime(m.published_at)}</span>
        <EngagementMeta m={m} />
        <a
          href={m.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500"
        >
          Ver en X
          <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor" aria-hidden>
            <path d="M11 3h6v6h-2V6.4l-6.3 6.3-1.4-1.4L13.6 5H11V3zM5 5h4v2H5v8h8v-4h2v6H3V5h2z" />
          </svg>
        </a>
        <Link href={`/c/${slug}/menciones/${m.id}`} className="font-medium text-slate-500 hover:text-indigo-600">
          Ver en Pulso
        </Link>
      </div>
    </li>
  );
}

