import { AiAnswerCard } from "@/components/ai-answer-card";
import { AiBalanceChart } from "@/components/ai-balance-chart";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { answersOnDay, balanceTone, dailyScores, domainRanking, formatBalance, latestDay } from "@/lib/ai-visibility";
import { loadCandidate } from "@/lib/context";
import { formatDateTime, TZ_LABEL } from "@/lib/time";

export const metadata = { title: "En la IA · Pulso" };

export default async function AiVisibilityPage({ params }: PageProps<"/c/[slug]/ia">) {
  const { slug } = await params;
  const { repo, candidate } = await loadCandidate(slug);
  const answers = await repo.listAiAnswers(candidate.id);
  const scores = dailyScores(answers);
  const day = latestDay(answers);
  const latest = day ? answersOnDay(answers, day) : [];
  const latestScore = scores.at(-1);
  const askedAt = latest[0]?.asked_at ?? null;
  const domains = day ? domainRanking(latest) : [];
  const lastLabel = askedAt
    ? `Última foto: ${formatDateTime(askedAt)} (${TZ_LABEL}).`
    : "Todavía no hay una corrida registrada.";

  return (
    <>
      <PageHeader
        title="En la IA"
        description={`Qué responde la API de OpenAI cuando le preguntan por ${candidate.name}. ${lastLabel} Es una foto diaria de la API, no idéntica a la app ChatGPT.`}
      />

      <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        Esta pantalla muestra una corrida diaria contra la API de OpenAI (<span className="font-medium">chat-latest</span> con
        búsqueda web), no una sesión de la app ChatGPT. No replica memoria, enrutado ni la interfaz de esa app. Las citas
        que no son de Argentina o están claramente fuera de tema se filtran cuando es obvio. El job corre una vez por día
        a partir de las 09:00 (hora de Argentina).
        {repo.mode === "fixture" ? " Este render es local, con datos de un dry-run, y no es una captura de producción." : null}
      </p>

      {latestScore ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Stat
            label="Balance del último día"
            value={formatBalance(latestScore.balance)}
            hint={`${latestScore.answers} preguntas el ${latestScore.day}`}
            tone={balanceTone(latestScore.balance)}
          />
          <Stat label="Preguntas del set" value={latestScore.answers} hint="Set fijo, configurable por candidato" />
          <Stat label="Dominios citados" value={domains.length} hint="Solo fuentes conservadas" />
        </div>
      ) : null}

      <Card title="Evolución del balance" subtitle="Promedio diario del puntaje hacia el candidato, de −100 a +100." className="mb-6">
        {scores.length === 0 ? (
          <EmptyState>
            Todavía no hay corridas. Cuando el job diario termine, acá vas a ver el puntaje de ese día y cómo cambia con
            el tiempo.
          </EmptyState>
        ) : scores.length === 1 ? (
          <div>
            <p className="mb-4 text-sm text-slate-600">
              Por ahora hay una sola foto diaria. La serie se arma sola a medida que se sumen días.
            </p>
            <AiBalanceChart data={scores} />
          </div>
        ) : (
          <AiBalanceChart data={scores} />
        )}
      </Card>

      {domains.length > 0 && (
        <Card title="Ranking de dominios citados" subtitle="Fuentes conservadas en las respuestas del último día." className="mb-6">
          <ol className="divide-y divide-slate-100">
            {domains.slice(0, 15).map((row, index) => (
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

      <Card title="Respuestas del último día" subtitle={day ? `Preguntas neutrales del ${day}.` : undefined}>
        {latest.length === 0 ? (
          <EmptyState>
            Todavía no hay respuestas guardadas. El recolector pregunta una vez por día a la API de OpenAI, a partir de
            las 09:00 (hora de Argentina), y guarda acá el texto, el balance, los aspectos y las fuentes.
          </EmptyState>
        ) : (
          <div>
            {latest.map((answer) => (
              <AiAnswerCard key={answer.id || answer.prompt_key} answer={answer} />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
