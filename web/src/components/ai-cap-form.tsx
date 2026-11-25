"use client";

import { useActionState } from "react";
import type { FormActionState } from "@/lib/form-action";

export function AiCapForm({
  action,
  current,
  candidateId,
  candidateName,
}: {
  action: (prev: FormActionState, formData: FormData) => Promise<FormActionState>;
  current: number;
  candidateId: string;
  candidateName: string;
}) {
  const [state, formAction, pending] = useActionState(action, null as FormActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2" data-testid="ai-cap-form">
      <input type="hidden" name="candidate_id" value={candidateId} />
      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="sr-only">Tope diario de {candidateName} en USD</span>
        USD
        <input
          name="daily_budget_usd"
          type="number"
          min={0}
          max={50}
          step={0.01}
          defaultValue={current.toFixed(2)}
          required
          className="block w-24 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums text-slate-800"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Guardando…" : "Guardar"}
      </button>
      {state ? (
        <p className={`text-xs ${state.ok ? "text-emerald-700" : "text-rose-700"}`} role="status">
          {state.ok ? state.message : state.error}
        </p>
      ) : null}
    </form>
  );
}
