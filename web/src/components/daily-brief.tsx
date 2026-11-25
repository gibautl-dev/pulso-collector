import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, InfoTip, ToneBadge } from "@/components/ui";
import { sourceLabel } from "@/lib/labels";
import {
  AREA_LABEL,
  PRIORITY_BADGE,
  PRIORITY_LABEL,
  sourcesFor,
  type BriefKpi,
} from "@/lib/daily-brief";
import type { DailyBriefAction, DailyBriefHighlight, DailyBriefPoint, DailyBriefSource } from "@/lib/types";

function Glyph({ source }: { source: string }) {
  if (source === "x") {
    return <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-zinc-900 text-[8px] font-bold text-white">X</span>;
  }
  if (source === "youtube") {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-red-600 text-white">
        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="currentColor" aria-hidden>
          <path d="M8 6.5v11l10-5.5-10-5.5z" />
        </svg>
      </span>
    );
  }
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-slate-200 text-[9px] font-bold text-slate-700">
      {sourceLabel(source).slice(0, 1).toUpperCase()}
    </span>
  );
}

export function cleanSourceTitle(s: Pick<DailyBriefSource, "title" | "outlet">): string {
  let t = (s.title || "").trim();
  if (s.outlet) {
    const suffix = ` - ${s.outlet}`;
    if (t.endsWith(suffix)) t = t.slice(0, -suffix.length).trim();
  }
  return t;
}

function shortOutlet(outlet: string | null, source: string): string {
  const base = (outlet || sourceLabel(source)).split(/\s[-–:|]\s|:\s/)[0].trim();
  return base.length > 28 ? `${base.slice(0, 27)}…` : base;
}

/** Fuentes de un punto: abren la nota o el post original. */
export function SourcePills({ ids, sources, max = 3 }: { ids: string[]; sources: DailyBriefSource[]; max?: number }) {
  const list = sourcesFor(ids, sources);
  if (list.length === 0) return null;
  const shown = list.slice(0, max);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {shown.map((s) => (
        <a
          key={s.id}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          title={cleanSourceTitle(s)}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
        >
          <Glyph source={s.source} />
          <span className="truncate">{shortOutlet(s.outlet, s.source)}</span>
          <span aria-hidden>↗</span>
        </a>
      ))}
      {list.length > max ? <span className="text-[11px] text-slate-500">+{list.length - max}</span> : null}
    </div>
  );
}

export function HighlightCard({ highlight, note }: { highlight: DailyBriefHighlight; note?: string | null }) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 p-5 text-white shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-100">
        Dato del día
        {note ? <InfoTip text={note} label="Sobre este dato" /> : null}
      </p>
      <p className="mt-2 text-5xl font-semibold tabular-nums">{highlight.value}</p>
      <p className="mt-1 text-sm text-indigo-50">{highlight.label}</p>
      {highlight.delta ? (
        <p className="mt-3 inline-flex rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">{highlight.delta}</p>
      ) : null}
    </div>
  );
}

export function KpiStrip({ kpis }: { kpis: BriefKpi[] }) {
  return (
    <div data-testid="resumen-kpis" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.key} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k.label}</p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              k.tone === "negative" ? "text-rose-600" : k.tone === "positive" ? "text-emerald-600" : "text-slate-900"
            }`}
          >
            {k.value}
          </p>
          {k.hint ? <p className="mt-0.5 text-[11px] text-slate-500">{k.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}

function SectionShell({ title, icon, accent, children, testId, info }: {
  title: string;
  icon: string;
  accent: string;
  children: ReactNode;
  testId: string;
  info?: string;
}) {
  return (
    <section data-testid={testId} className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${accent}`}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={icon} />
          </svg>
        </span>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {info ? <InfoTip text={info} /> : null}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PointsSection({ title, icon, accent, items, sources, empty, testId }: {
  title: string;
  icon: string;
  accent: string;
  items: DailyBriefPoint[];
  sources: DailyBriefSource[];
  empty: string;
  testId: string;
}) {
  return (
    <SectionShell title={title} icon={icon} accent={accent} testId={testId}>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ol className="space-y-4">
          {items.map((p, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm leading-relaxed text-slate-800">{p.text}</p>
                <SourcePills ids={p.mention_ids} sources={sources} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionShell>
  );
}

export function ActionsSection({ items, sources }: { items: DailyBriefAction[]; sources: DailyBriefSource[] }) {
  return (
    <SectionShell
      title="Qué hacer"
      icon="M5 12l4 4L19 6"
      accent="bg-emerald-50 text-emerald-700"
      testId="resumen-que-hacer"
      info="Sugerencias para que el equipo las revise y decida. Pulso no publica ni responde nada por su cuenta."
    >
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Sin sugerencias para este día.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((a, i) => (
            <li key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={PRIORITY_BADGE[a.priority] ?? PRIORITY_BADGE.media}>{PRIORITY_LABEL[a.priority] ?? a.priority}</Badge>
                {a.area ? <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{AREA_LABEL[a.area] ?? a.area}</span> : null}
              </div>
              <p className="mt-2 text-sm font-semibold leading-snug text-slate-900">{a.action}</p>
              {a.why ? <p className="mt-1 text-xs leading-relaxed text-slate-600">{a.why}</p> : null}
              <SourcePills ids={a.mention_ids} sources={sources} />
            </li>
          ))}
        </ul>
      )}
    </SectionShell>
  );
}

export function SourcesList({ sources, slug }: { sources: DailyBriefSource[]; slug: string }) {
  return (
    <ul className="divide-y divide-slate-100">
      {sources.map((s) => (
        <li key={s.id} className="flex items-start gap-3 py-3">
          <span className="mt-0.5"><Glyph source={s.source} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{shortOutlet(s.outlet, s.source)}</span>
              <ToneBadge tone={s.tone} />
              {s.time ? <span className="tabular-nums text-slate-400">{s.time}</span> : null}
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-slate-800">{cleanSourceTitle(s)}</p>
            <div className="mt-1 flex gap-3 text-xs font-medium">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-indigo-700 hover:text-indigo-500">
                Ver original ↗
              </a>
              <Link href={`/c/${slug}/menciones/${s.id}`} className="text-slate-500 hover:text-slate-700">
                Detalle
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
