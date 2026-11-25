import type { AiAnswer } from "@/lib/types";
import { cleanQuote, keptCitations } from "@/lib/ai-visibility";
import { highlightCoverage, highlightSegments } from "@/lib/highlight-phrases";

function HighlightedBody({ text, positives, negatives }: { text: string; positives: string[]; negatives: string[] }) {
  const segments = highlightSegments(text, positives, negatives);
  return (
    <p className="text-sm leading-7 text-slate-800">
      {segments.map((seg, i) =>
        seg.tone === "positive" ? (
          <mark key={i} className="rounded-sm bg-emerald-100 font-medium text-emerald-800">
            {seg.text}
          </mark>
        ) : seg.tone === "negative" ? (
          <mark key={i} className="rounded-sm bg-rose-100 font-medium text-rose-800">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  );
}

export function AiAnswerCard({ answer }: { answer: AiAnswer }) {
  const citations = keptCitations(answer);
  const visible = cleanQuote(answer.answer.replace(/^#{1,6}\s+/gm, ""));
  const coverage = highlightCoverage(visible, answer.positives, answer.negatives);

  return (
    <article className="border-b border-slate-100 py-6 last:border-b-0 last:pb-0 first:pt-0">
      <div className="flex justify-end">
        <p className="max-w-[92%] rounded-2xl rounded-br-md bg-violet-600 px-4 py-2.5 text-sm font-medium text-white">
          {answer.prompt}
        </p>
      </div>
      <div className="mt-3 max-w-[95%] rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3">
        {visible ? (
          <HighlightedBody text={visible} positives={answer.positives} negatives={answer.negatives} />
        ) : (
          <p className="text-sm text-slate-500">No hay texto de respuesta para esta pregunta.</p>
        )}
      </div>
      {citations.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Fuentes citadas</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {citations.map((c) => (
              <a
                key={c.url}
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-200"
              >
                <span className="truncate">{c.domain ?? c.title ?? c.url}</span>
              </a>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">No hay fuentes citadas conservadas para esta respuesta.</p>
      )}
      {coverage.missed.length > 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          Hay aspectos guardados por el clasificador que no aparecen textuales en la respuesta, así que no se subrayaron.
        </p>
      ) : null}
    </article>
  );
}
