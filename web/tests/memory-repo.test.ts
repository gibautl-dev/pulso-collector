import { describe, expect, it } from "vitest";
import { MemoryRepo } from "@/lib/data/memory";
import { parseFilters } from "@/lib/filters";
import { mention } from "./helpers";

const repo = new MemoryRepo({
  candidate: { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" },
  topics: [],
  mentions: [
    ...Array.from({ length: 30 }, () => mention()),
    mention({ candidate_id: "c2", title: "otro candidato" }),
  ],
  source_runs: [],
  candidate_sources: [],
});

describe("MemoryRepo", () => {
  it("pagina y no mezcla candidatos", async () => {
    const p1 = await repo.searchMentions("c1", parseFilters({}), 25);
    const p2 = await repo.searchMentions("c1", parseFilters({ page: "2" }), 25);
    expect(p1.total).toBe(30);
    expect(p1.items).toHaveLength(25);
    expect(p2.items).toHaveLength(5);
    expect([...p1.items, ...p2.items].every((m) => m.candidate_id === "c1")).toBe(true);
  });
  it("busca por slug", async () => {
    expect(await repo.getCandidate("axel-kicillof")).not.toBeNull();
    expect(await repo.getCandidate("otro")).toBeNull();
  });
});

describe("MemoryRepo con varios candidatos", () => {
  const multi = new MemoryRepo({
    candidate: { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" },
    candidates: [
      { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" },
      { id: "c2", slug: "pedro-sanchez", name: "Pedro Sánchez" },
    ],
    topics: [],
    mentions: [],
    source_runs: [],
    candidate_sources: [],
  });

  it("lista por nombre y encuentra a ambos", async () => {
    const list = await multi.listCandidates();
    expect(list.map((c) => c.slug)).toEqual(["axel-kicillof", "pedro-sanchez"]);
    expect(await multi.getCandidate("pedro-sanchez")).toMatchObject({ slug: "pedro-sanchez" });
    expect(await multi.getCandidate("inexistente")).toBeNull();
  });
});

describe("MemoryRepo Acción", () => {
  const crisis = new MemoryRepo({
    candidate: { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" },
    topics: [],
    mentions: [],
    source_runs: [],
    candidate_sources: [],
    crisis_alerts: [
      {
        id: "a1",
        candidate_id: "c1",
        trigger_type: "rising_topic",
        trigger_key: "rising_topic:demo",
        cluster_label: "Control laboral",
        window_start: "2026-11-22T00:00:00-03:00",
        window_end: "2026-11-24T12:00:00-03:00",
        severity: "medio_alto",
        metrics: { media_count: 4 },
        status: "new",
        status_note: null,
        status_updated_at: null,
        first_detected_at: "2026-11-24T10:00:00-03:00",
        last_detected_at: "2026-11-24T10:00:00-03:00",
      },
    ],
    crisis_briefs: [
      {
        id: "b1",
        alert_id: "a1",
        candidate_id: "c1",
        prompt_version: "crisis-v1",
        model: "gpt-6-luna",
        risk_level: "medio_alto",
        title: "La Sociedad Rural",
        input_ref: {},
        output: { title: "La Sociedad Rural", summary: "Un tema emergente." },
        cost_usd: 0.002,
        created_at: "2026-11-24T10:05:00-03:00",
      },
    ],
  });

  it("lista la alerta con el último brief y solo deja cambiar el estado", async () => {
    const rows = await crisis.listCrisisAlerts("c1");
    expect(rows).toHaveLength(1);
    expect(rows[0].latest_brief?.title).toBe("La Sociedad Rural");
    await crisis.updateCrisisAlertStatus("c1", "a1", "approved", "vamos");
    const again = await crisis.getCrisisAlert("c1", "a1");
    expect(again?.status).toBe("approved");
    expect(again?.status_note).toBe("vamos");
    expect(again?.cluster_label).toBe("Control laboral");
  });
});

describe("MemoryRepo rivales", () => {
  const rivals = new MemoryRepo({
    candidate: { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" },
    candidates: [
      { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" },
      { id: "c2", slug: "pedro-sanchez", name: "Pedro Sánchez" },
    ],
    topics: [],
    mentions: [],
    source_runs: [],
    candidate_sources: [],
    staff: true,
    candidate_rivals: [{ candidate_id: "c1", rival_id: "c2", level: "radar" }],
  });

  it("lista rivales del candidato y deja asignar desde el panel", async () => {
    expect(await rivals.isStaff()).toBe(true);
    expect(await rivals.getCandidateById("c2")).toMatchObject({ slug: "pedro-sanchez" });
    expect((await rivals.listRivals("c1"))[0].level).toBe("radar");
    await rivals.replaceRivals("c1", [{ rival_id: "c2", level: "completo" }]);
    expect((await rivals.listRivals("c1"))[0].level).toBe("completo");
    expect(await rivals.listRivals("c2")).toEqual([]);
  });

  it("no deja que un candidato sea rival de sí mismo", async () => {
    await expect(rivals.replaceRivals("c1", [{ rival_id: "c1", level: "radar" }])).rejects.toThrow();
  });
});

describe("MemoryRepo sin staff", () => {
  const plain = new MemoryRepo({
    candidate: { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" },
    topics: [],
    mentions: [],
    source_runs: [],
    candidate_sources: [],
  });
  it("no se presenta como equipo de Active", async () => {
    expect(await plain.isStaff()).toBe(false);
  });
});

describe("MemoryRepo sugerencias y altas pendientes", () => {
  const repo = new MemoryRepo({
    candidate: { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" },
    candidates: [
      { id: "c1", slug: "axel-kicillof", name: "Axel Kicillof" },
      { id: "c2", slug: "pedro-sanchez", name: "Pedro Sánchez" },
    ],
    topics: [],
    mentions: [],
    source_runs: [],
    candidate_sources: [],
    staff: true,
    recorded_daily_costs: [{ candidate_id: "c1", source: "ia", date: "2026-11-18", cost_usd: 0.8 }],
  });

  it("guarda una corrida y un pendiente, y rechaza un nombre que ya se mide", async () => {
    expect((await repo.listRecordedDailyCosts())[0].cost_usd).toBe(0.8);
    const run = await repo.saveSuggestionRun({
      candidate_id: "c1",
      prompt_version: "test",
      model: "gpt-6-luna",
      suggestions: [],
      cost_usd: 0.001,
      origin: "ai",
    });
    expect((await repo.latestSuggestionRun("c1"))?.id).toBe(run.id);
    const pending = await repo.addPendingCandidate({
      name: "Néstor Grindetti",
      requested_for_candidate_id: "c1",
      requested_level: "radar",
      source: "manual",
    });
    expect(pending.status).toBe("pendiente_de_alta");
    expect((await repo.listPendingCandidates("c1"))[0].name).toBe("Néstor Grindetti");
    await expect(
      repo.addPendingCandidate({
        name: "Pedro Sánchez",
        requested_for_candidate_id: "c1",
        requested_level: "comparativo",
        source: "manual",
      }),
    ).rejects.toThrow(/ya está en Pulso/);
  });

  it("rechaza un duplicado sin importar tildes y permite aprobar o borrar", async () => {
    await repo.addPendingCandidate({
      name: "Milei",
      requested_for_candidate_id: "c1",
      requested_level: "comparativo",
      source: "manual",
    });
    await expect(
      repo.addPendingCandidate({
        name: "mileí",
        requested_for_candidate_id: "c1",
        requested_level: "comparativo",
        source: "manual",
      }),
    ).rejects.toThrow(/Ya hay un pedido de alta para mileí/);
    const row = (await repo.listPendingCandidates("c1")).find((p) => p.name === "Milei");
    expect(row).toBeTruthy();
    const approved = await repo.approvePendingCandidate(row!.id, "staff");
    expect(approved.status).toBe("aprobado");
    expect(approved.approved_by).toBe("staff");
    expect(approved.approved_at).toBeTruthy();
    await expect(
      repo.addPendingCandidate({
        name: "Milei",
        requested_for_candidate_id: "c1",
        requested_level: "radar",
        source: "manual",
      }),
    ).rejects.toThrow(/Ya hay un pedido/);
    await repo.deletePendingCandidate(row!.id);
    expect((await repo.listPendingCandidates("c1")).some((p) => p.name === "Milei")).toBe(false);
    const again = await repo.addPendingCandidate({
      name: "Milei",
      requested_for_candidate_id: "c1",
      requested_level: "radar",
      source: "manual",
    });
    expect(again.status).toBe("pendiente_de_alta");
  });
});
