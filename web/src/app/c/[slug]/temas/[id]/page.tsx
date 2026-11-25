import Link from "next/link";
import { notFound } from "next/navigation";
import { MentionRow } from "@/components/mention-row";
import { VolumeChart } from "@/components/volume-chart";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { updateTopicSummaryStatusAction } from "@/app/c/[slug]/temas/actions";
import { TopicSummaryForm } from "@/components/topic-summary-form";
import { loadCandidate } from "@/lib/context";
import { computeTopicStats } from "@/lib/custom-topics";
import { CUSTOM_TOPIC_SUMMARY_STATUS_LABEL, CUSTOM_TOPICS_SECTION_LABEL } from "@/lib/labels";
import { regionFor } from "@/lib/region";
import { clockFor, formatDateTime } from "@/lib/time";

export const metadata = { title: `${CUSTOM_TOPICS_SECTION_LABEL} · Pulso` };

export default async function TemaDetailPage({ params }: PageProps<"/c/[slug]/temas/[id]">) {
  const { slug, id } = await params;
  const clock = clockFor(slug);
  const { repo, candidate } = await loadCandidate(slug);
  const topic = await repo.getCustomTopic(candidate.id, id);
  if (!topic) notFound();
  const ts = await repo.dataTimestamp();
  const now = ts ? new Date(ts) : new Date();
  const since = new Date(now.getTime() - 30 * 86400000).toISOString();
  const [mentions, latest] = await Promise.all([
    repo.mentionsSince(candidate.id, since),
    repo.latestCustomTopicSummary(candidate.id, topic.id),
  ]);
  const stats = computeTopicStats(topic, mentions, { now, days: 7, timeZone: clock.timeZone, highlightLimit: 10 });
  const volumeForChart = stats.volumeByDay.map((d) => ({
    day: d.day,
    total: d.total,
    positivo: 0,
    neutral: d.total - d.negativo,
    negativo: d.negativo,
    pendiente: 0,
  }));

  return (
    <>
      <p className="mb-4">
        <Link href={`/c/${slug}/temas`} className="text-sm text-indigo-700 hover:underline">
          {`← ${CUSTOM_TOPICS_SECTION_LABEL}`}
        </Link>
      </p>
      <PageHeader
        title={topic.name}
        description={topic.description || `Tema a medida para ${candidate.name} en ${regionFor(slug).countryName}.`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Volumen (7 días)" value={stats.volume} hint={stats.trendLabel} />
        <Stat label="Críticas" value={stats.balance.negativo} tone="negative" hint={stats.balance.label} />
        <Stat label="A favor" value={stats.balance.positivo} tone="positive" />
        <Stat label="Pico" value={stats.spike ? "Sí" : "No"} hint={stats.spikeLabel ?? "Sin pico en los últimos 3 días."} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Volumen diario" subtitle="Coincidencias por palabras clave, sobre menciones ya recolectadas." className="lg:col-span-2">
          <VolumeChart data={volumeForChart} clock={clock} />
        </Card>
        <Card title="Recorte" subtitle="Así se eligen las menciones, sin fuentes nuevas.">
          <p className="text-xs text-slate-500">Palabras</p>
          <p className="text-sm text-slate-800">{[...topic.keywords, ...topic.include_terms].join(", ") || "—"}</p>
          {topic.exclude_terms.length ? (
            <>
              <p className="mt-3 text-xs text-slate-500">Excluye</p>
              <p className="text-sm text-slate-800">{topic.exclude_terms.join(", ")}</p>
            </>
          ) : null}
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title="Analista del tema"
          subtitle="Un bot especializado en esta temática. Escribe un resumen para revisar. Pulso no publica ni postea nada."
        >
          <TopicSummaryForm slug={slug} topicId={topic.id} hasLatest={Boolean(latest)} />
          {latest ? (
            <div>
              <p className="rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                {latest.origin === "fixture_example"
                  ? "Ejemplo de interfaz (modo local). Este resumen no sale de una corrida real del modelo."
                  : "Resumen de IA para verificar. Una persona lo revisa; Pulso no publica nada."}
                {latest.note ? ` ${latest.note}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge className={latest.status === "approved" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : latest.status === "discarded" ? "bg-slate-100 text-slate-600 ring-slate-200" : "bg-amber-50 text-amber-900 ring-amber-200"}>{CUSTOM_TOPIC_SUMMARY_STATUS_LABEL[latest.status] ?? latest.status}</Badge>
                <span className="text-xs text-slate-500">
                  Ventana {formatDateTime(latest.period_start, clock)} – {formatDateTime(latest.period_end, clock)} ({clock.tzLabel})
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-800">{latest.output.happening}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Riesgos</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-700">
                    {latest.output.risks.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Oportunidades</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-700">
                    {latest.output.opportunities.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Ángulos de contenido propio (para aprobar)</p>
                <ul className="mt-2 space-y-2">
                  {latest.output.angles.map((item) => (
                    <li key={item.title} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                      <p className="text-sm font-medium text-slate-900">{item.title}</p>
                      <p className="mt-1 text-sm text-slate-700">{item.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
              {latest.status === "draft" ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <form action={updateTopicSummaryStatusAction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="topic_id" value={topic.id} />
                    <input type="hidden" name="summary_id" value={latest.id} />
                    <input type="hidden" name="status" value="approved" />
                    <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                      Aprobar
                    </button>
                  </form>
                  <form action={updateTopicSummaryStatusAction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="topic_id" value={topic.id} />
                    <input type="hidden" name="summary_id" value={latest.id} />
                    <input type="hidden" name="status" value="discarded" />
                    <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50">
                      Descartar
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState>Todavía no hay un resumen del analista para este tema.</EmptyState>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Menciones que coinciden" subtitle="Recorte por palabras clave sobre lo que Pulso ya tiene. No es una recolección nueva.">
          {stats.topMentions.length === 0 ? (
            <EmptyState>No hubo coincidencias en los últimos 7 días.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {stats.topMentions.map((m) => (
                <MentionRow key={m.id} m={m} slug={slug} compact />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
