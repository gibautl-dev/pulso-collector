import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmClient } from "@/lib/assistant/llm";
import { compatBody, postChatCompletion, providerErrorSummary, stripSchemaBounds } from "@/lib/llm-compat";
import { TOOL_SCHEMAS } from "@/lib/assistant/prompt";

afterEach(() => vi.restoreAllMocks());

describe("llm-compat", () => {
  it("saca rangos de los esquemas pero no campos que se llamen igual", () => {
    const s = stripSchemaBounds({
      type: "object",
      properties: { format: { type: "string", maxLength: 3 }, n: { type: "integer", minimum: 1, maximum: 5 }, l: { type: "array", maxItems: 2, items: { type: "string" } } },
    });
    expect(s).toEqual({ type: "object", properties: { format: { type: "string" }, n: { type: "integer" }, l: { type: "array", items: { type: "string" } } } });
  });

  it("el cuerpo compatible quita parallel_tool_calls y conserva lo demás", () => {
    const body = compatBody({ model: "m", parallel_tool_calls: true, tools: TOOL_SCHEMAS, tool_choice: "auto", reasoning_effort: "low" }, null);
    expect(body.parallel_tool_calls).toBeUndefined();
    expect(body.tool_choice).toBe("auto");
    expect(body.reasoning_effort).toBe("low");
    expect(JSON.stringify(body.tools)).not.toMatch(/"minimum"|"maximum"|"maxItems"/);
    expect((body.tools as unknown[]).length).toBe(TOOL_SCHEMAS.length);
    expect(compatBody({ reasoning_effort: "low" }, "reasoning_effort").reasoning_effort).toBe("none");
  });

  it("resume el error del proveedor sin claves", () => {
    const r = providerErrorSummary(JSON.stringify({ error: { message: "bad key sk-abcdefghijklmnop Bearer xyz", param: "tools[0]", code: "invalid_value" } }));
    expect(r.param).toBe("tools[0]");
    expect(r.message).toContain("invalid_value | tools[0]");
    expect(r.message).not.toContain("sk-abcdefghijklmnop");
    expect(r.message).not.toContain("xyz");
  });

  it("ante un 400 reintenta una vez con el cuerpo compatible", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)));
      return bodies.length === 1
        ? new Response(JSON.stringify({ error: { message: "nope", param: "parallel_tool_calls" } }), { status: 400 })
        : new Response(JSON.stringify({ choices: [] }), { status: 200 });
    });
    const res = await postChatCompletion({ base: "https://x", key: "k", body: { model: "m", parallel_tool_calls: true }, timeoutMs: 1000, label: "t" });
    expect(res.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].parallel_tool_calls).toBeUndefined();
  });

  it("no reintenta otros errores", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    const res = await postChatCompletion({ base: "https://x", key: "k", body: {}, timeoutMs: 1000, label: "t" });
    expect(res.status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("si el 400 es por reasoning_effort, el reintento lo manda en none", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)));
      return bodies.length === 1
        ? new Response(JSON.stringify({ error: { message: "unsupported", param: "reasoning_effort" } }), { status: 400 })
        : new Response(JSON.stringify({ choices: [] }), { status: 200 });
    });
    const res = await postChatCompletion({
      base: "https://x",
      key: "k",
      body: { model: "m", tools: [{ type: "function" }], reasoning_effort: "low" },
      timeoutMs: 1000,
      label: "t",
    });
    expect(res.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].reasoning_effort).toBe("low");
    expect(bodies[1].reasoning_effort).toBe("none");
  });

  it("createLlmClient manda reasoning_effort none cuando hay tools", async () => {
    const prev = process.env.LLM_API_KEY;
    process.env.LLM_API_KEY = "test-key";
    const bodies: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), { status: 200 });
    });
    try {
      const client = createLlmClient();
      await client.chat({
        messages: [{ role: "user", content: "hola" }],
        tools: [{ type: "function", function: { name: "x" } }],
        tool_choice: "auto",
        max_completion_tokens: 16,
      });
      expect(bodies).toHaveLength(1);
      expect(bodies[0].reasoning_effort).toBe("none");
      expect(bodies[0].tools).toHaveLength(1);

      bodies.length = 0;
      await client.chat({
        messages: [{ role: "user", content: "hola" }],
        max_completion_tokens: 16,
      });
      expect(bodies).toHaveLength(1);
      expect(bodies[0].reasoning_effort).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.LLM_API_KEY;
      else process.env.LLM_API_KEY = prev;
    }
  });
});
