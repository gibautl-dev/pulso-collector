import { NextResponse, type NextRequest } from "next/server";
import {
  LAST_CANDIDATE_COOKIE,
  lastCandidateCookieOptions,
  parseCandidatePath,
} from "@/lib/candidate-nav";
import { updateSession } from "@/lib/supabase/proxy";

function rememberCandidate(request: NextRequest, response: NextResponse): NextResponse {
  const parsed = parseCandidatePath(request.nextUrl.pathname);
  if (!parsed) return response;
  response.cookies.set(
    LAST_CANDIDATE_COOKIE,
    parsed.slug,
    lastCandidateCookieOptions(process.env.NODE_ENV === "production"),
  );
  return response;
}

export async function proxy(request: NextRequest) {
  if (process.env.PULSO_DATA_SOURCE === "fixture") {
    // Modo fixture local: sin Supabase. Solo se atiende localhost.
    const host = request.headers.get("host") ?? "";
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || process.env.RENDER) {
      return new NextResponse("Modo fixture solo disponible en localhost", { status: 403 });
    }
    return rememberCandidate(request, NextResponse.next());
  }
  return rememberCandidate(request, await updateSession(request));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
