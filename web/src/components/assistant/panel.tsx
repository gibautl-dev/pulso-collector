"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { askAssistantAction } from "@/app/c/[slug]/asistente/actions";
import { ASSISTANT_LABEL, parseAskHash, suggestedQuestions, type SuggestionInput } from "@/lib/assistant/suggestions";
import type { AssistantQuestion } from "@/lib/types";
import { AnswerView } from "./answer";

export interface PanelProps {
  slug: string;
  candidateName: string;
  initial: AssistantQuestion[];
  suggestionInput: Omit<SuggestionInput, "section">;
}

function Spark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      {/* Estrella de 4 puntas, como el ✦ del video demo. */}
      <path d="M12 2.5 13.85 10.15 21.5 12 13.85 13.85 12 21.5 10.15 13.85 2.5 12 10.15 10.15Z" />
    </svg>
  );
}

type AskFn = (question: string, ctx?: { card: string | null; info: string | null }) => void;

function sectionOf(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  return parts[2] ?? "tablero";
}

/** Conversación: historial, sugerencias y caja de pregunta. */
export function AssistantConversation({
  slug,
  candidateName,
  initial,
  suggestionInput,
  registerAsk,
  compact = false,
  visible = true,
}: PanelProps & { registerAsk?: (fn: AskFn) => void; compact?: boolean; visible?: boolean }) {
  const pathname = usePathname();
  const [items, setItems] = useState<AssistantQuestion[]>(initial);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) endRef.current?.scrollIntoView({ block: "end" });
  }, [items.length, waiting, visible]);

  const ask = useCallback(
    (question: string, ctx?: { card: string | null; info: string | null }) => {
      const q = question.trim();
      if (!q || waiting) return;
      setError(null);
      setWaiting(q);
      setDraft("");
      const history = items
        .filter((it) => it.answer && it.status !== "error")
        .slice(-2)
        .map((it) => ({ question: it.question, answer: it.answer!.text }));
      startTransition(async () => {
        try {
          const res = await askAssistantAction(slug, { question: q, history, page: sectionOf(pathname), card: ctx?.card ?? null, cardInfo: ctx?.info ?? null });
          if (res.ok) setItems((prev) => [...prev, res.item]);
          else setError(res.message);
        } catch {
          setError("No pude responder en este momento. Probá de nuevo en unos minutos.");
        } finally {
          setWaiting(null);
        }
      });
    },
    [items, pathname, slug, waiting],
  );

  useEffect(() => {
    registerAsk?.(ask);
  }, [ask, registerAsk]);

  const suggestions = suggestedQuestions({ ...suggestionInput, section: sectionOf(pathname) });
  const empty = items.length === 0 && !waiting;
  const last = items[items.length - 1];
  const followups = !waiting && last?.answer?.followups?.length ? last.answer.followups : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`min-h-0 flex-1 space-y-6 overflow-y-auto ${compact ? "px-5 py-5" : "px-1 py-2"}`}>
        {empty ? (
          <div className="pt-4">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm">
              <Spark className="h-5 w-5" />
            </div>
            <p className="mt-3 text-center text-sm font-semibold text-slate-900">Preguntá lo que quieras sobre {candidateName}</p>
            <p className="mx-auto mt-1 max-w-xs text-center text-xs leading-relaxed text-slate-500">
              Respondo con las menciones, temas, tono, resúmenes, anuncios y rivales que mide Pulso, y te muestro las fuentes.
            </p>
          </div>
        ) : null}
        {items.map((it) => (
          <div key={it.id} className="space-y-3" data-testid="assistant-turn">
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2 text-sm text-white shadow-sm">{it.question}</p>
            </div>
            <div className="flex gap-2.5">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
                <Spark className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                {it.answer ? (
                  <AnswerView answer={it.answer} slug={slug} anchor={`f-${it.id.slice(0, 8)}`} />
                ) : (
                  <p className="text-sm text-slate-500">No pude responder esta pregunta.</p>
                )}
              </div>
            </div>
          </div>
        ))}
        {waiting ? (
          <div className="space-y-3">
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2 text-sm text-white shadow-sm">{waiting}</p>
            </div>
            <div className="flex items-center gap-2.5 text-sm text-slate-500">
              <span className="inline-flex h-6 w-6 animate-pulse items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
                <Spark className="h-3.5 w-3.5" />
              </span>
              Revisando los datos…
            </div>
          </div>
        ) : null}
        {error ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">{error}</p> : null}
        <div ref={endRef} />
      </div>
      <div className={`border-t border-slate-100 bg-white ${compact ? "px-5 pb-5 pt-3" : "pt-3"}`}>
        {(empty ? suggestions : followups).length ? (
          <div className="mb-2.5 flex flex-wrap gap-1.5" data-testid="assistant-suggestions">
            {(empty ? suggestions : followups).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                disabled={!!waiting}
                className="rounded-full bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200 transition hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-200 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
          className="flex items-end gap-2 rounded-2xl bg-white p-1.5 ring-1 ring-inset ring-slate-300 focus-within:ring-2 focus-within:ring-indigo-500"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(draft);
              }
            }}
            rows={1}
            maxLength={400}
            placeholder="Preguntá sobre menciones, temas, tono, rivales…"
            aria-label="Tu pregunta"
            className="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || !!waiting}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400"
            aria-label="Preguntar"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
        <p className="mt-1.5 text-center text-[10px] text-slate-400">Responde solo con datos de Pulso y muestra de dónde sale cada dato.</p>
      </div>
    </div>
  );
}

