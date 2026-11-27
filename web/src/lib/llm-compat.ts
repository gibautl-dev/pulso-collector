import "server-only";

/**
 * Llamada a /chat/completions con un reintento compatible.
 * Si el proveedor rechaza el pedido (HTTP 400), se anota su mensaje (sin clave)
 * y se reintenta una vez sin los parámetros opcionales que algunos modelos no
 * aceptan: parallel_tool_calls y los rangos de los esquemas (minimum, maxItems…).
 * Los rangos igual se validan en código, así que el resultado es el mismo.
 */

const BOUND_KEYS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
  "format",
]);

export function stripSchemaBounds<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripSchemaBounds(v)) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // "properties" lista nombres de campos: un campo podría llamarse "format".
    if (BOUND_KEYS.has(k) && typeof v !== "object") continue;
    out[k] = stripSchemaBounds(v);
  }
  return out as T;
}

export function compatBody(body: Record<string, unknown>, param: string | null): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body };
  delete next.parallel_tool_calls;
  if (param === "reasoning_effort") next.reasoning_effort = "none";
  if (Array.isArray(next.tools)) next.tools = stripSchemaBounds(next.tools);
  if (next.response_format) next.response_format = stripSchemaBounds(next.response_format);
  return next;
}

/** Mensaje del proveedor, recortado y sin nada que parezca una clave. */
export function providerErrorSummary(text: string): { message: string; param: string | null } {
  let message = text;
  let param: string | null = null;
  try {
    const j = JSON.parse(text) as { error?: { message?: unknown; param?: unknown; code?: unknown } };
    if (j?.error) {
      message = [j.error.code, j.error.param, j.error.message].filter((x) => x != null && x !== "").map(String).join(" | ");
      param = typeof j.error.param === "string" ? j.error.param : null;
    }
  } catch {
    // texto plano
  }
  message = message
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/\b(sk|xai|key)-[A-Za-z0-9_\-]{6,}/g, "***")
    .replace(/\s+/g, " ")
    .slice(0, 300);
  return { message, param };
}

export async function postChatCompletion(opts: {
  base: string;
  key: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  label: string;
}): Promise<Response> {
  const send = async (body: Record<string, unknown>) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      return await fetch(`${opts.base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  const first = await send(opts.body);
  if (first.ok || first.status !== 400) return first;
  const { message, param } = providerErrorSummary(await first.text().catch(() => ""));
  console.error(`${opts.label} provider 400: ${message}`);
  const retry = await send(compatBody(opts.body, param));
  if (retry.ok) {
    console.error(`${opts.label} compat retry ok`);
  } else {
    const again = providerErrorSummary(await retry.clone().text().catch(() => ""));
    console.error(`${opts.label} compat retry ${retry.status}: ${again.message}`);
  }
  return retry;
}
