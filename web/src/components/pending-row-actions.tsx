"use client";

import { useActionState } from "react";
import { approvePendingCandidate, deletePendingCandidate } from "@/app/admin/rivales/actions";
import { ActionSubmitButton } from "@/components/action-submit-button";
import type { FormActionState } from "@/lib/form-action";
import { PENDING_CANDIDATE_STATUS_LABELS, RIVAL_LEVEL_LABEL } from "@/lib/labels";
import type { PendingCandidate } from "@/lib/types";

export function PendingRowActions({ row }: { row: PendingCandidate }) {
  const [approveState, approveAction] = useActionState(approvePendingCandidate, null as FormActionState);
  const [deleteState, deleteAction] = useActionState(deletePendingCandidate, null as FormActionState);
  const state = deleteState ?? approveState;
  const statusLabel = PENDING_CANDIDATE_STATUS_LABELS[row.status] ?? row.status;

  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className={`text-xs ${row.status === "aprobado" ? "text-emerald-800" : "text-amber-800"}`}>
            {statusLabel} · {RIVAL_LEVEL_LABEL[row.requested_level]}
            {row.arena ? ` · ${row.arena}` : ""} · {row.source === "ai_suggestion" ? "desde una sugerencia" : "pedido a mano"}
          </p>
          {row.status === "aprobado" ? (
            <p className="mt-1 text-xs text-slate-500">
              Aprobado y activado: empieza a medirse en la próxima recolección
              {row.approved_at ? ` · aprobado el ${row.approved_at.slice(0, 16).replace("T", " ")}` : ""}.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row.status === "pendiente_de_alta" ? (
            <form action={approveAction}>
              <input type="hidden" name="pending_id" value={row.id} />
              <ActionSubmitButton
                pendingLabel="Aprobando…"
                className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
              >
                Aprobar
              </ActionSubmitButton>
            </form>
          ) : null}
          <form action={deleteAction}>
            <input type="hidden" name="pending_id" value={row.id} />
            <input type="hidden" name="name" value={row.name} />
            <ActionSubmitButton
              pendingLabel="Borrando…"
              confirmMessage={`¿Borrar el pedido de alta de ${row.name}? Sale de la lista. No borra recolección porque todavía no se mide.`}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Borrar
            </ActionSubmitButton>
          </form>
        </div>
      </div>
      {state?.ok ? <p className="mt-2 text-sm font-medium text-emerald-800">{state.message}</p> : null}
      {state && !state.ok ? <p className="mt-2 text-sm font-medium text-amber-800">{state.error}</p> : null}
    </li>
  );
}
