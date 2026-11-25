"use client";

import { useActionState, useState } from "react";
import { simulateResponseAction, type SimulateState } from "@/app/c/[slug]/simulador/actions";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { DRAFT_MAX_CHARS, DRAFT_MIN_CHARS } from "@/lib/response-simulator";

export function SimulatorForm({ slug, initialDraft, candidateName }: { slug: string; initialDraft: string; candidateName: string }) {
  const [state, action] = useActionState(simulateResponseAction, null as SimulateState);
  const [draft, setDraft] = useState(initialDraft);
  const len = draft.trim().length;
  const tooShort = len > 0 && len < DRAFT_MIN_CHARS;
  return (
    <form action={action} className="space-y-3" data-testid="simulador-form">
      <input type="hidden" name="slug" value={slug} />
      <label htmlFor="sim-draft" className="block text-sm font-medium text-slate-700">
        Borrador de la declaración
      </label>
      <textarea
        id="sim-draft"
        name="draft"
        rows={6}
        maxLength={DRAFT_MAX_CHARS}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`Escribí lo que diría ${candidateName}: un posteo, una respuesta en una entrevista o un comunicado.`}
        className="block w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={`text-xs tabular-nums ${tooShort ? "text-amber-700" : "text-slate-400"}`}>
          {len}/{DRAFT_MAX_CHARS}
          {tooShort ? ` · mínimo ${DRAFT_MIN_CHARS}` : ""}
        </p>
        <ActionSubmitButton
          pendingLabel="Simulando…"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          Simular recepción
        </ActionSubmitButton>
      </div>
      <p className="text-xs text-slate-500">Es privado: solo lo ves vos. Pulso no publica nada.</p>
      {state && !state.ok ? <p className="text-sm font-medium text-amber-800">{state.error}</p> : null}
    </form>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setDone(false);
        }
      }}
      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
    >
      {done ? "Copiado" : "Copiar"}
    </button>
  );
}
