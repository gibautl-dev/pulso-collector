import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { messageFromAuthError } from "@/lib/auth-callback";
import { createClient } from "@/lib/supabase/server";

const ALLOWED: EmailOtpType[] = ["email", "magiclink", "invite"];

function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(/:$/, "") ??
    "https";
  return host ? `${proto}://${host}` : request.nextUrl.origin;
}

function loginUrl(origin: string, error?: "link" | "auth"): URL {
  const url = new URL("/login", origin);
  if (error) url.searchParams.set("error", error);
  return url;
}

/**
 * Canjea el retorno del email por una sesión.
 *
 * - Magic link con @supabase/ssr (PKCE): ?code= → exchangeCodeForSession.
 * - Plantillas token_hash (SMTP propio): ?token_hash=&type= → verifyOtp.
 * - Invitaciones del panel (flujo implícito): tokens en el #hash, que este
 *   handler no ve. Si no hay query, redirigimos a /login *sin* error para
 *   que el cliente lea el hash (el browser conserva el fragmento).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = requestOrigin(request);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const authError = searchParams.get("error") ?? searchParams.get("error_code");
  const description = searchParams.get("error_description");

  if (authError || description) {
    const expired = messageFromAuthError(authError, description).includes("venció");
    return NextResponse.redirect(loginUrl(origin, expired ? "link" : "auth"));
  }

  if (!tokenHash && !code) {
    // Posible retorno implícito con tokens en el hash (Site URL o redirect_to).
    return NextResponse.redirect(loginUrl(origin));
  }

  const supabase = await createClient();
  let ok = false;
  try {
    if (tokenHash && type && ALLOWED.includes(type)) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      ok = !error;
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      ok = !error;
    }
  } catch {
    ok = false;
  }
  // Nunca redirigimos a una URL que venga en el link (evita open redirect).
  return NextResponse.redirect(ok ? new URL("/", origin) : loginUrl(origin, "link"));
}
