"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createCandidateAction } from "@/app/admin/candidatos/actions";
import { ActionSubmitButton } from "@/components/action-submit-button";
import type { FormActionState } from "@/lib/form-action";
import { COUNTRY_LABEL, COLLECTION_MODE_LABEL, RIVAL_LEVEL_LABEL } from "@/lib/labels";
import { slugifyName } from "@/lib/rival-suggest";
import { RIVAL_LEVELS, type Candidate } from "@/lib/types";

export function CreateCandidateForm({ candidates }: { candidates: Candidate[] }) {
  const [state, action] = useActionState(createCandidateAction, null as FormActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setName("");
      setSlug("");
      setSlugTouched(false);
    }
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-slate-500">
          Nombre
          <input
            name="name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => {
              const next = event.target.value;
              setName(next);
              if (!slugTouched) setSlug(slugifyName(next));
            }}
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
          />
        </label>
        <label className="text-xs text-slate-500">
          Slug
          <input
            name="slug"
            required
            maxLength={60}
            value={slug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
            pattern="^[a-z0-9]+(-[a-z0-9]+)*$"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm text-slate-800"
          />
        </label>
        <label className="text-xs text-slate-500">
          País
          <select
            name="country"
            defaultValue="AR"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
          >
            <option value="AR">{COUNTRY_LABEL.AR}</option>
            <option value="ES">{COUNTRY_LABEL.ES}</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Modo
          <select
            name="collection_mode"
            defaultValue="full"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
          >
            <option value="full">{COLLECTION_MODE_LABEL.full}</option>
            <option value="media_only">{COLLECTION_MODE_LABEL.media_only}</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Cargo
          <input
            name="office"
            maxLength={160}
            placeholder="Opcional"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
          />
        </label>
        <label className="text-xs text-slate-500">
          Partido
          <input
            name="party"
            maxLength={160}
            placeholder="Opcional"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
          />
        </label>
      </div>
      <label className="block text-xs text-slate-500">
        Keywords
        <textarea
          name="keywords"
          rows={2}
          placeholder="Nombre completo, apellido, @cuenta. Separadas por coma."
          className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
        />
      </label>
      <label className="block text-xs text-slate-500">
        Exclusiones
        <textarea
          name="exclude_keywords"
          rows={2}
          placeholder="Términos a dejar afuera, separados por coma. Opcional."
          className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-slate-500">
          Cuenta X
          <input
            name="x_handle"
            maxLength={80}
            placeholder="@cuenta"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
          />
        </label>
        <label className="text-xs text-slate-500">
          Artículo Wikipedia
          <input
            name="wikipedia_article"
            maxLength={200}
            placeholder="Título o URL en es.wikipedia"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
          />
        </label>
        <label className="text-xs text-slate-500">
          Rival opcional
          <select
            name="rival_candidate_id"
            defaultValue=""
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
          >
            <option value="">Ninguno</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Nivel del rival
          <select
            name="rival_level"
            defaultValue="comparativo"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
          >
            {RIVAL_LEVELS.map((level) => (
              <option key={level} value={level}>
                {RIVAL_LEVEL_LABEL[level]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Tope diario En la IA (USD)
          <input
            name="daily_budget_usd"
            defaultValue="1,00"
            inputMode="decimal"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
          />
        </label>
        <label className="flex items-end gap-2 text-sm text-slate-700">
          <input type="checkbox" name="enable_ai_visibility" value="true" className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
          Activar En la IA (queda apagada si no se marca)
        </label>
      </div>
      <ActionSubmitButton
        pendingLabel="Creando…"
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        Dar de alta
      </ActionSubmitButton>
      {state?.ok ? <p className="text-sm font-medium text-emerald-800">{state.message}</p> : null}
      {state && !state.ok ? <p className="text-sm font-medium text-amber-800">{state.error}</p> : null}
    </form>
  );
}
