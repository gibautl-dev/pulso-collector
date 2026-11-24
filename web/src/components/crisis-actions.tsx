"use client";

import { useState } from "react";
import { updateCrisisAlertStatus } from "@/app/c/[slug]/accion/actions";
import { CRISIS_CHANNEL_LABEL, CRISIS_STATUS_LABEL } from "@/lib/labels";
import type { CrisisStatus } from "@/lib/types";

const ACTIONS: { status: CrisisStatus; label: string; className: string }[] = [
  { status: "in_review", label: "Pasar a revisión", className: "bg-indigo-600 hover:bg-indigo-700 text-white" },
  { status: "approved", label: "Aprobar", className: "bg-emerald-600 hover:bg-emerald-700 text-white" },
  { status: "discarded", label: "Descartar", className: "bg-slate-200 hover:bg-slate-300 text-slate-800" },
];

export function CrisisStatusForm({
  slug,
  id,
  current,
}: {
  slug: string;
  id: string;
  current: CrisisStatus;
}) {
  return (
    <form action={updateCrisisAlertStatus} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Nota (opcional, la ve tu equipo)</span>
        <textarea
          name="status_note"
          rows={2}
          maxLength={500}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
      </label>
      <p className="text-xs text-slate-500">
        Estado actual: {CRISIS_STATUS_LABEL[current]}. El cambio lo hace una persona; Pulso no publica ni postea nada.
      </p>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.filter((a) => a.status !== current).map((action) => (
          <button
            key={action.status}
            type="submit"
            name="status"
            value={action.status}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${action.className}`}
          >
            {action.label}
          </button>
        ))}
      </div>
    </form>
  );
}

export function CopyDraftButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copiado" : label ?? "Copiar"}
    </button>
  );
}

export function DraftBlock({
  channel,
  text,
  notes,
}: {
  channel: string;
  text: string;
  notes?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {CRISIS_CHANNEL_LABEL[channel] ?? channel}
        </p>
        <CopyDraftButton text={text} />
      </div>
      <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6 text-slate-800">{text}</pre>
      {notes ? <p className="mt-2 text-xs text-slate-500">{notes}</p> : null}
    </div>
  );
}
