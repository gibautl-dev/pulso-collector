"use client";

import { useActionState } from "react";
import type { FormActionState } from "@/lib/form-action";

export function AiCapForm({
  action,
  current,
}: {
  action: (prev: FormActionState, formData: FormData) => Promise<FormActionState>;
  current: number;
}) {
  const [state, formAction, pending] = useActionState(action, null as FormActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3" data-testid="ai-cap-form">
      <label className="block text-xs text-slate-500">
        Tope diario de En la IA (USD, total)
        <input
          name="daily_budget_usd"
          type="number"
          min={0}
          max={50}
          step={0.01}
          defaultValue={current.toFixed(2)}
          required
          className="mt-1 block w-28 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums text-slate-800"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Guardando…" : "Guardar tope"}
      </button>
      {state ? (
        <p className={`text-xs ${state.ok ? "text-emerald-700" : "text-rose-700"}`} role="status">
          {state.ok ? state.message : state.error}
        </p>
      ) : null}
    </form>
  );
}
