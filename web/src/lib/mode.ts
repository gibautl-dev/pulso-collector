import "server-only";

/**
 * Modo fixture: SOLO para desarrollo local en la computadora de trabajo.
 * Lee un JSON exportado de Supabase (fuera del repo) y saltea el login.
 * Se niega a activarse si detecta un entorno de hosting conocido, para que
 * una variable mal puesta en producción nunca deje la app abierta.
 */
export function isFixtureMode(): boolean {
  if (process.env.PULSO_DATA_SOURCE !== "fixture") return false;
  const hosted = ["RENDER", "VERCEL", "NETLIFY", "FLY_APP_NAME", "RAILWAY_ENVIRONMENT"].some(
    (k) => process.env[k],
  );
  if (hosted) {
    throw new Error("PULSO_DATA_SOURCE=fixture no está permitido en un entorno de hosting.");
  }
  if (!process.env.PULSO_FIXTURE_PATH) {
    throw new Error("Falta PULSO_FIXTURE_PATH para el modo fixture.");
  }
  return true;
}

export function supabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }
  if (/service_role|sb_secret_/.test(key)) {
    // Defensa extra: nunca aceptar una clave privilegiada en el front.
    throw new Error("La clave configurada no es publishable. Nunca uses la service role en la app.");
  }
  return { url, key };
}
