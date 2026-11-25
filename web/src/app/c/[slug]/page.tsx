import Link from "next/link";
import { Card, EmptyState, HBar, PageHeader, Stat } from "@/components/ui";
import { MentionRow } from "@/components/mention-row";
import { VolumeChart } from "@/components/volume-chart";
import { computeDashboard } from "@/lib/analytics";
import { loadCandidate } from "@/lib/context";
import { NEGATIVE_TONES, SOURCE_BAR, SOURCE_BAR_DEFAULT, sourceLabel, TONE_BAR, TONE_LABEL } from "@/lib/labels";
import { regionFor } from "@/lib/region";
import { clockFor, formatDateTime } from "@/lib/time";
import { formatCount, youtubeThumbnailUrl, youtubeVideoId } from "@/lib/youtube";
import { computeHomeCards } from "@/lib/home-summaries";
import { SourceSummaryCards } from "@/components/source-summary-cards";
import { ACCION_SECTION_LABEL, CUSTOM_TOPICS_SECTION_LABEL } from "@/lib/labels";
import { computeTopicStats } from "@/lib/custom-topics";

export const metadata = { title: "Tablero · Pulso" };
const PERIODS = [7, 14, 30];

export default async function Dashboard({ params, searchParams }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const clock = clockFor(slug);
  const region = regionFor(slug);
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.dias)) ? Number(sp.dias) : 7;
  const { repo, candidate } = await loadCandidate(slug);

  const ts = await repo.dataTimestamp();
  const now = ts ? new Date(ts) : new Date();
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const [mentions, topics, sources, ads, answers, suspicious, rivalRows, crisisAlerts, customTopics, mentionsForTopics] = await Promise.all([
    repo.mentionsSince(candidate.id, since),
    repo.listTopics(candidate.id),
    repo.listCandidateSources(candidate.id),
    repo.listMetaAds(candidate.id),
    repo.listAiAnswers(candidate.id),
    repo.listSuspiciousAccounts(candidate.id),
    repo.listRivals(candidate.id),
    repo.listCrisisAlerts(candidate.id),
    repo.listCustomTopics(candidate.id),
    repo.mentionsSince(candidate.id, new Date(now.getTime() - 30 * 86400000).toISOString()),
  ]);
  const openAlerts = crisisAlerts.filter((a) => a.status === "new" || a.status === "in_review");
  const customStats = customTopics.filter((t) => t.enabled).map((topic) => ({
    topic,
    stats: computeTopicStats(topic, mentionsForTopics, { now, days, timeZone: clock.timeZone }),
  }));
  const d = computeDashboard(mentions, topics, { days, now, timeZone: clock.timeZone });
  const sourceCards = computeHomeCards({
    slug,
    days,
    now,
    mentions,
    topics,
    ads,
    answers,
    suspicious,
    showMetaAds: region.showMetaAds,
  });
  const topicLabel = new Map(topics.map((t) => [t.id, t.label]));
  const classifiedAbout = d.toneAboutCandidate.reduce((s, t) => s + t.count, 0);
  const negPct = classifiedAbout ? Math.round((d.negativeAboutCandidate / classifiedAbout) * 100) : 0;
  const active = sources.filter((s) => s.enabled);
  const started = active.map((s) => s.collection_started_at).filter(Boolean).sort()[0] ?? null;
  const maxTopic = Math.max(1, ...d.topTopics.map((t) => t.count));
  const maxOutlet = Math.max(1, ...d.topOutlets.map((o) => o.count));
  const maxTone = Math.max(1, ...d.toneAboutCandidate.map((t) => t.count));
  const maxSource = Math.max(1, ...d.bySource.map((s) => s.count));
  const rivalNames: string[] = [];
  for (const row of rivalRows) {
    const rival = await repo.getCandidateById(row.rival_id);
    if (rival) rivalNames.push(rival.name);
  }


  return (
    <>
      <PageHeader
        title={`Tablero · ${candidate.name}`}
        description={`Últimos ${days} días · ${active.length} fuentes activas (${active.map((s) => sourceLabel(s.source)).join(", ")}) · actualizado ${formatDateTime(now.toISOString(), clock)} (${clock.tzLabel})`}
      >
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm shadow-sm">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/c/${slug}?dias=${p}`}
              className={`rounded-md px-3 py-1.5 font-medium ${p === days ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {p} días
            </Link>
          ))}
        </div>
      </PageHeader>

      {rivalNames.length ? (
        <Card
          title="Comparación con rivales"
          subtitle="Vista armada por el equipo de Active, con los datos que Pulso ya recolecta."
        >
          <p className="text-sm text-slate-700">
            {rivalNames.length === 1
              ? `Hay una comparación lista frente a ${rivalNames[0]}.`
              : `Hay comparaciones listas frente a ${rivalNames.join(", ")}.`}
          </p>
          <p className="mt-3">
            <Link href={`/c/${slug}/comparacion`} className="text-sm font-medium text-indigo-700 hover:underline">
              Abrir la comparación
            </Link>
          </p>
        </Card>
      ) : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title={ACCION_SECTION_LABEL} subtitle="Bandeja de alertas del equipo de agentes. Una persona decide; Pulso no publica.">
          <p className="text-sm text-slate-700">
            {openAlerts.length
              ? `Hay ${openAlerts.length} alerta${openAlerts.length === 1 ? "" : "s"} pendiente${openAlerts.length === 1 ? "" : "s"} de una decisión humana.`
              : "No hay alertas pendientes."}
          </p>
          <p className="mt-3">
            <Link href={`/c/${slug}/accion`} className="text-sm font-medium text-indigo-700 hover:underline">
              Abrir {ACCION_SECTION_LABEL.toLowerCase()}
            </Link>
          </p>
        </Card>
        <Card title={CUSTOM_TOPICS_SECTION_LABEL} subtitle="Temáticas definidas a mano, con un analista por tema.">
          {customStats.length === 0 ? (
            <p className="text-sm text-slate-700">Todavía no hay temas a medida cargados para este candidato.</p>
          ) : (
            <ul className="space-y-1 text-sm text-slate-700">
              {customStats.slice(0, 4).map(({ topic, stats }) => (
                <li key={topic.id}>
                  <span className="font-medium text-slate-900">{topic.name}.</span> {stats.volume} menciones en el período
                  {stats.spike ? " · posible pico" : ""}.
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3">
            <Link href={`/c/${slug}/temas`} className="text-sm font-medium text-indigo-700 hover:underline">
              Abrir {CUSTOM_TOPICS_SECTION_LABEL.toLowerCase()}
            </Link>
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Menciones" value={d.total} hint={`${d.last24h} en las últimas 24 h`} />
        <Stat label="Sobre él" value={d.aboutCandidate} hint={`${d.aboutOthers} sobre otros · ${d.unclear} poco claras`} />
        <Stat
          label="Críticas y acusaciones"
          value={d.negativeAboutCandidate}
          tone={d.negativeAboutCandidate > 0 ? "negative" : "default"}
          hint={`${negPct}% de lo clasificado sobre él`}
        />
        <Stat label="A favor" value={d.positiveAboutCandidate} tone="positive" hint={`${d.pending} menciones esperando clasificación`} />
      </div>

      <SourceSummaryCards cards={sourceCards} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Volumen de menciones por día" subtitle={`Días en ${clock.tzLabel}. Solo menciones de terceros.`} className="lg:col-span-2">
          <VolumeChart data={d.volume} clock={clock} />
        </Card>
        <Card title="Tono sobre el candidato" subtitle="Solo menciones cuyo objetivo es él (target = candidato).">
          <div className="space-y-3">
            {d.toneAboutCandidate.map((t) => (
              <HBar key={t.tone} label={TONE_LABEL[t.tone]} value={t.count} max={maxTone} barClass={TONE_BAR[t.tone]} />
            ))}
          </div>
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            No cuentan en contra: {d.aboutOthers} menciones dirigidas a otros
            {d.criticismOfOthers > 0 && ` (${d.criticismOfOthers} son críticas de él o su entorno hacia terceros)`} y {d.unclear} con
            objetivo poco claro.
          </p>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Menciones por fuente" subtitle="Todas las menciones de terceros del período.">
          {d.bySource.length === 0 ? (
            <EmptyState>Sin menciones en el período.</EmptyState>
          ) : (
            <div className="space-y-3">
              {d.bySource.map((s) => (
                <HBar
                  key={s.source}
                  label={
                    <Link href={`/c/${slug}/menciones?source=${s.source}`} className="hover:text-indigo-700">
                      {sourceLabel(s.source)}
                    </Link>
                  }
                  value={s.count}
                  max={maxSource}
                  barClass={SOURCE_BAR[s.source] ?? SOURCE_BAR_DEFAULT}
                  extra={s.negative > 0 ? <span className="ml-1.5 text-xs text-rose-600">({s.negative} neg.)</span> : null}
                />
              ))}
            </div>
          )}
        </Card>
        {d.topYoutubeVideos.length > 0 && (
          <Card
            title="Videos más vistos"
            subtitle="YouTube, ordenados por cantidad de vistas al recolectarlos."
            className="lg:col-span-2"
            action={
              <Link href={`/c/${slug}/menciones?source=youtube`} className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
                Ver YouTube →
              </Link>
            }
          >
            <ul className="divide-y divide-slate-100">
              {d.topYoutubeVideos.map(({ mention: m, views }) => {
                const videoId = youtubeVideoId(m);
                const thumb = videoId ? youtubeThumbnailUrl(videoId) : null;
                return (
                  <li key={m.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    {thumb && (
                      <Link href={`/c/${slug}/menciones/${m.id}`} className="shrink-0 overflow-hidden rounded-md bg-slate-200">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumb} alt="" width={96} height={54} className="h-[54px] w-[96px] object-cover" />
                      </Link>
                    )}
                    <div className="min-w-0 flex-1">
                      <Link href={`/c/${slug}/menciones/${m.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">
                        {m.title ?? "(sin título)"}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {m.author ?? m.outlet ?? "YouTube"}
                        {m.author && m.outlet && m.author !== m.outlet ? ` · ${m.outlet}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-slate-900">{formatCount(views)}</p>
                      <p className="text-[11px] text-slate-500">vistas</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          title="Críticas y acusaciones"
          subtitle="Dirigidas a él, ordenadas por relevancia y fecha."
          className="lg:col-span-2"
          action={
            <Link href={`/c/${slug}/menciones?target=candidate&tone=negativas`} className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
              Ver todas →
            </Link>
          }
        >
          {d.highlights.length === 0 ? (
            <EmptyState>No hay críticas ni acusaciones dirigidas a él en el período.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.highlights.map((m) => (
                <MentionRow key={m.id} m={m} slug={slug} topicLabel={m.topic_id ? topicLabel.get(m.topic_id) : undefined} />
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Temas principales" subtitle="Menciones clasificadas por tema.">
            {d.topTopics.length === 0 ? (
              <EmptyState>Sin menciones clasificadas.</EmptyState>
            ) : (
              <div className="space-y-3">
                {d.topTopics.map((t) => (
                  <HBar
                    key={t.topicId ?? "none"}
                    label={
                      t.topicId ? (
                        <Link href={`/c/${slug}/menciones?topic=${t.topicId}`} className="hover:text-indigo-700">{t.label}</Link>
                      ) : t.label
                    }
                    value={t.count}
                    max={maxTopic}
                    extra={t.negative > 0 ? <span className="ml-1.5 text-xs text-rose-600">({t.negative} neg.)</span> : null}
                  />
                ))}
              </div>
            )}
          </Card>
          <Card title="Medios con más menciones">
            <div className="space-y-3">
              {d.topOutlets.map((o) => (
                <HBar
                  key={o.outlet}
                  label={o.outlet}
                  value={o.count}
                  max={maxOutlet}
                  barClass="bg-slate-400"
                  extra={o.negative > 0 ? <span className="ml-1.5 text-xs text-rose-600">({o.negative} neg.)</span> : null}
                />
              ))}
            </div>
          </Card>
        </div>
      </div>

      <p className="mt-6 text-xs text-slate-500">
        Cobertura parcial: la recolección continua arrancó {started ? `el ${formatDateTime(started, clock)} (${clock.tzLabel})` : "hace pocos días"}.
        Los días anteriores pueden estar incompletos. Negativas = {NEGATIVE_TONES.map((t) => TONE_LABEL[t].toLowerCase()).join(", ")} con objetivo en él.
        La clasificación es automática (IA) y puede tener errores.
      </p>
    </>
  );
}
