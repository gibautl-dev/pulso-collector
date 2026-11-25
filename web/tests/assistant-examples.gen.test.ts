/**
 * Genera las cifras y menciones de los ejemplos del asistente desde una
 * exportación real (solo lectura). No corre en `npm test`:
 *   PULSO_ASSISTANT_EXAMPLES=/ruta/fixture.json PULSO_ASSISTANT_EXAMPLES_OUT=/ruta/out.json npx vitest run tests/assistant-examples.gen.test.ts
 * El texto de las respuestas de ejemplo se escribe aparte (sin modelo en la máquina de trabajo).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { MemoryRepo, type FixtureData } from "@/lib/data/memory";
import { repoDataSource } from "@/lib/assistant/data";
import { runTool } from "@/lib/assistant/agent";
import { Evidence } from "@/lib/assistant/tools";
import { checkAnswer } from "@/lib/assistant/prompt";

const path = process.env.PULSO_ASSISTANT_EXAMPLES;

const PLAN: { slug: string; question: string; page: string; tools: [string, Record<string, unknown>][] }[] = [
  {
    slug: "axel-kicillof",
    question: "¿Qué se dijo de Kicillof sobre la economía esta semana?",
    page: "tablero",
    tools: [
      ["contar_menciones", { periodo_dias: 7, tema: "economía", texto: [], fuente: "todas", tono: "todas", autoria: "terceros", desde: null, hasta: null }],
      ["buscar_menciones", { periodo_dias: 7, tema: "economía", texto: [], fuente: "todas", tono: "todas", autoria: "terceros", orden: "relevantes", limite: 5, desde: null, hasta: null }],
    ],
  },
  {
    slug: "axel-kicillof",
    question: "¿Cómo estamos frente a Milei en los últimos 7 días?",
    page: "comparacion",
    tools: [["comparar_rivales", { periodo_dias: 7, rival: "Milei" }]],
  },
  {
    slug: "pedro-sanchez",
    question: "¿Cuáles fueron las críticas más fuertes de las últimas 24 horas?",
    page: "tablero",
    tools: [
      ["contar_menciones", { periodo_dias: 1, tema: null, texto: [], fuente: "todas", tono: "todas", autoria: "terceros", desde: null, hasta: null }],
      ["buscar_menciones", { periodo_dias: 1, tema: null, texto: [], fuente: "todas", tono: "en_contra", autoria: "terceros", orden: "relevantes", limite: 4, desde: null, hasta: null }],
    ],
  },
  {
    slug: "pedro-sanchez",
    question: "¿Qué temas crecieron más en los últimos 7 días?",
    page: "temas",
    tools: [["temas", { periodo_dias: 7, desde: null, hasta: null }]],
  },
  {
    slug: "pedro-sanchez",
    question: "¿Cuánto gastó Sánchez en anuncios de Meta este mes?",
    page: "anuncios",
    tools: [["anuncios", { periodo_dias: 30, desde: null, hasta: null }]],
  },
];

describe.skipIf(!path)("ejemplos del asistente (datos reales)", () => {
  it("genera cifras y menciones", async () => {
    const data = JSON.parse(readFileSync(path!, "utf8")) as FixtureData;
    const repo = new MemoryRepo(data);
    const now = new Date(data.exported_at!);
    const out = [];
    for (const step of PLAN) {
      const candidate = (await repo.getCandidate(step.slug))!;
      const src = repoDataSource(repo, candidate, now);
      const ev = new Evidence();
      const results = [];
      const facts = [];
      const notes = [];
      for (const [name, args] of step.tools) {
        const r = await runTool(name, JSON.stringify(args), src, ev);
        results.push({ name, args, result: r.out?.result });
        facts.push(...(r.out?.facts ?? []));
        notes.push(...(r.out?.notes ?? []));
      }
      out.push({ ...step, candidate_id: candidate.id, results, facts, notes: [...new Set(notes)], evidence: ev.all() });
    }
    writeFileSync(process.env.PULSO_ASSISTANT_EXAMPLES_OUT!, JSON.stringify(out, null, 2));

    // Respuestas escritas a mano (sin modelo en la máquina de trabajo): pasan por
    // los mismos controles que las del modelo y se guardan en una copia del fixture.
    const answersPath = process.env.PULSO_ASSISTANT_ANSWERS;
    if (!answersPath) return;
    const answers = JSON.parse(readFileSync(answersPath, "utf8")) as { slug: string; question: string; status: string; text: string; no_data: boolean; followups: string[] }[];
    const rows = [];
    let minute = 0;
    for (const a of answers) {
      const step = out.find((o) => o.slug === a.slug && o.question === a.question)!;
      const ev = new Evidence();
      // Reconstruye el registro con las mismas referencias.
      const candidate = (await repo.getCandidate(a.slug))!;
      const src = repoDataSource(repo, candidate, now);
      const toolTexts: string[] = [];
      for (const [name, args] of step.tools) {
        const r = await runTool(name, JSON.stringify(args), src, ev);
        toolTexts.push(JSON.stringify(r.out?.result));
      }
      const checked = checkAnswer(a.text, ev, toolTexts, step.facts);
      if (checked.droppedRefs.length || checked.unsupportedNumbers.length) {
        throw new Error(`Ejemplo inválido (${a.question}): ${JSON.stringify(checked)}`);
      }
      rows.push({
        id: crypto.randomUUID(),
        candidate_id: candidate.id,
        question: a.question,
        page: step.page,
        status: a.status,
        created_at: new Date(now.getTime() + 60000 * ++minute).toISOString(),
        cost_usd: null,
        answer: {
          text: checked.text,
          no_data: a.no_data,
          followups: a.followups,
          citations: a.no_data ? [] : checked.citations,
          facts: a.no_data ? [] : step.facts.slice(0, 6),
          notes: step.notes.slice(0, 3),
        },
      });
    }
    const fixtureOut = process.env.PULSO_ASSISTANT_FIXTURE_OUT;
    if (fixtureOut) writeFileSync(fixtureOut, JSON.stringify({ ...data, assistant_questions: rows }));
  });
});
