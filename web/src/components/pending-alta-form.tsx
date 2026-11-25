"use client";

import { useActionState, useEffect, useRef } from "react";
import { addPendingCandidate } from "@/app/admin/rivales/actions";
import { ActionSubmitButton } from "@/components/action-submit-button";
import type { FormActionState } from "@/lib/form-action";
import { RIVAL_LEVEL_LABEL } from "@/lib/labels";
import { RIVAL_LEVELS, type RivalLevel } from "@/lib/types";

export function PendingAltaForm({
  candidateId,
  source = "manual",
  defaultName,
  defaultArena,
  defaultReason,
  defaultLevel = "comparativo",
  arenaPlaceholder,
  compact = false,
}: {
  candidateId: string;
  source?: "manual" | "ai_suggestion";
  defaultName?: string;
  defaultArena?: string;
  defaultReason?: string;
  defaultLevel?: RivalLevel;
  arenaPlaceholder?: string;
  compact?: boolean;
}) {
  const [state, action] = useActionState(addPendingCandidate, null as FormActionState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className={compact ? "mt-2 space-y-2" : "mt-3 space-y-3"}>
      <input type="hidden" name="candidate_id" value={candidateId} />
      <input type="hidden" name="source" value={source} />
      {defaultName ? <input type="hidden" name="name" value={defaultName} /> : null}
      {defaultArena ? <input type="hidden" name="arena" value={defaultArena} /> : null}
      {defaultReason ? <input type="hidden" name="reason" value={defaultReason} /> : null}
      <div className="flex flex-wrap items-end gap-2">
        {defaultName ? null : (
          <label className="text-xs text-slate-500">
            Nombre
            <input
              name="name"
              required
              maxLength={120}
              placeholder="Nombre o fuerza política"
              className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 disabled:bg-slate-100"
            />
          </label>
        )}
        {defaultArena ? null : (
          <label className="text-xs text-slate-500">
            Arena (opcional)
            <input
              name="arena"
              maxLength={80}
              placeholder={arenaPlaceholder}
              className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 disabled:bg-slate-100"
            />
          </label>
        )}
        <label className="text-xs text-slate-500">
          Nivel
          <select
            name="level"
            defaultValue={defaultLevel}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
          >
            {RIVAL_LEVELS.map((opt) => (
              <option key={opt} value={opt}>
                {RIVAL_LEVEL_LABEL[opt]}
              </option>
            ))}
          </select>
        </label>
        <ActionSubmitButton
          pendingLabel="Enviando…"
          className={
            compact
              ? "rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
              : "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
          }
        >
          {compact ? "Pedir alta (queda pendiente, no se recolecta)" : "Pedir alta pendiente"}
        </ActionSubmitButton>
      </div>
      {state?.ok ? <p className="text-sm font-medium text-emerald-800">{state.message}</p> : null}
      {state && !state.ok ? <p className="text-sm font-medium text-amber-800">{state.error}</p> : null}
    </form>
  );
}
