"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Cliente Supabase en el browser (setSession del flujo implícito). */
export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }
  if (/service_role|sb_secret_/.test(key)) {
    throw new Error("La clave configurada no es publishable. Nunca uses la service role en la app.");
  }
  return createBrowserClient(url, key);
}
