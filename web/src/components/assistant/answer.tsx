import Link from "next/link";
import type { ReactNode } from "react";
import { sourceLabel, TONE_LABEL } from "@/lib/labels";
import { formatDateTime, clockFor } from "@/lib/time";
import type { AssistantAnswer, AssistantCitation, Tone } from "@/lib/types";

const FACT_TONE: Record<string, string> = {
  positive: "text-emerald-700",
  negative: "text-rose-700",
  default: "text-slate-900",
};

const TONE_DOT: Record<string, string> = {
  a_favor: "bg-emerald-500",
  critica: "bg-rose-500",
  acusacion: "bg-rose-600",
  insulto: "bg-rose-700",
  pregunta: "bg-amber-400",
  informativo: "bg-slate-400",
};

/** Texto con [m1] → número de cita clickeable. Párrafos y viñetas "- ". */
function renderText(text: string, order: Map<string, number>, anchor: string): ReactNode[] {
  const blocks = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const inline = (line: string, key: string) =>
    line.split(/(\[m\d{1,3}\])/g).map((part, i) => {
      const m = /^\[(m\d{1,3})\]$/.exec(part);
      if (!m) return <span key={`${key}-${i}`}>{part.replace(/\*\*/g, "")}</span>;
      const n = order.get(m[1]);
      if (!n) return null;
      return (
        <a
          key={`${key}-${i}`}
          href={`#${anchor}-${n}`}
          className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-0.5 items-center justify-center rounded-full bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-700 no-underline hover:bg-indigo-200"
          aria-label={`Fuente ${n}`}
        >
          {n}
        </a>
      );
    });
  const out: ReactNode[] = [];
  let bullets: ReactNode[] = [];
  const flush = (k: string) => {
    if (bullets.length) out.push(<ul key={`ul-${k}`} className="ml-4 list-disc space-y-1 marker:text-indigo-400">{bullets}</ul>);
    bullets = [];
  };
  blocks.forEach((line, i) => {
    if (/^[-•]\s+/.test(line)) {
      bullets.push(<li key={`li-${i}`}>{inline(line.replace(/^[-•]\s+/, ""), `l${i}`)}</li>);
    } else {
      flush(String(i));
      out.push(<p key={`p-${i}`}>{inline(line, `p${i}`)}</p>);
    }
  });
  flush("end");
  return out;
}

function CitationCard({ c, n, anchor, slug }: { c: AssistantCitation; n: number; anchor: string; slug: string }) {
  const clock = clockFor(c.candidate_slug || slug);
  const who = c.own ? "Cuenta oficial" : c.outlet || c.author || sourceLabel(c.source);
  return (
    <li id={`${anchor}-${n}`} className="group flex gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-indigo-200 hover:shadow-sm">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-semibold text-indigo-700">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-500">
          <span className="font-medium text-slate-700">{who}</span>
          <span aria-hidden>·</span>
          <span>{sourceLabel(c.source)}</span>
          <span aria-hidden>·</span>
          <span>{formatDateTime(c.published_at, clock)}</span>
          {c.tone ? (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden>·</span>
              <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[c.tone] ?? "bg-slate-300"}`} />
              {TONE_LABEL[c.tone as Tone] ?? c.tone}
            </span>
          ) : null}
        </p>
        <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-slate-900">{c.title}</p>
        <div className="mt-1.5 flex gap-3 text-xs font-medium">
          <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="text-indigo-600 hover:text-indigo-500">
            Ver original ↗
          </a>
          <Link href={`/c/${c.candidate_slug || slug}/menciones/${c.id}`} className="text-slate-500 hover:text-slate-700">
            Ver en Pulso
          </Link>
        </div>
      </div>
    </li>
  );
}

export function AnswerView({ answer, slug, anchor }: { answer: AssistantAnswer; slug: string; anchor: string }) {
  const order = new Map(answer.citations.map((c, i) => [c.ref, i + 1]));
  return (
    <div className="space-y-3">
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">{renderText(answer.text, order, anchor)}</div>
      {answer.facts.length ? (
        <dl className="grid grid-cols-2 gap-2">
          {answer.facts.map((f) => (
            <div key={f.label} className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200/70">
              <dt className="text-[11px] font-medium text-slate-500">{f.label}</dt>
              <dd className={`mt-0.5 text-base font-semibold tracking-tight ${FACT_TONE[f.tone ?? "default"]}`}>{f.value}</dd>
              {f.hint ? <dd className="text-[11px] text-slate-400">{f.hint}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}
      {answer.citations.length ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Fuentes</p>
          <ol className="space-y-2">
            {answer.citations.map((c, i) => (
              <CitationCard key={c.id} c={c} n={i + 1} anchor={anchor} slug={slug} />
            ))}
          </ol>
        </div>
      ) : null}
      {answer.notes.length ? (
        <p className="text-[11px] leading-relaxed text-slate-400">{answer.notes.join(" ")}</p>
      ) : null}
    </div>
  );
}
