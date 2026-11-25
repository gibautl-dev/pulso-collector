/** Limpia títulos y extractos de menciones para la UI del cliente. Sin I/O. */

const TIMESTAMP = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;

export const DEFAULT_EXCERPT_LENGTH = 180;

function looksLikeChapterList(text: string): boolean {
  const times = text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) ?? [];
  return times.length >= 2 || (text.includes("|") && times.length >= 1);
}

/**
 * Saca listas de capítulos con horarios, pipes, URLs y recorta con elipsis.
 * Si el texto es una tabla de capítulos, deja los títulos unidos con « · ».
 */
export function cleanMentionText(raw: string | null | undefined, opts?: { maxLength?: number }): string {
  let text = (raw ?? "").replace(/\r\n?/g, "\n");
  text = text.replace(URL, " ");
  if (looksLikeChapterList(text)) {
    const parts = text
      .split(/[|\n]+/)
      .map((part) => part.replace(TIMESTAMP, "").trim())
      .filter((part) => part.length > 1);
    text = parts.join(" · ");
  } else {
    text = text.replace(TIMESTAMP, " ").replace(/\|/g, " ");
  }
  text = text.replace(/\s+/g, " ").trim();
  const max = opts?.maxLength ?? DEFAULT_EXCERPT_LENGTH;
  if (max > 0 && text.length > max) {
    const cut = text.slice(0, max - 1);
    const atWord = cut.replace(/\s+\S*$/, "");
    const base = atWord.length >= Math.floor(max * 0.6) ? atWord : cut;
    text = `${base.trimEnd()}…`;
  }
  return text;
}

export function mentionHeadline(
  m: { title?: string | null; content?: string | null; outlet?: string | null },
  opts?: { maxLength?: number },
): string {
  const title = (m.title ?? "").trim();
  const stripped = m.outlet && title.endsWith(` - ${m.outlet}`) ? title.slice(0, -(m.outlet.length + 3)).trim() : title;
  const fromTitle = cleanMentionText(stripped, opts);
  if (fromTitle) return fromTitle;
  const fromContent = cleanMentionText(m.content ?? "", opts);
  return fromContent || "(sin título)";
}
