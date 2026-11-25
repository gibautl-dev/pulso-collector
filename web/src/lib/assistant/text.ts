/** Normalización y búsqueda de texto del asistente. Sin I/O. */

export function normalize(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Limpia y acota los términos que pide el modelo (nunca llegan a SQL). */
export function cleanTerms(terms: readonly unknown[] | null | undefined, max = 8): string[] {
  const out: string[] = [];
  for (const raw of terms ?? []) {
    if (typeof raw !== "string") continue;
    const t = normalize(raw).replace(/[^a-z0-9ñ\s-]/g, " ").replace(/\s+/g, " ").trim();
    if (t.length < 2 || t.length > 40) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matcher: alguna palabra/frase aparece al inicio de palabra (economía → económico no; econom → sí). */
export function termMatcher(terms: string[]): ((text: string) => boolean) | null {
  if (terms.length === 0) return null;
  const re = new RegExp(`(^|[^a-z0-9])(${terms.map(escapeRegex).join("|")})`);
  return (text: string) => re.test(normalize(text));
}

const ENTITIES: Record<string, string> = { quot: '"', amp: "&", apos: "'", lt: "<", gt: ">", nbsp: " ", "#39": "'" };

/** Decodifica entidades HTML frecuentes en títulos de YouTube/RSS (&quot; → "). */
export function decodeEntities(text: string): string {
  return text
    .replace(/&(quot|amp|apos|lt|gt|nbsp|#39);/g, (_, e: string) => ENTITIES[e] ?? _)
    .replace(/&#(\d{2,5});/g, (_, n: string) => String.fromCodePoint(Number(n)));
}
