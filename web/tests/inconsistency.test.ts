import { describe, expect, it } from "vitest";
import {
  coverageLine,
  daysLabel,
  normalizeAlerts,
  pieceDate,
  pieceText,
  pieceOutlet,
  shortOutlet,
  sideTitles,
  sortAlerts,
  summarize,
} from "@/lib/inconsistency";
import { MemoryRepo } from "@/lib/data/memory";
import { CANDIDATE_SECTIONS, sectionAvailable } from "@/lib/candidate-nav";
import type { InconsistencyAlert, InconsistencyPiece } from "@/lib/types";

const piece = (over: Partial<InconsistencyPiece> = {}): InconsistencyPiece => ({
  id: "m1",
  kind: "attributed",
  text: "Kicillof: \"No vamos a devolver nada\" - La Tecla",
  published_at: "2026-11-12T02:30:00Z",
  source: "google_news",
  outlet: "La Tecla",
  url: "https://latecla.info/1",
  ...over,
});

const alert = (over: Partial<InconsistencyAlert> = {}): InconsistencyAlert => ({
  id: "a1",
  candidate_id: "c1",
  alert_key: "k1",
  origin: "par",
  kind: "contradiccion",
  severity: "medio",
  topic_label: "Docentes",
  topic_id: null,
  earlier: piece({ id: "m0", published_at: "2026-11-01T12:00:00Z" }),
  later: piece(),
  days_between: 11,
  explanation: "E",
  next_step: "N",
  mention_ids: ["m0", "m1"],
  detected_at: "2026-11-12T12:00:00Z",
  status: "new",
  status_note: null,
  status_updated_at: null,
  ...over,
});

describe("inconsistency helpers", () => {
  it("ordena abiertas primero, después por severidad", () => {
    const list = sortAlerts([
      alert({ id: "bajo", severity: "bajo" }),
      alert({ id: "cerrada", severity: "alto", status: "discarded" }),
      alert({ id: "alto", severity: "alto" }),
      alert({ id: "medio", severity: "medio", status: "in_review" }),
    ]);
    expect(list.map((a) => a.id)).toEqual(["alto", "medio", "bajo", "cerrada"]);
    expect(summarize(list)).toEqual({ total: 4, open: 3, high: 1, medium: 1, reviewed: 1 });
  });

  it("descarta filas sin pieza nueva válida y anula una pieza vieja rota", () => {
    const rows = normalizeAlerts([
      alert({ id: "ok" }),
      alert({ id: "sin-url", later: piece({ url: "javascript:alert(1)" }) }),
      alert({ id: "tipo-raro", kind: "sin_contradiccion" as never }),
      alert({ id: "vieja-rota", earlier: piece({ text: "" }) }),
    ]);
    expect(rows.map((a) => a.id)).toEqual(["ok", "vieja-rota"]);
    expect(rows[1].earlier).toBeNull();
  });

  it("formatea fechas en la zona del candidato y limpia el medio del título", () => {
    expect(pieceDate(piece(), "America/Argentina/Buenos_Aires")).toBe("11 nov");
    expect(pieceDate(piece({ local_date: "2026-11-25" }), "UTC")).toBe("25 nov");
    expect(pieceText(piece())).toBe("Kicillof: \"No vamos a devolver nada\"");
    expect(shortOutlet("Infobae - Noticias")).toBe("Infobae");
    expect(pieceOutlet({ outlet: "España", url: "https://www.abc.es/espana/x" })).toBe("abc.es");
    expect(pieceOutlet({ outlet: "La Tecla Mar del Plata", url: "https://www.lateclamardelplata.com.ar/1" })).toBe("La Tecla Mar del Plata");
    expect(pieceOutlet({ outlet: "infocronos.com.ar", url: "https://infocronos.com.ar/nota/1" })).toBe("infocronos.com.ar");
    expect(pieceOutlet({ outlet: "Hispanidad", url: "https://www.hispanidad.com/p" })).toBe("Hispanidad");
    expect(daysLabel(1)).toBe("1 día después");
    expect(daysLabel(0)).toBe("el mismo día");
    expect(daysLabel(null)).toBeNull();
  });

  it("titula los lados según el origen", () => {
    expect(sideTitles({ origin: "par", kind: "contradiccion" }).after).toBe("Lo que dijo ahora");
    expect(sideTitles({ origin: "senalamiento", kind: "promesa_incumplida" }).before).toBe("Lo que había anunciado");
  });

  it("la cobertura no menciona nada técnico", () => {
    const line = coverageLine(
      { candidate_id: "c1", status: "ok", last_scan_at: "2026-11-25T12:00:00Z", reason: null, stats: { statements_30d: 196, own_30d: 0 } },
      "Axel Kicillof",
    );
    expect(line).toBe("Comparamos 196 declaraciones de Axel Kicillof en el último mes.");
    expect(line).not.toMatch(/modelo|token|USD|costo|LLM|IA/i);
    expect(coverageLine(null, "X")).toBeNull();
  });

  it("la sección existe para todos los candidatos", () => {
    expect(CANDIDATE_SECTIONS).toContain("contradicciones");
    expect(sectionAvailable("contradicciones", "pedro-sanchez")).toBe(true);
  });
});

describe("MemoryRepo inconsistency", () => {
  const data = () => ({
    candidates: [],
    mentions: [],
    inconsistency_alerts: [alert({ id: "a1" }), alert({ id: "a2", candidate_id: "c2" }), alert({ id: "a3", detected_at: "2026-11-20T00:00:00Z" })],
    inconsistency_scans: [{ candidate_id: "c1", status: "ok" as const, last_scan_at: "2026-11-25T12:00:00Z", reason: null, stats: {} }],
  });

  it("lista solo las del candidato, la más nueva primero, y actualiza el estado", async () => {
    const repo = new MemoryRepo(data() as never);
    expect((await repo.listInconsistencyAlerts("c1")).map((a) => a.id)).toEqual(["a3", "a1"]);
    expect(await repo.getInconsistencyScan("c2")).toBeNull();
    await repo.updateInconsistencyAlertStatus("c1", "a1", "approved", "visto");
    const a1 = (await repo.listInconsistencyAlerts("c1")).find((a) => a.id === "a1");
    expect(a1?.status).toBe("approved");
    expect(a1?.status_note).toBe("visto");
    await expect(repo.updateInconsistencyAlertStatus("c1", "a2", "approved", null)).rejects.toThrow();
  });
});
