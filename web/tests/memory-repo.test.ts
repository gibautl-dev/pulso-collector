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
