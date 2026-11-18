import { describe, expect, it } from "vitest";
import { MemoryRepo } from "@/lib/data/memory";
import { suspiciousAccountLabel, suspiciousSignalLabel } from "@/lib/labels";
import {
  isSuspiciousPlatform,
  isSuspiciousStatus,
  type SuspiciousAccount,
} from "@/lib/types";

function account(over: Partial<SuspiciousAccount> = {}): SuspiciousAccount {
  return {
    id: over.id ?? "aaaaaaaa-0000-4000-8000-000000000001",
    candidate_id: "c1",
    platform: "x",
    account_key: "merirousherrera",
    handle: "merirousherrera",
    display_name: "ROUSMERI",
    profile_url: "https://x.com/merirousherrera",
    score: 25,
    signals: [
      {
        type: "follow_ratio",
        weight: 15,
        summary: "1565 seguidos y 63 seguidores",
        evidence: [
          {
            mention_id: "m1",
            url: "https://x.com/merirousherrera/status/1",
            published_at: "2026-11-18T14:20:00+00:00",
            excerpt: "Texto de ejemplo",
          },
        ],
      },
    ],
    mention_count: 1,
    first_seen_at: "2026-11-18T14:20:00+00:00",
    last_seen_at: "2026-11-18T14:20:00+00:00",
    account_created_at: "2023-06-09T02:00:58+00:00",
    status: "pending",
    status_note: null,
    status_updated_at: null,
    detected_at: "2026-11-18T15:54:34+00:00",
    ...over,
  };
}

const repo = new MemoryRepo({
  candidate: { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" },
  topics: [],
  mentions: [],
  source_runs: [
    {
      id: "r1",
      candidate_id: "c1",
      source: "x",
      run_kind: "manual",
      started_at: "2026-11-18T15:51:49+00:00",
      finished_at: "2026-11-18T15:54:14+00:00",
      status: "ok",
      items_found: 25,
      items_new: 0,
      error: null,
    },
  ],
  candidate_sources: [],
  suspicious_accounts: [
    account(),
    account({
      id: "bbbbbbbb-0000-4000-8000-000000000002",
      platform: "youtube",
      account_key: "UCBAZ7ieQgUszY2xgFJA4x2Q",
      handle: "UCBAZ7ieQgUszY2xgFJA4x2Q",
      display_name: "@sarapera9140",
      profile_url: "https://www.youtube.com/@sarapera9140",
      score: 10,
      status: "discarded",
      signals: [{ type: "digit_name", weight: 10, summary: "4 dígitos", evidence: [] }],
    }),
    account({
      id: "cccccccc-0000-4000-8000-000000000003",
      candidate_id: "c2",
      handle: "otra",
      account_key: "otra",
    }),
  ],
});

describe("etiquetas de cuentas sospechosas", () => {
  it("valida estados y plataformas", () => {
    expect(isSuspiciousStatus("pending")).toBe(true);
    expect(isSuspiciousStatus("denunciada")).toBe(false);
    expect(isSuspiciousPlatform("x")).toBe(true);
    expect(isSuspiciousPlatform("rss_media")).toBe(false);
  });
  it("usa el @ visible en YouTube y no el channel id", () => {
    expect(suspiciousAccountLabel(account({ platform: "youtube", handle: "UCabc", display_name: "@sarapera9140", account_key: "UCabc" }))).toBe("@sarapera9140");
    expect(suspiciousAccountLabel(account())).toBe("@merirousherrera");
    expect(suspiciousSignalLabel("follow_ratio")).toBe("Relación de seguidos");
  });
});

describe("MemoryRepo cuentas sospechosas", () => {
  it("lista por candidato, ordena por puntaje y no mezcla campañas", async () => {
    const rows = await repo.listSuspiciousAccounts("c1");
    expect(rows.map((a) => a.handle)).toEqual(["merirousherrera", "UCBAZ7ieQgUszY2xgFJA4x2Q"]);
    expect(rows.every((a) => a.candidate_id === "c1")).toBe(true);
  });
  it("filtra por estado y plataforma", async () => {
    const discarded = await repo.listSuspiciousAccounts("c1", { status: "discarded" });
    expect(discarded).toHaveLength(1);
    expect(discarded[0].display_name).toBe("@sarapera9140");
    const youtube = await repo.listSuspiciousAccounts("c1", { platform: "youtube" });
    expect(youtube).toHaveLength(1);
  });
  it("actualiza el estado de una sola cuenta", async () => {
    await repo.updateSuspiciousStatus("c1", "aaaaaaaa-0000-4000-8000-000000000001", "reported_manual", "Denuncié a mano en X");
    const rows = await repo.listSuspiciousAccounts("c1", { status: "reported_manual" });
    expect(rows).toHaveLength(1);
    expect(rows[0].status_note).toBe("Denuncié a mano en X");
    expect(rows[0].status_updated_at).toBeTruthy();
  });
});
