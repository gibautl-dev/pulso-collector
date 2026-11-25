"use client";

import { updateInconsistencyAlertStatus } from "@/app/c/[slug]/contradicciones/actions";
import { CRISIS_STATUS_LABEL } from "@/lib/labels";
import type { CrisisStatus } from "@/lib/types";

const ACTIONS: { status: CrisisStatus; label: string; className: string }[] = [
  { status: "in_review", label: "Pasar a revisión", className: "bg-indigo-600 hover:bg-indigo-700 text-white" },
  { status: "approved", label: "Confirmar", className: "bg-emerald-600 hover:bg-emerald-700 text-white" },
  { status: "discarded", label: "Descartar", className: "bg-slate-200 hover:bg-slate-300 text-slate-800" },
];

export function InconsistencyStatusForm({ slug, id, current }: { slug: string; id: string; current: CrisisStatus }) {
  return (
    <form action={updateInconsistencyAlertStatus} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Nota para el equipo (opcional)</span>
        <textarea
          name="status_note"
          rows={2}
          maxLength={500}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
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
        <span className="text-xs text-slate-500">Estado: {CRISIS_STATUS_LABEL[current]}</span>
      </div>
    </form>
  );
}
