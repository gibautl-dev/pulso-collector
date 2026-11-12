import { describe, expect, it } from "vitest";
import {
  AUTH_ERROR_MESSAGES,
  messageFromAuthError,
  parseAuthHash,
  parseAuthQuery,
} from "@/lib/auth-callback";

describe("parseAuthHash", () => {
  it("está vacío si no hay fragmento", () => {
    expect(parseAuthHash("")).toEqual({ kind: "empty" });
    expect(parseAuthHash("#")).toEqual({ kind: "empty" });
  });

  it("lee access_token y refresh_token", () => {
    expect(parseAuthHash("#access_token=aaa&refresh_token=bbb&type=invite")).toEqual({
      kind: "session",
      accessToken: "aaa",
      refreshToken: "bbb",
    });
  });

  it("traduce un error de link vencido", () => {
    const r = parseAuthHash(
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(r).toEqual({ kind: "error", message: AUTH_ERROR_MESSAGES.EXPIRED });
  });

  it("usa un mensaje genérico si el error no es conocido", () => {
    const r = parseAuthHash("#error=access_denied&error_description=Something+else");
    expect(r).toEqual({ kind: "error", message: AUTH_ERROR_MESSAGES.GENERIC });
  });

  it("falla de forma controlada si faltan tokens", () => {
    expect(parseAuthHash("#access_token=solo&type=invite")).toEqual({
      kind: "error",
      message: AUTH_ERROR_MESSAGES.EXPIRED,
    });
  });
});

describe("parseAuthQuery", () => {
  it("ignora code y token_hash (los canjea el route handler)", () => {
    expect(parseAuthQuery("?code=abc")).toEqual({ kind: "empty" });
    expect(parseAuthQuery("token_hash=x&type=email")).toEqual({ kind: "empty" });
  });

  it("traduce errores de la query", () => {
    const r = parseAuthQuery("?error=server_error&error_description=Internal");
    expect(r).toEqual({ kind: "error", message: AUTH_ERROR_MESSAGES.SERVER });
  });
});

describe("messageFromAuthError", () => {
  it("detecta rate limit", () => {
    expect(messageFromAuthError("over_email_send_rate_limit", null)).toMatch(/demasiados links/);
  });
});
