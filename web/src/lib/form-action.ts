/** Resultado de un server action pensado para useActionState (sin crash en la UI). */
export type FormActionState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null;

export const LLM_NOT_CONFIGURED_MESSAGE =
  "La IA no está configurada en el servidor todavía";

export function isMissingLlmKeyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /LLM_API_KEY|OPENAI_API_KEY|Falta la clave|no está configurada/i.test(msg);
}

export function llmActionError(err: unknown): FormActionState {
  if (isMissingLlmKeyError(err)) {
    return { ok: false, error: LLM_NOT_CONFIGURED_MESSAGE };
  }
  return { ok: false, error: "No se pudo completar el pedido. Probá de nuevo o avisá al equipo técnico." };
}
