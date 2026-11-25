import { Badge, InfoTip } from "@/components/ui";
import { InconsistencyStatusForm } from "@/components/inconsistency-status";
import { CRISIS_STATUS_BADGE, CRISIS_STATUS_LABEL } from "@/lib/labels";
import {
  KIND_HINT,
  KIND_LABEL,
  PIECE_LABEL,
  SEVERITY_ACCENT,
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  daysLabel,
  pieceDate,
  pieceText,
  pieceOutlet,
  sideTitles,
} from "@/lib/inconsistency";
import type { InconsistencyAlert, InconsistencyPiece } from "@/lib/types";

function Quote({ piece, title, tone, timeZone }: {
  piece: InconsistencyPiece;
  title: string;
  tone: "before" | "after";
  timeZone: string;
}) {
  const extra = Math.max(0, (piece.copies ?? 1) - 1);
  return (
    <figure
      className={`flex h-full flex-col rounded-xl border p-4 ${
        tone === "after" ? "border-rose-200 bg-rose-50/40" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${tone === "after" ? "text-rose-700" : "text-slate-500"}`}>
          {title}
        </p>
        <p className="text-xs font-medium tabular-nums text-slate-600">{pieceDate(piece, timeZone)}</p>
      </div>
      <blockquote className="mt-2 flex-1 text-[15px] font-medium leading-relaxed text-slate-900">
        <span aria-hidden className="mr-0.5 text-slate-400">“</span>
        {pieceText(piece)}
        <span aria-hidden className="ml-0.5 text-slate-400">”</span>
      </blockquote>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{pieceOutlet(piece)}</span>
        <span>{PIECE_LABEL[piece.kind] ?? "Nota"}</span>
        {extra > 0 ? <span>+{extra} medio{extra === 1 ? "" : "s"} con el mismo título</span> : null}
        <a href={piece.url} target="_blank" rel="noopener noreferrer" className="ml-auto font-medium text-indigo-700 hover:text-indigo-500">
          Ver original ↗
        </a>
      </figcaption>
    </figure>
  );
}

function MissingQuote({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col justify-center rounded-xl border border-dashed border-slate-300 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-sm text-slate-600">
        La declaración original no aparece en lo que medimos. Conviene buscarla antes de responder.
      </p>
    </div>
  );
}

export function InconsistencyAlertCard({ alert, slug, timeZone }: { alert: InconsistencyAlert; slug: string; timeZone: string }) {
  const titles = sideTitles(alert);
  const gap = daysLabel(alert.days_between);
  return (
    <article data-testid="contradiccion" className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${SEVERITY_ACCENT[alert.severity]}`} />
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        <Badge className="bg-indigo-50 text-indigo-700 ring-indigo-200">{KIND_LABEL[alert.kind]}</Badge>
        <InfoTip text={KIND_HINT[alert.kind]} label="Qué significa" />
        <Badge className={SEVERITY_BADGE[alert.severity]}>Severidad {SEVERITY_LABEL[alert.severity].toLowerCase()}</Badge>
        {alert.topic_label ? <span className="text-sm font-semibold text-slate-900">{alert.topic_label}</span> : null}
        <span className="ml-auto">
          <Badge className={CRISIS_STATUS_BADGE[alert.status]}>{CRISIS_STATUS_LABEL[alert.status]}</Badge>
        </span>
      </header>

      <div className="grid gap-3 p-5 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        {alert.earlier ? (
          <Quote piece={alert.earlier} title={titles.before} tone="before" timeZone={timeZone} />
        ) : (
          <MissingQuote title={titles.before} />
        )}
        <div className="flex items-center justify-center md:flex-col">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-4 w-4 rotate-90 md:rotate-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
          {gap ? <span className="ml-2 text-[11px] font-medium text-slate-500 md:ml-0 md:mt-1.5 md:text-center">{gap}</span> : null}
        </div>
        <Quote piece={alert.later} title={titles.after} tone="after" timeZone={timeZone} />
      </div>

      <div className="grid gap-4 border-t border-slate-100 px-5 py-4 md:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Por qué es una alerta</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-800">{alert.explanation}</p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            Siguiente paso sugerido
            <InfoTip text="Sugerencia para que el equipo decida. Pulso no publica ni responde nada." />
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-800">{alert.next_step}</p>
        </div>
      </div>

      <details className="group border-t border-slate-100 px-5 py-3">
        <summary className="cursor-pointer list-none text-sm font-medium text-indigo-700 hover:text-indigo-500">
          <span className="group-open:hidden">Revisar alerta →</span>
          <span className="hidden group-open:inline">Cerrar revisión</span>
        </summary>
        <div className="mt-3">
          {alert.status_note ? <p className="mb-2 text-xs text-slate-600">Nota: {alert.status_note}</p> : null}
          <InconsistencyStatusForm slug={slug} id={alert.id} current={alert.status} />
        </div>
      </details>
    </article>
  );
}
