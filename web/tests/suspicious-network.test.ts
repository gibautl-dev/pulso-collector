import { describe, expect, it } from "vitest";
import { buildSuspiciousNetwork } from "@/lib/suspicious-network";
import type { SuspiciousAccount } from "@/lib/types";
import { mention } from "./helpers";

function account(over: Partial<SuspiciousAccount> = {}): SuspiciousAccount {
  return {
    id: "a1",
    candidate_id: "c1",
    platform: "x",
    account_key: "alpha",
    handle: "alpha",
    display_name: "Alpha",
    profile_url: null,
    score: 40,
    signals: [],
    mention_count: 3,
    first_seen_at: null,
    last_seen_at: null,
    account_created_at: null,
    status: "pending",
    status_note: null,
    status_updated_at: null,
    detected_at: "2026-11-25T10:00:00Z",
    ...over,
  };
}

describe("buildSuspiciousNetwork", () => {
  it("une cuentas que comparten fingerprint de coordinación", () => {
    const ev = { mention_id: "m1", url: "https://x.com/1", published_at: "2026-11-24T12:00:00Z", excerpt: "mismo texto", fingerprint: "abc123" };
    const net = buildSuspiciousNetwork(
      "Axel Kicillof",
      [
        account({ id: "a1", handle: "alpha", account_key: "alpha", signals: [{ type: "coordination", weight: 25, summary: "2 cuentas", evidence: [ev] }] }),
        account({ id: "a2", handle: "beta", account_key: "beta", signals: [{ type: "coordination", weight: 25, summary: "2 cuentas", evidence: [ev] }] }),
      ],
      [],
    );
    expect(net.accountEdges).toBe(1);
    expect(net.clusters[0]?.size).toBe(2);
    expect(net.edges.some((e) => e.reason === "coordination")).toBe(true);
    expect(net.flaggedCount).toBe(2);
    expect(net.pendingReview).toBe(2);
  });

  it("no inventa aristas entre cuentas si no hay evidencia compartida", () => {
    const net = buildSuspiciousNetwork(
      "Pedro Sánchez",
      [
        account({ id: "a1", handle: "uno", account_key: "uno", signals: [{ type: "digit_name", weight: 10, summary: "dígitos", evidence: [] }] }),
        account({ id: "a2", handle: "dos", account_key: "dos", signals: [{ type: "new_account", weight: 15, summary: "nueva", evidence: [] }] }),
      ],
      [mention({ source: "x", author_handle: "otro", author: "Otro" })],
    );
    expect(net.accountEdges).toBe(0);
    expect(net.gap).toMatch(/no se inventan aristas/i);
    expect(net.nodes.some((n) => n.kind === "candidate")).toBe(true);
  });
});
