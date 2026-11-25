"use client";

import { useActionState } from "react";
import { suggestRivals } from "@/app/admin/rivales/actions";
import { ActionSubmitButton } from "@/components/action-submit-button";
import type { FormActionState } from "@/lib/form-action";

export function SuggestRivalsForm({
  candidateId,
  hasSuggestions,
}: {
  candidateId: string;
  hasSuggestions: boolean;
}) {
  const [state, action] = useActionState(suggestRivals, null as FormActionState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="candidate_id" value={candidateId} />
      <ActionSubmitButton
        pendingLabel="Consultando…"
        className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
      >
        {hasSuggestions ? "Pedir una nueva sugerencia" : "Sugerir rivales con IA"}
      </ActionSubmitButton>
      {state?.ok ? <p className="text-sm font-medium text-emerald-800">{state.message}</p> : null}
      {state && !state.ok ? <p className="text-sm font-medium text-amber-800">{state.error}</p> : null}
    </form>
  );
}
