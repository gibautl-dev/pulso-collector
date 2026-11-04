import Link from "next/link";
import { Card, EmptyState, HBar, PageHeader, Stat } from "@/components/ui";
import { MentionRow } from "@/components/mention-row";
import { VolumeChart } from "@/components/volume-chart";
import { computeDashboard } from "@/lib/analytics";
import { loadCandidate } from "@/lib/context";
import { NEGATIVE_TONES, sourceLabel, TONE_BAR, TONE_LABEL } from "@/lib/labels";
import { formatDateTime, TZ_LABEL } from "@/lib/time";

export const metadata = { title: "Tablero · Pulso" };
const PERIODS = [7, 14, 30];

export default async function Dashboard({ params, searchParams }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.dias)) ? Number(sp.dias) : 7;
  const { repo, candidate } = await loadCandidate(slug);

  const ts = await repo.dataTimestamp();
  const now = ts ? new Date(ts) : new Date();
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const [mentions, topics, sources] = await Promise.all([
    repo.mentionsSince(candidate.id, since),
    repo.listTopics(candidate.id),
    repo.listCandidateSources(candidate.id),
  ]);
  const d = computeDashboard(mentions, topics, { days, now });
  const topicLabel = new Map(topics.map((t) => [t.id, t.label]));
  const classifiedAbout = d.toneAboutCandidate.reduce((s, t) => s + t.count, 0);
  const negPct = classifiedAbout ? Math.round((d.negativeAboutCandidate / classifiedAbout) * 100) : 0;
  const active = sources.filter((s) => s.enabled);
  const started = active.map((s) => s.collection_started_at).filter(Boolean).sort()[0] ?? null;
  const maxTopic = Math.max(1, ...d.topTopics.map((t) => t.count));
  const maxOutlet = Math.max(1, ...d.topOutlets.map((o) => o.count));
  const maxTone = Math.max(1, ...d.toneAboutCandidate.map((t) => t.count));

  return (
    <>
      <PageHeader
        title={`Tablero · ${candidate.name}`}
        description={`Últimos ${days} días · ${active.length} fuentes activas (${active.map((s) => sourceLabel(s.source)).join(", ")}) · actualizado ${formatDateTime(now.toISOString())} (${TZ_LABEL})`}
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

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Volumen de menciones por día" subtitle={`Días en ${TZ_LABEL}. Solo menciones de terceros.`} className="lg:col-span-2">
          <VolumeChart data={d.volume} />
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
        Cobertura parcial: la recolección continua arrancó {started ? `el ${formatDateTime(started)} (${TZ_LABEL})` : "hace pocos días"}.
        Los días anteriores pueden estar incompletos. Negativas = {NEGATIVE_TONES.map((t) => TONE_LABEL[t].toLowerCase()).join(", ")} con objetivo en él.
        La clasificación es automática (IA) y puede tener errores.
      </p>
    </>
  );
}
