"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { parseAuthHash, type AuthCallbackResult } from "@/lib/auth-callback";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const SET_SESSION_ERROR =
  "El link venció o ya se usó. Pedí uno nuevo o una invitación nueva.";

function subscribeHash(onStoreChange: () => void) {
  window.addEventListener("hashchange", onStoreChange);
  return () => window.removeEventListener("hashchange", onStoreChange);
}

/**
 * Cubre el retorno de invitaciones (flujo implícito): los tokens o el error
 * llegan en el #hash, que el servidor no ve. Puede aterrizar en / (Site URL,
 * el proxy manda a /login y el browser conserva el hash) o en /auth/confirm
 * (redirect_to), que redirige acá sin pisar el fragmento.
 */
export function AuthHashHandler({
  children,
  serverError,
}: {
  children: ReactNode;
  serverError?: string;
}) {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const fromHash = parseAuthHash(hash);
  const [captured, setCaptured] = useState<AuthCallbackResult>({ kind: "empty" });
  if (fromHash.kind !== "empty" && captured.kind === "empty") {
    setCaptured(fromHash);
  }
  const result = fromHash.kind !== "empty" ? fromHash : captured;

  const [sessionOutcome, setSessionOutcome] = useState<"pending" | "error">("pending");
  const busy = result.kind === "session" && sessionOutcome === "pending";
  const message =
    result.kind === "error"
      ? result.message
      : sessionOutcome === "error"
        ? SET_SESSION_ERROR
        : null;

  useEffect(() => {
    // Solo sacar el hash después de haberlo guardado en estado. Si lo
    // hacemos en el primer effect (aún con el snapshot del servidor),
    // el cliente pierde los tokens/errores antes de poder leerlos.
    if (captured.kind === "empty" || !window.location.hash) return;
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [captured]);

  const started = useRef(false);
  useEffect(() => {
    if (result.kind !== "session" || started.current) return;
    started.current = true;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserSupabase();
        const { error } = await supabase.auth.setSession({
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
        });
        if (cancelled) return;
        if (error) {
          setSessionOutcome("error");
          return;
        }
        window.location.replace("/");
      } catch {
        if (!cancelled) setSessionOutcome("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [result]);

  if (busy) {
    return (
      <div className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-700" role="status">
        Estamos ingresándote…
      </div>
    );
  }

  const alert = message ?? serverError;
  return (
    <>
      {alert && (
        <p className="mt-6 text-sm text-rose-600" role="alert">
          {alert}
        </p>
      )}
      {children}
    </>
  );
}
