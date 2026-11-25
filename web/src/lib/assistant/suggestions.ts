/** Preguntas sugeridas del asistente según la página. Sin I/O. */

export const ASSISTANT_LABEL = "Preguntale a Pulso";

export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : name;
}

export interface SuggestionInput {
  candidateName: string;
  section: string;
  topTopic?: string | null;
  rival?: string | null;
  hasAds?: boolean;
}

/** 4 preguntas cortas, respondibles con los datos de Pulso. */
export function suggestedQuestions(input: SuggestionInput): string[] {
  const who = shortName(input.candidateName);
  const topic = input.topTopic && input.topTopic !== "otros" ? input.topTopic : "la economía";
  const base = [
    `¿Qué se dijo de ${who} sobre ${topic} esta semana?`,
    "¿Cuáles fueron las críticas más fuertes de las últimas 24 horas?",
    "¿Qué cambió esta semana respecto de la anterior?",
  ];
  const rival = input.rival ? `¿Cómo estamos frente a ${shortName(input.rival)} en los últimos 7 días?` : "¿Qué temas crecieron más en los últimos 7 días?";
  const bySection: Record<string, string[]> = {
    menciones: ["¿Qué medios hablaron más de " + who + " esta semana?", base[1], base[0], "¿Qué se dijo a favor en los últimos 3 días?"],
    temas: ["¿Qué temas crecieron más en los últimos 7 días?", `¿Cuál es el tema más crítico para ${who}?`, base[0], base[2]],
    comparacion: [rival, `¿En qué temas le va peor a ${who}?`, base[2], base[1]],
    anuncios: input.hasAds
      ? ["¿Cuántos anuncios están activos hoy y quién los paga?", "¿Qué dicen los anuncios en contra?", base[2], rival]
      : [base[0], base[1], base[2], rival],
    resumen: ["¿Qué hay que hacer hoy según el último resumen?", base[1], base[2], base[0]],
  };
  const out = bySection[input.section] ?? [base[0], base[1], base[2], rival];
  return [...new Set(out)].slice(0, 4);
}

/** Pregunta contextual desde un ⓘ. */
export function cardQuestion(title: string): string {
  return `¿Qué muestra "${title}" y qué conclusión saco?`;
}

/** Hash que abre el asistente con una pregunta (lo lee el panel en el navegador). */
export function askHash(question: string, card?: string | null, info?: string | null): string {
  const p = new URLSearchParams({ preguntar: question });
  if (card) p.set("tarjeta", card.slice(0, 80));
  if (info) p.set("info", info.slice(0, 300));
  return `#${p.toString()}`;
}

export function parseAskHash(hash: string): { question: string; card: string | null; info: string | null } | null {
  const raw = hash.replace(/^#/, "");
  if (!raw.startsWith("preguntar=")) return null;
  const p = new URLSearchParams(raw);
  const question = (p.get("preguntar") ?? "").trim();
  if (!question) return null;
  return { question: question.slice(0, 400), card: p.get("tarjeta"), info: p.get("info") };
}
