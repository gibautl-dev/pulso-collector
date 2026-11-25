import Link from "next/link";
import { Card, EmptyState, HBar, PageHeader, Stat } from "@/components/ui";
import { MentionRow } from "@/components/mention-row";
import { MentionFeedItem } from "@/components/mention-feed";
import { VolumeChart } from "@/components/volume-chart";
import { computeDashboard } from "@/lib/analytics";
import { formatPeriodChange, periodChange } from "@/lib/volume-peak";
import { loadCandidate } from "@/lib/context";
import { NEGATIVE_TONES, SOURCE_BAR, SOURCE_BAR_DEFAULT, sourceLabel, TONE_BAR, TONE_LABEL } from "@/lib/labels";
import { regionFor } from "@/lib/region";
import { clockFor, formatDateTime } from "@/lib/time";
import { formatCount, youtubeThumbnailUrl, youtubeVideoId } from "@/lib/youtube";
import { computeHomeCards } from "@/lib/home-summaries";
import { SourceSummaryCards } from "@/components/source-summary-cards";
import { computeTopicStats } from "@/lib/custom-topics";
import { mentionHeadline } from "@/lib/mention-excerpt";
import {
  alertHeadline,
  comparisonSpotlight,
  pendingAlerts,
  pickHighestRiskAlert,
  pickTopCustomTopic,
} from "@/lib/home-spotlights";
import {
  ActionSpotlightCard,
  ComparisonSpotlightCard,
  CustomTopicsSpotlightCard,
} from "@/components/home-spotlight-cards";

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
  const sincePrevious = new Date(now.getTime() - days * 2 * 86400000).toISOString();
  const [mentions, topics, sources, ads, answers, suspicious, rivalRows, crisisAlerts, customTopics, mentionsForTopics] = await Promise.all([
    repo.mentionsSince(candidate.id, sincePrevious),
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
  const customStats = customTopics.filter((t) => t.enabled).map((topic) => ({
    topic,
    stats: computeTopicStats(topic, mentionsForTopics, { now, days, timeZone: clock.timeZone }),
  }));
  const d = computeDashboard(mentions, topics, { days, now, timeZone: clock.timeZone });
  const previous = computeDashboard(mentions, topics, {
    days,
    now: new Date(now.getTime() - days * 86400000),
    timeZone: clock.timeZone,
  });
  const wow = periodChange(d.total, previous.total);
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
  const posPct = classifiedAbout ? Math.round((d.positiveAboutCandidate / classifiedAbout) * 100) : 0;
  const latestMentions = [...mentions]
    .filter((m) => m.account_relation === "third_party" && new Date(m.published_at).getTime() >= new Date(since).getTime())
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .slice(0, 8);
  const active = sources.filter((s) => s.enabled);
  const started = active.map((s) => s.collection_started_at).filter(Boolean).sort()[0] ?? null;
  const maxTopic = Math.max(1, ...d.topTopics.map((t) => t.count));
  const maxOutlet = Math.max(1, ...d.topOutlets.map((o) => o.count));
  const maxTone = Math.max(1, ...d.toneAboutCandidate.map((t) => t.count));
  const maxSource = Math.max(1, ...d.bySource.map((s) => s.count));
  const resolvedRivals = [];
  for (const row of rivalRows) {
    const rival = await repo.getCandidateById(row.rival_id);
    if (!rival) continue;
    const rivalMentions = await repo.mentionsSince(rival.id, sincePrevious);
    const currentDash = computeDashboard(rivalMentions, [], { days, now, timeZone: clock.timeZone });
    const previousDash = computeDashboard(rivalMentions, [], {
      days,
      now: new Date(now.getTime() - days * 86400000),
      timeZone: clock.timeZone,
    });
    resolvedRivals.push({
      id: rival.id,
      name: rival.name,
      slug: rival.slug,
      mentions: currentDash.total,
      previousMentions: previousDash.total,
    });
  }
  const spotlight = comparisonSpotlight({
    candidate,
    rivals: resolvedRivals,
    candidateMentions: d.total,
    candidatePreviousMentions: previous.total,
    days,
  });
  const openPending = pendingAlerts(crisisAlerts);
  const topAlert = pickHighestRiskAlert(crisisAlerts);
  const topCustom = pickTopCustomTopic(customStats);


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

      <div data-testid="tablero-kpis" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Menciones"
          value={d.total}
          hint={`${formatPeriodChange(wow.percent, days)} · ${d.last24h} en las últimas 24 h`}
        />
        <Stat label="Sobre él" value={d.aboutCandidate} hint={`${d.aboutOthers} sobre otros · ${d.unclear} poco claras`} />
        <Stat
          label="Críticas y acusaciones"
          value={classifiedAbout ? `${negPct}%` : "—"}
          tone={negPct > 0 ? "negative" : "default"}
          hint={classifiedAbout ? `${d.negativeAboutCandidate} de lo clasificado sobre él` : "Sin menciones clasificadas sobre él"}
        />
        <Stat
          label="A favor"
          value={classifiedAbout ? `${posPct}%` : "—"}
          tone="positive"
          hint={classifiedAbout ? `${d.positiveAboutCandidate} de lo clasificado sobre él · ${d.pending} sin clasificar` : "Sin menciones clasificadas sobre él"}
        />
      </div>

      <div data-testid="tablero-source-cards"><SourceSummaryCards cards={sourceCards} /></div>

      <div data-testid="tablero-volume-tone" className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Volumen de menciones por día" subtitle={`Medios, X y YouTube · ${clock.tzLabel}. Solo menciones de terceros.`} className="lg:col-span-2">
          <VolumeChart data={d.volume} clock={clock} />
        </Card>
        <Card title="Tono sobre el candidato" subtitle="Clasificado con IA. Solo menciones cuyo objetivo es él.">
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
        <Card
          testId="ultimas-menciones"
          title="Últimas menciones"
          subtitle="Las más recientes del período, de terceros."
          className="lg:col-span-2"
          action={
            <span className="flex items-center gap-3">
              {d.last24h > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  En vivo
                </span>
              ) : null}
              <Link href={`/c/${slug}/menciones`} className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
                Ver todas →
              </Link>
            </span>
          }
        >
          {latestMentions.length === 0 ? (
            <EmptyState>No hay menciones en el período.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-50">
              {latestMentions.map((m) => (
                <MentionFeedItem key={m.id} m={m} slug={slug} now={now} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {d.topYoutubeVideos.length > 0 ? (
        <div className="mt-6">
          <Card
            title="Videos más vistos"
            subtitle="YouTube, ordenados por cantidad de vistas al recolectarlos."
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
                        {mentionHeadline(m)}
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
        </div>
      ) : null}

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

      <div data-testid="tablero-spotlights" className="mt-6 grid gap-4 lg:grid-cols-3">
        <ComparisonSpotlightCard slug={slug} spotlight={spotlight} />
        <ActionSpotlightCard
          slug={slug}
          pendingCount={openPending.length}
          headline={topAlert ? alertHeadline(topAlert) : null}
          severity={topAlert?.severity ?? null}
        />
        <CustomTopicsSpotlightCard
          slug={slug}
          topicName={topCustom?.topic.name ?? null}
          volume={topCustom?.stats.volume ?? 0}
          spike={topCustom?.stats.spike ?? false}
          empty={customStats.length === 0}
        />
      </div>

      <p className="mt-6 text-xs text-slate-500">
        Cobertura parcial: la recolección continua arrancó {started ? `el ${formatDateTime(started, clock)} (${clock.tzLabel})` : "hace pocos días"}.
        Los días anteriores pueden estar incompletos. Negativas = {NEGATIVE_TONES.map((t) => TONE_LABEL[t].toLowerCase()).join(", ")} con objetivo en él.
        La clasificación es automática (IA) y puede tener errores.
      </p>
    </>
  );
}
