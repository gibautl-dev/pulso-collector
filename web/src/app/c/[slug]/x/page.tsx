import Link from "next/link";
import { Card, EmptyState, HBar, PageHeader, Stat } from "@/components/ui";
import { VolumeChart } from "@/components/volume-chart";
import { XPostCard } from "@/components/x-post";
import { loadCandidate } from "@/lib/context";
import { TONE_BAR, TONE_LABEL } from "@/lib/labels";
import { clockFor, formatDateTime } from "@/lib/time";
import { formatCount } from "@/lib/youtube";
import { balanceTone, computeXView, formatBalance } from "@/lib/x-posts";

export const metadata = { title: "En X · Pulso" };

const PERIODS = [7, 14, 30];

export default async function XPostsPage({ params, searchParams }: PageProps<"/c/[slug]/x">) {
  const { slug } = await params;
  const clock = clockFor(slug);
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.dias)) ? Number(sp.dias) : 7;
  const { repo, candidate } = await loadCandidate(slug);
  const ts = await repo.dataTimestamp();
  const now = ts ? new Date(ts) : new Date();
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const [mentions, runs] = await Promise.all([
    repo.mentionsSince(candidate.id, since),
    repo.listSourceRuns(candidate.id, 40),
  ]);
  const view = computeXView(mentions, { days, now, timeZone: clock.timeZone });
  const lastRun = runs.find((r) => r.source === "x" && r.finished_at)?.finished_at ?? null;
  const lastRunLabel = lastRun
    ? `Última recolección: ${formatDateTime(lastRun, clock)} (${clock.tzLabel}).`
    : "Todavía no hay una recolección de X registrada.";
  const maxTone = Math.max(1, ...view.toneAboutCandidate.map((t) => t.count));
  const maxAuthor = Math.max(1, ...view.topAuthors.map((a) => a.posts));
  const daysWithPosts = view.volume.filter((d) => d.total > 0).length;

  return (
    <>
      <PageHeader
        title="En X"
        description={`Posts en X sobre ${candidate.name}. Últimos ${days} días. ${lastRunLabel}`}
      >
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm shadow-sm">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/c/${slug}/x?dias=${p}`}
              className={`rounded-md px-3 py-1.5 font-medium ${p === days ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {p} días
            </Link>
          ))}
        </div>
      </PageHeader>

      <p className="mb-6 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        Esta pantalla muestra posts originales en español recolectados con la API oficial de X. El recolector no pide
        retweets ni respuestas; si alguno quedó marcado en los datos, se ve con una etiqueta. Las métricas (me gusta,
        reposts, impresiones) son las que informó X al momento de recolectar. El job de X corre junto con las otras
        fuentes, cada 20 minutos, con un tope diario.
        {repo.mode === "fixture" ? " Este render es local, con datos exportados, y no es una captura de producción." : null}
      </p>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Posts" value={view.total} hint={`${view.last24h} en las últimas 24 h`} />
        <Stat label="Autores" value={view.authors} hint={`${view.aboutCandidate} posts sobre él`} />
        <Stat
          label="Balance sobre él"
          value={view.balance == null ? "—" : formatBalance(view.balance)}
          tone={balanceTone(view.balance)}
          hint={
            view.classifiedAboutCandidate
              ? `${view.positiveAboutCandidate} a favor · ${view.negativeAboutCandidate} críticas o acusaciones`
              : "Todavía no hay posts clasificados sobre el candidato"
          }
        />
        <Stat
          label="A favor"
          value={view.positiveAboutCandidate}
          tone="positive"
          hint={view.pending ? `${view.pending} sin clasificar` : "Todos los posts de este período están clasificados"}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card
          title="Posts por día"
          subtitle={`Días en ${clock.tzLabel}. Solo posts de cuentas de terceros.`}
          className="lg:col-span-2"
        >
          {view.total === 0 ? (
            <EmptyState>
              Todavía no hay posts de X en este período. Cuando el recolector los traiga, acá vas a ver el volumen de
              cada día.
            </EmptyState>
          ) : (
            <div>
              {daysWithPosts <= 1 ? (
                <p className="mb-4 text-sm text-slate-600">
                  Por ahora la serie tiene un solo día con datos. Las barras se van a completar solas a medida que
                  entren posts de más días.
                </p>
              ) : null}
              <VolumeChart data={view.volume} clock={clock} />
            </div>
          )}
        </Card>
        <Card title="Tono sobre el candidato" subtitle="Solo posts cuyo objetivo es él.">
          {view.classifiedAboutCandidate === 0 ? (
            <EmptyState>Todavía no hay posts clasificados sobre el candidato.</EmptyState>
          ) : (
            <div className="space-y-3">
              {view.toneAboutCandidate.map((t) => (
                <HBar key={t.tone} label={TONE_LABEL[t.tone]} value={t.count} max={maxTone} barClass={TONE_BAR[t.tone]} />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Autores con más posts" subtitle="Cuentas de terceros, ordenadas por cantidad de posts en el período." className="mb-6">
        {view.topAuthors.length === 0 ? (
          <EmptyState>Todavía no hay autores para mostrar.</EmptyState>
        ) : (
          <div className="space-y-3">
            {view.topAuthors.map((a) => {
              const handle = a.handle ? <span className="font-normal text-slate-500"> @{a.handle}</span> : null;
              const followers =
                a.followers != null ? (
                  <span className="font-normal text-slate-400"> · {formatCount(a.followers)} seguidores</span>
                ) : null;
              const name = (
                <>
                  {a.name}
                  {handle}
                  {followers}
                </>
              );
              const label = a.profileUrl ? (
                <a href={a.profileUrl} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-indigo-700">
                  {name}
                </a>
              ) : (
                name
              );
              return <HBar key={a.key} label={label} value={a.posts} max={maxAuthor} barClass="bg-zinc-800" />;
            })}
          </div>
        )}
      </Card>

      <Card
        title="Posts con más interacción"
        subtitle="Ordenados por la suma de me gusta, reposts, respuestas, citas y guardados al momento de recolectar."
        className="mb-6"
      >
        {view.mostEngaged.length === 0 ? (
          <EmptyState>Todavía no hay posts de X en este período.</EmptyState>
        ) : view.mostEngaged.every((m) => !m.metrics) ? (
          <EmptyState>Estos posts no tienen métricas de interacción guardadas.</EmptyState>
        ) : (
          <ul>
            {view.mostEngaged.map((m) => (
              <XPostCard key={m.id} m={m} slug={slug} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Posts recientes" subtitle="Los más nuevos del período, con enlace al post original en X.">
        {view.recent.length === 0 ? (
          <EmptyState>
            Todavía no hay posts de X. El recolector busca posts originales en español y los guarda acá después de cada
            corrida.
            {" "}
            {lastRunLabel}
          </EmptyState>
        ) : (
          <ul>
            {view.recent.map((m) => (
              <XPostCard key={m.id} m={m} slug={slug} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
