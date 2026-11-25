/**
 * Resalta en una respuesta de IA las frases ya guardadas como positivas o
 * negativas (arrays del clasificador). No llama a ningún modelo: busca la
 * frase en el texto, sin distinguir mayúsculas ni tildes. Si no aparece,
 * no se inventa un subrayado.
 */

export type HighlightTone = "positive" | "negative";

export interface HighlightSegment {
  text: string;
  tone: HighlightTone | null;
}

function foldMap(text: string): { folded: string; at: number[] } {
  let folded = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const width = ch.length;
    const plain = ch
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    for (const unit of plain) {
      folded += unit;
      at.push(i);
    }
    i += width;
  }
  return { folded, at };
}

function foldPhrase(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function collectRanges(
  text: string,
  phrases: string[],
  tone: HighlightTone,
): { start: number; end: number; tone: HighlightTone }[] {
  const { folded, at } = foldMap(text);
  const ranges: { start: number; end: number; tone: HighlightTone }[] = [];
  for (const raw of phrases) {
    const target = foldPhrase(raw);
    if (target.length < 3) continue;
    let from = 0;
    while (from < folded.length) {
      const hit = folded.indexOf(target, from);
      if (hit < 0) break;
      const start = at[hit];
      const last = hit + target.length - 1;
      const end = last + 1 < at.length ? at[last + 1] : text.length;
      ranges.push({ start, end, tone });
      from = hit + target.length;
    }
  }
  return ranges;
}

function mergeRanges(
  ranges: { start: number; end: number; tone: HighlightTone }[],
): { start: number; end: number; tone: HighlightTone }[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: { start: number; end: number; tone: HighlightTone }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start < last.end) continue;
    out.push({ ...r });
  }
  return out;
}

export function highlightSegments(text: string, positives: string[], negatives: string[]): HighlightSegment[] {
  if (!text) return [];
  const ranges = mergeRanges([
    ...collectRanges(text, positives, "positive"),
    ...collectRanges(text, negatives, "negative"),
  ]);
  if (ranges.length === 0) return [{ text, tone: null }];
  const parts: HighlightSegment[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) parts.push({ text: text.slice(cursor, r.start), tone: null });
    parts.push({ text: text.slice(r.start, r.end), tone: r.tone });
    cursor = r.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), tone: null });
  return parts;
}

export function highlightCoverage(
  text: string,
  positives: string[],
  negatives: string[],
): { positiveHits: number; negativeHits: number; missed: string[] } {
  const folded = foldPhrase(text);
  const missed: string[] = [];
  let positiveHits = 0;
  let negativeHits = 0;
  for (const p of positives) {
    const t = foldPhrase(p);
    if (t.length < 3) continue;
    if (folded.includes(t)) positiveHits++;
    else missed.push(p);
  }
  for (const p of negatives) {
    const t = foldPhrase(p);
    if (t.length < 3) continue;
    if (folded.includes(t)) negativeHits++;
    else missed.push(p);
  }
  return { positiveHits, negativeHits, missed };
}
