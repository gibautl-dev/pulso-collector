import type { AiAnswer } from "@/lib/types";
import { balanceTone, formatBalance, keptCitations } from "@/lib/ai-visibility";
import { Badge } from "@/components/ui";

function AnswerBody({ text }: { text: string }) {
  const html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" class="text-indigo-700 underline decoration-indigo-200 underline-offset-2 hover:text-indigo-900" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/^###\s+(.+)$/gm, '<strong class="mt-4 block text-slate-900">$1</strong>')
    .replace(/^##\s+(.+)$/gm, '<strong class="mt-4 block text-slate-900">$1</strong>')
    .replace(/\n\n/g, "</p><p class=\"mt-3\">");
  return <div className="text-sm leading-6 text-slate-700" dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }} />;
}

export function AiAnswerCard({ answer }: { answer: AiAnswer }) {
  const citations = keptCitations(answer);
  const tone = balanceTone(answer.balance);
  const badgeClass =
    tone === "positive"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : tone === "negative"
        ? "bg-rose-50 text-rose-800 ring-rose-200"
        : "bg-slate-50 text-slate-700 ring-slate-200";
  return (
    <article className="border-b border-slate-100 py-6 last:border-b-0 last:pb-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-900">{answer.prompt}</h3>
        <Badge className={badgeClass}>Balance {formatBalance(answer.balance)}</Badge>
      </div>
      {answer.balance_reason && <p className="mt-2 text-sm text-slate-500">{answer.balance_reason}</p>}
      <div className="mt-4">
        <AnswerBody text={answer.answer} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <AspectList title="Aspectos presentados como positivos" items={answer.positives} tone="positive" empty="No resalta aspectos favorables." />
        <AspectList title="Aspectos presentados como negativos" items={answer.negatives} tone="negative" empty="No resalta aspectos desfavorables." />
      </div>
      {answer.other_politicians.length > 0 && (
        <p className="mt-3 text-sm text-slate-600">
          <span className="font-medium text-slate-800">Otros políticos mencionados: </span>
          {answer.other_politicians.join(", ")}
        </p>
      )}
      {answer.topics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {answer.topics.map((topic) => (
            <Badge key={topic} className="bg-white text-slate-600 ring-slate-200">
              {topic}
            </Badge>
          ))}
        </div>
      )}
      {citations.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Fuentes citadas</p>
          <ul className="mt-2 space-y-1">
            {citations.map((c) => (
              <li key={c.url} className="truncate text-sm">
                <a href={c.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">
                  {c.domain ?? c.url}
                </a>
                {c.title ? <span className="text-slate-500"> — {c.title}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function AspectList({
  title,
  items,
  tone,
  empty,
}: {
  title: string;
  items: string[];
  tone: "positive" | "negative";
  empty: string;
}) {
  const color = tone === "positive" ? "text-emerald-800" : "text-rose-800";
  const bullet = tone === "positive" ? "bg-emerald-500" : "bg-rose-500";
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li key={item} className={`flex gap-2 text-sm ${color}`}>
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${bullet}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
