import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (process.env.PULSO_DATA_SOURCE === "fixture") {
    // Modo fixture local: sin Supabase. Solo se atiende localhost.
    const host = request.headers.get("host") ?? "";
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || process.env.RENDER) {
      return new NextResponse("Modo fixture solo disponible en localhost", { status: 403 });
    }
    return NextResponse.next();
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
