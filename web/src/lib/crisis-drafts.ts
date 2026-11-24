/** Destinatario de un borrador de Acción, según el canal. Sirve para cualquier candidato. */

const SPOKESPERSON = new Set(["argumento_oral", "vocero", "oral", "argumento-oral"]);
const PRESS = new Set(["comunicado", "press", "prensa"]);
const OFFICIAL = new Set(["x", "twitter", "oficial", "cuenta_oficial", "instagram", "facebook", "tiktok"]);

function normalize(channel: string): string {
  return channel.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export type DraftAudienceKind = "oficial" | "vocero";

export interface DraftAudience {
  kind: DraftAudienceKind;
  label: string;
  hint: string;
}

/**
 * Quién debería usar este texto. Se deriva del canal (o de un tipo explícito).
 * Nunca asume un nombre de candidato hardcodeado.
 */
export function draftAudience(
  channel: string,
  candidateName: string,
  extras?: { type?: string | null },
): DraftAudience {
  const raw = normalize([extras?.type, channel].filter(Boolean).join(" "));
  const name = candidateName.trim() || "el candidato";
  if (SPOKESPERSON.has(normalize(channel)) || raw.includes("vocero") || raw.includes("oral")) {
    return {
      kind: "vocero",
      label: "Para un vocero",
      hint: `Pensado para que un vocero lo use en una entrevista o declaración, no para publicarlo desde la cuenta de ${name}.`,
    };
  }
  if (PRESS.has(normalize(channel)) || raw.includes("comunicado") || raw.includes("prensa")) {
    return {
      kind: "oficial",
      label: "Para la cuenta oficial del candidato",
      hint: `Para un comunicado de ${name} o de su equipo de prensa. Si se aprueba, una persona lo publica a mano.`,
    };
  }
  if (OFFICIAL.has(normalize(channel)) || raw.includes("oficial")) {
    return {
      kind: "oficial",
      label: "Para la cuenta oficial del candidato",
      hint: `Para publicarlo desde la cuenta oficial de ${name} o la de su equipo. Pulso no lo publica.`,
    };
  }
  return {
    kind: "oficial",
    label: "Para la cuenta oficial del candidato",
    hint: `Para ${name} o su equipo. Pulso no lo publica; una persona lo postea a mano si se aprueba.`,
  };
}

export const MANUAL_PUBLISH_NOTE =
  "Pulso nunca publica ni postea. Si el brief se aprueba, una persona copia el texto y lo publica a mano.";
