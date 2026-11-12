/**
 * Parseo de parámetros de retorno de Supabase Auth (query o #hash).
 * Las invitaciones del panel usan el flujo implícito y traen los tokens
 * en el hash; los errores también pueden llegar ahí o en la query.
 */

export type AuthCallbackResult =
  | { kind: "session"; accessToken: string; refreshToken: string }
  | { kind: "error"; message: string }
  | { kind: "empty" };

const EXPIRED =
  "El link venció o ya se usó. Pedí uno nuevo o una invitación nueva.";
const GENERIC = "No se pudo completar el ingreso. Pedí un link nuevo.";
const SERVER = "Hubo un problema al ingresar. Probá de nuevo en unos minutos.";

/** Mensaje en español a partir de error / error_description de Supabase. */
export function messageFromAuthError(
  error: string | null,
  description: string | null,
): string {
  const haystack = `${error ?? ""} ${description ?? ""}`.toLowerCase().replace(/\+/g, " ");
  if (
    /expired|invalid|already been used|otp_expired|flow_state.*not found|404/.test(
      haystack,
    )
  ) {
    return EXPIRED;
  }
  if (/rate.?limit|over_email_send_rate|429/.test(haystack)) {
    return "Pediste demasiados links seguidos. Esperá un minuto y probá de nuevo.";
  }
  if (/server_error|internal_error|5\d\d/.test(haystack)) {
    return SERVER;
  }
  if (error || description) return GENERIC;
  return GENERIC;
}

function fromParams(params: URLSearchParams): AuthCallbackResult {
  const error = params.get("error") ?? params.get("error_code");
  const description = params.get("error_description");
  if (error || description) {
    return { kind: "error", message: messageFromAuthError(error, description) };
  }
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) {
    return { kind: "session", accessToken, refreshToken };
  }
  if (accessToken || refreshToken || params.get("type") || params.get("token_type")) {
    return { kind: "error", message: EXPIRED };
  }
  return { kind: "empty" };
}

/** Lee el fragmento (#access_token=… o #error=…). */
export function parseAuthHash(hash: string): AuthCallbackResult {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.trim()) return { kind: "empty" };
  return fromParams(new URLSearchParams(raw));
}

/** Lee query (?error=… o ?code= roto ya se maneja en el route handler). */
export function parseAuthQuery(search: string): AuthCallbackResult {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw.trim()) return { kind: "empty" };
  const params = new URLSearchParams(raw);
  const error = params.get("error") ?? params.get("error_code");
  const description = params.get("error_description");
  if (error || description) {
    return { kind: "error", message: messageFromAuthError(error, description) };
  }
  return { kind: "empty" };
}

export const AUTH_ERROR_MESSAGES = { EXPIRED, GENERIC, SERVER } as const;
