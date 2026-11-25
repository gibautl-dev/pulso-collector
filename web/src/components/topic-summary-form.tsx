"use client";

import { useActionState } from "react";
import { requestTopicSummaryAction } from "@/app/c/[slug]/temas/actions";
import { ActionSubmitButton } from "@/components/action-submit-button";
import type { FormActionState } from "@/lib/form-action";

export function TopicSummaryForm({
  slug,
  topicId,
  hasLatest,
}: {
  slug: string;
  topicId: string;
  hasLatest: boolean;
}) {
  const [state, action] = useActionState(requestTopicSummaryAction, null as FormActionState);
  return (
    <form action={action} className="mb-4 space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="topic_id" value={topicId} />
      <ActionSubmitButton
        pendingLabel="Pidiendo resumen…"
        className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
      >
        {hasLatest ? "Pedir un resumen nuevo" : "Pedir resumen al analista"}
      </ActionSubmitButton>
      <p className="text-xs text-slate-500">
        El resumen queda para que una persona lo revise. Pulso no publica nada.
      </p>
      {state?.ok ? <p className="text-sm font-medium text-emerald-800">{state.message}</p> : null}
      {state && !state.ok ? <p className="text-sm font-medium text-amber-800">{state.error}</p> : null}
    </form>
  );
}