/** Botón flotante + panel lateral. Se abre también desde los ⓘ (hash #preguntar=…). */
export function AssistantDrawer(props: PanelProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const askRef = useRef<AskFn | null>(null);
  const registerAsk = useCallback((fn: AskFn) => {
    askRef.current = fn;
  }, []);
  const onPage = pathname.endsWith("/asistente");

  useEffect(() => {
    // Habilita "Preguntale a Pulso sobre esto" en los ⓘ solo donde hay asistente.
    document.body.classList.add("pulso-assistant");
    return () => document.body.classList.remove("pulso-assistant");
  }, []);

  useEffect(() => {
    const read = () => {
      const parsed = parseAskHash(window.location.hash);
      if (!parsed) return;
      history.replaceState(null, "", window.location.pathname + window.location.search);
      setOpen(true);
      // Espera a que el panel esté visible y registrado.
      window.setTimeout(() => askRef.current?.(parsed.question, { card: parsed.card, info: parsed.info }), 0);
    };
    const first = window.setTimeout(read, 0);
    window.addEventListener("hashchange", read);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("hashchange", read);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {!open && !onPage ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="assistant-open"
          className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-40 inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full bg-gradient-to-r from-[#4f46e5] to-[#7c3aed] py-3 pl-[18px] pr-[22px] text-[15px] font-semibold text-white shadow-[0_12px_30px_rgba(79,70,229,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgba(79,70,229,0.5)] sm:right-[max(1.5rem,env(safe-area-inset-right))]"
        >
          <Spark className="h-4 w-4 shrink-0" />
          {ASSISTANT_LABEL}
        </button>
      ) : null}
      {/* Montado siempre: al cerrar y abrir se conserva la conversación. */}
      <div className={open ? "fixed inset-0 z-50 flex justify-end" : "hidden"} role="dialog" aria-modal="true" aria-label={ASSISTANT_LABEL} data-testid="assistant-drawer">
          <button type="button" className="absolute inset-0 bg-slate-900/20 backdrop-blur-[1px]" aria-label="Cerrar" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-full max-w-[460px] flex-col bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
                  <Spark />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{ASSISTANT_LABEL}</p>
                  <p className="text-xs text-slate-500">Datos de {props.candidateName}</p>
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Cerrar">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </header>
            <div className="min-h-0 flex-1">
              <AssistantConversation {...props} compact registerAsk={registerAsk} visible={open} />
            </div>
          </aside>
      </div>
    </>
  );
}
