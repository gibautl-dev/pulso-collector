import Link from "next/link";
import { AiAnswerCard } from "@/components/ai-answer-card";
import { AiBalanceChart } from "@/components/ai-balance-chart";
import { AiDayGauge } from "@/components/ai-day-gauge";
import { Card, EmptyState, HBar, PageHeader, Stat } from "@/components/ui";
import {
  answersOnDay,
  cleanQuote,
  computeAiDashboard,
  formatBalance,
  formatShare,
} from "@/lib/ai-visibility";
import { dayBalanceGauge } from "@/lib/ai-day-gauge";
import { highlightCoverage } from "@/lib/highlight-phrases";
import { loadCandidate } from "@/lib/context";
import { clockFor, formatDateTime } from "@/lib/time";

export const metadata = { title: "En la IA · Pulso" };

const POLARITY_BAR = {
  positive: "bg-emerald-500",
  negative: "bg-rose-500",
  neutral: "bg-slate-400",
};

export default async function AiVisibilityPage({ params, searchParams }: PageProps<"/c/[slug]/ia">) {
  const { slug } = await params;
  const clock = clockFor(slug);
  const sp = await searchParams;
  const pregunta = typeof sp.pregunta === "string" ? sp.pregunta : "";
  const { repo, candidate } = await loadCandidate(slug);
  const [answers, capReached] = await Promise.all([
    repo.listAiAnswers(candidate.id),
    repo.aiVisibilityCapReachedToday(candidate.id),
  ]);
  const view = computeAiDashboard(answers);
  const latest = view.latestDay ? answersOnDay(answers, view.latestDay) : [];
  const gauge = dayBalanceGauge(answers);
  const featured =
    latest
      .map((answer) => {
        const hits = highlightCoverage(cleanQuote(answer.answer), answer.positives, answer.negatives);
        return { answer, score: hits.positiveHits + hits.negativeHits };
      })
      .sort((a, b) => b.score - a.score)[0]?.answer ?? latest[0] ?? null;
  const askedAt = latest[0]?.asked_at ?? answers[0]?.asked_at ?? null;
  const lastLabel = askedAt
    ? `Última foto: ${formatDateTime(askedAt, clock)} (${clock.tzLabel}).`
    : "Todavía no hay una corrida registrada.";
  const drillDown = pregunta ? answers.filter((a) => a.prompt_key === pregunta) : latest;
  const selectedQuestion = view.questions.find((q) => q.promptKey === pregunta) ?? null;
  const worst = view.questions[0] ?? null;
  const best = view.questions.length ? view.questions[view.questions.length - 1] : null;
  const polarityMax = Math.max(1, view.positive, view.negative, view.neutral);
  const questionMax = Math.max(1, ...view.questions.map((q) => Math.abs(q.averageBalance)));

  return (
    <>
      <PageHeader
        title="En la IA"
        description={`Cómo responde la IA cuando le preguntan por ${candidate.name}. ${lastLabel}`}
      />
      {capReached ? (
        <div
          className="mb-6 flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
          role="status"
          data-testid="ai-cap-reached"
        >
          <span aria-hidden className="text-lg leading-none">☀︎</span>
          <p>
            <strong className="font-semibold">Por hoy ya completamos las consultas a la IA.</strong> Volvé mañana para
            ver la próxima foto. Mientras tanto, acá tenés la más reciente.
          </p>
        </div>
      ) : null}

      {view.insufficient ? (
        <Card>
          <EmptyState>{"Todavía no hay suficientes respuestas de la IA."}</EmptyState>
        </Card>
      ) : (
        <>
          <div data-testid="ia-hero" className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card
              title="Foto del día"
              subtitle={
                gauge
                  ? `Respuestas del ${gauge.day}.`
                  : "Todavía no hay una foto diaria."
              }
            >
              {latest.length === 0 ? (
                <EmptyState>No hay respuestas en el último día.</EmptyState>
              ) : (
                <div>
                  <div className="relative max-h-80 overflow-hidden">
                    {featured ? <AiAnswerCard answer={featured} /> : null}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent" />
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    La respuesta completa está en el listado de abajo
                    {latest.length > 1 ? `, junto con ${latest.length - 1} pregunta${latest.length - 1 === 1 ? "" : "s"} más del día` : ""}.
                  </p>
                </div>
              )}
            </Card>
            <div className="space-y-4">
              <Card
                title="Balance del día"
                subtitle="De −100 a +100, en la última foto diaria."
              >
                {gauge && gauge.balance != null ? (
                  <>
                    <AiDayGauge balance={gauge.balance} />
                  </>
                ) : (
                  <EmptyState>No hay un balance numérico para el último día.</EmptyState>
                )}
              </Card>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="A favor" value={formatShare(gauge?.positiveShare ?? null)} tone="positive" />
                <Stat label="En contra" value={formatShare(gauge?.negativeShare ?? null)} tone="negative" />
                <Stat label="Neutrales" value={formatShare(gauge?.neutralShare ?? null)} />
              </div>
            </div>
          </div>

          <div className="mb-6 grid gap-6 lg:grid-cols-3">
            <Card
              title="Evolución del balance"
              subtitle="Promedio diario, de −100 a +100."
              className="lg:col-span-2"
            >
              {view.trendInsufficient ? (
                <div>
                  <p className="mb-4 text-sm text-slate-600">
                    Todavía hay una sola foto diaria. La tendencia se arma a medida que se sumen días.
                  </p>
                  <AiBalanceChart clock={clock} data={view.days} />
                </div>
              ) : (
                <AiBalanceChart clock={clock} data={view.days} />
              )}
            </Card>
            <Card title="Composición" subtitle="Cómo se parten las respuestas clasificadas.">
              <div className="space-y-3">
                <HBar label="A favor" value={view.positive} max={polarityMax} barClass={POLARITY_BAR.positive} extra={<span className="ml-1.5 text-xs text-slate-500">{formatShare(view.positiveShare)}</span>} />
                <HBar label="En contra" value={view.negative} max={polarityMax} barClass={POLARITY_BAR.negative} extra={<span className="ml-1.5 text-xs text-slate-500">{formatShare(view.negativeShare)}</span>} />
                <HBar label="Neutrales" value={view.neutral} max={polarityMax} barClass={POLARITY_BAR.neutral} extra={<span className="ml-1.5 text-xs text-slate-500">{formatShare(view.neutralShare)}</span>} />
              </div>
            </Card>
          </div>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card title="Lo bueno" subtitle="Aspectos favorables que se repiten en las respuestas, agrupados.">
              {view.positives.length === 0 ? (
                <EmptyState>No hay aspectos favorables guardados en estas respuestas.</EmptyState>
              ) : (
                <ClaimList groups={view.positives} slug={slug} tone="positive" />
              )}
            </Card>
            <Card title="Lo malo" subtitle="Aspectos desfavorables que se repiten en las respuestas, agrupados.">
              {view.negatives.length === 0 ? (
                <EmptyState>No hay aspectos desfavorables guardados en estas respuestas.</EmptyState>
              ) : (
                <ClaimList groups={view.negatives} slug={slug} tone="negative" />
              )}
            </Card>
          </div>

          <Card
            title="Por pregunta"
            subtitle="Promedio del balance según la pregunta del set. Las más desfavorables aparecen primero."
            className="mb-6"
          >
            {view.questions.length === 0 ? (
              <EmptyState>Todavía no hay datos para esta pregunta.</EmptyState>
            ) : (
              <>
                {best && worst && best.promptKey !== worst.promptKey ? (
                  <p className="mb-4 text-sm text-slate-600">
                    La pregunta con peor saldo es “{worst.prompt}” ({formatBalance(worst.averageBalance)}). La de mejor
                    saldo es “{best.prompt}” ({formatBalance(best.averageBalance)}).
                  </p>
                ) : null}
                <div className="space-y-3">
                  {view.questions.map((row) => {
                    const width = questionMax > 0 ? Math.max(2, Math.round((Math.abs(row.averageBalance) / questionMax) * 100)) : 0;
                    const barClass = row.averageBalance < -5 ? "bg-rose-500" : row.averageBalance > 5 ? "bg-emerald-500" : "bg-slate-400";
                    return (
                      <div key={row.promptKey}>
                        <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                          <Link href={`/c/${slug}/ia?pregunta=${encodeURIComponent(row.promptKey)}`} className="truncate text-slate-700 hover:text-indigo-700">
                            {row.prompt}
                          </Link>
                          <span className="shrink-0 tabular-nums text-slate-900">
                            {formatBalance(row.averageBalance)}
                            <span className="ml-1.5 text-xs text-slate-500">{row.answers} resp.</span>
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100">
                          <div className={`h-2 rounded-full ${barClass}`} style={{ width: row.averageBalance !== 0 ? `${width}%` : 0 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Card>

          {view.domains.length > 0 && (
            <Card title="Fuentes citadas" subtitle="Dominios conservados en las respuestas, no los filtrados." className="mb-6">
              <ol className="divide-y divide-slate-100">
                {view.domains.slice(0, 15).map((row, index) => (
                  <li key={row.domain} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-slate-800">
                      <span className="mr-2 tabular-nums text-slate-400">{index + 1}.</span>
                      {row.domain}
                    </span>
                    <span className="tabular-nums text-slate-500">{row.count}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </>
      )}

      <Card
        title={selectedQuestion ? "Respuestas de esta pregunta" : "Respuestas del último día"}
        subtitle={
          selectedQuestion
            ? selectedQuestion.prompt
            : view.latestDay
              ? `Preguntas neutrales del ${view.latestDay}. Cada ficha es el detalle para actuar.`
              : undefined
        }
        action={
          selectedQuestion ? (
            <Link href={`/c/${slug}/ia`} className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
              Ver el último día →
            </Link>
          ) : null
        }
      >
        {drillDown.length === 0 ? (
          <EmptyState>
            Todavía no hay respuestas de la IA para este día.
          </EmptyState>
        ) : (
          <div>
            {drillDown.map((answer) => (
              <AiAnswerCard key={answer.id || `${answer.prompt_key}-${answer.asked_on}`} answer={answer} />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function ClaimList({
  groups,
  slug,
  tone,
}: {
  groups: { text: string; count: number; examples: { promptKey: string; prompt: string; quote: string }[] }[];
  slug: string;
  tone: "positive" | "negative";
}) {
  return (
    <ul className="space-y-4">
      {groups.map((group) => (
        <li key={group.text} className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-slate-900">{group.text}</p>
            <span className={`shrink-0 text-xs font-semibold tabular-nums ${tone === "negative" ? "text-rose-600" : "text-emerald-700"}`}>
              {group.count} {group.count === 1 ? "vez" : "veces"}
            </span>
          </div>
          <ul className="mt-2 space-y-2">
            {group.examples.map((example) => (
              <li key={`${example.promptKey}-${example.quote}`} className="text-xs leading-relaxed text-slate-600">
                <span className="italic">“{example.quote}”</span>
                <span className="text-slate-400"> · </span>
                <Link href={`/c/${slug}/ia?pregunta=${encodeURIComponent(example.promptKey)}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                  {example.prompt}
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
