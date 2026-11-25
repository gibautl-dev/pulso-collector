import Link from "next/link";
import { MentionFeedItem } from "@/components/mention-feed";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { loadCandidate } from "@/lib/context";
import { CUSTOM_TOPICS_SECTION_LABEL } from "@/lib/labels";
import { computeTopicStats } from "@/lib/custom-topics";
import { balanceTone } from "@/lib/balance";
import { formatBalance } from "@/lib/x-posts";
import { regionFor } from "@/lib/region";
import { clockFor } from "@/lib/time";

export const metadata = { title: `${CUSTOM_TOPICS_SECTION_LABEL} · Pulso` };

export default async function TemasPage({ params, searchParams }: PageProps<"/c/[slug]/temas">) {
  const { slug } = await params;
  const clock = clockFor(slug);
  const days = Number((await searchParams).dias) === 14 ? 14 : 7;
  const { repo, candidate } = await loadCandidate(slug);
  const ts = await repo.dataTimestamp();
  const now = ts ? new Date(ts) : new Date();
  const since = new Date(now.getTime() - 30 * 86400000).toISOString();
  const [topics, mentions] = await Promise.all([
    repo.listCustomTopics(candidate.id),
    repo.mentionsSince(candidate.id, since),
  ]);
  const staff = await repo.isStaff();
  const rows = topics.map((topic) => ({
    topic,
    stats: computeTopicStats(topic, mentions, { now, days, timeZone: clock.timeZone, highlightLimit: 3 }),
  }));

  return (
    <>
      <PageHeader
        title={CUSTOM_TOPICS_SECTION_LABEL}
        description={`Temáticas definidas a mano para ${candidate.name}. Un analista escribe un resumen para que una persona lo revise. Pulso no publica nada solo.`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm shadow-sm">
            {[7, 14].map((p) => (
              <Link
                key={p}
                href={`/c/${slug}/temas?dias=${p}`}
                className={`rounded-md px-3 py-1.5 font-medium ${p === days ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {p} días
              </Link>
            ))}
          </div>
          {staff ? (
            <Link href="/admin/temas" className="text-sm font-medium text-indigo-700 hover:underline">
              Definir temas (panel Active)
            </Link>
          ) : null}
        </div>
      </PageHeader>

      {topics.length === 0 ? (
        <EmptyState>
          Todavía no hay temas a medida para {candidate.name}. Cuando el equipo de Active los defina, van a aparecer
          acá con volumen, balance y un analista por tema.
        </EmptyState>
      ) : (
        <ul data-testid="temas-list" className="space-y-4">
          {rows.map(({ topic, stats }) => {
            return (
              <li key={topic.id}>
                <Card
                  testId={`tema-card-${topic.id}`}
                  title={topic.name}
                  subtitle={`${topic.enabled ? "Activo" : "Pausado"} · ${regionFor(slug).countryName}`}
                  action={
                    <Link href={`/c/${slug}/temas/${topic.id}`} className="text-sm font-medium text-indigo-700 hover:underline">
                      Ver tema y analista
                    </Link>
                  }
                >
                  {topic.description ? <p className="mb-4 text-sm text-slate-600">{topic.description}</p> : null}
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Stat label="Volumen" value={stats.volume} hint={stats.trendLabel} />
                    <Stat
                      label="Balance"
                      value={stats.balance.score == null ? "—" : formatBalance(stats.balance.score)}
                      tone={balanceTone(stats.balance.score)}
                      hint={stats.balance.label}
                    />
                    <Stat label="A favor" value={stats.balance.positivo} tone="positive" hint={`${stats.balance.pendiente} sin tono`} />
                    <Stat
                      label="Pico"
                      value={stats.spike ? "Sí" : "No"}
                      hint={stats.spikeLabel ?? "Sin pico en los últimos 3 días."}
                    />
                  </div>
                  {stats.topMentions.length > 0 ? (
                    <div className="mt-4" data-testid="tema-menciones-recientes">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                        {stats.topMentions.length === 1 ? "Mención reciente" : "Menciones recientes"}
                      </p>
                      <ul className="divide-y divide-slate-50">
                        {stats.topMentions.map((m) => (
                          <MentionFeedItem key={m.id} m={m} slug={slug} now={now} clock={clock} showOriginal />
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-slate-500">No hubo coincidencias por palabras clave en esta ventana.</p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
