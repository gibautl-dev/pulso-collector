"use client";

import { useActionState } from "react";
import { setCollectionPausedAction } from "@/app/admin/candidatos/actions";
import { ActionSubmitButton } from "@/components/action-submit-button";
import type { FormActionState } from "@/lib/form-action";

export function PauseResumeButton({
  candidateId,
  name,
  paused,
}: {
  candidateId: string;
  name: string;
  paused: boolean;
}) {
  const [state, action] = useActionState(setCollectionPausedAction, null as FormActionState);
  const nextPaused = !paused;
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="candidate_id" value={candidateId} />
      <input type="hidden" name="paused" value={nextPaused ? "true" : "false"} />
      <ActionSubmitButton
        pendingLabel={nextPaused ? "Pausando…" : "Reanudando…"}
        confirmMessage={
          nextPaused
            ? `Se deja de recolectar datos nuevos para ${name}. El tablero y lo ya medido siguen visibles.`
            : undefined
        }
        className={
          nextPaused
            ? "rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
            : "rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        }
      >
        {nextPaused ? "Pausar" : "Reanudar"}
      </ActionSubmitButton>
      {state?.ok ? <p className="text-xs font-medium text-emerald-800">{state.message}</p> : null}
      {state && !state.ok ? <p className="text-xs font-medium text-amber-800">{state.error}</p> : null}
    </form>
  );
}
