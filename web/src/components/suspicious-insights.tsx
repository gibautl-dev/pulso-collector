import { Badge, Card, EmptyState, HBar, Stat } from "@/components/ui";
import { suspiciousAccountLabel, suspiciousSignalLabel } from "@/lib/labels";
import {
  balanceTone,
  formatBalance,
  formatPercent,
  type GroupedReason,
  type SentimentSplit,
  type SuspiciousInsights,
} from "@/lib/suspicious-insights";
import { clockFor, formatDateTime, type Clock } from "@/lib/time";

function SentimentCard({ title, subtitle, split }: { title: string; subtitle: string; split: SentimentSplit }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          balanceTone(split.balance) === "negative"
            ? "text-rose-600"
            : balanceTone(split.balance) === "positive"
              ? "text-emerald-600"
              : "text-slate-900"
        }`}
      >
        {split.balance == null ? "—" : formatBalance(split.balance)}
      </p>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      <p className="mt-2 text-xs text-slate-600">
        {split.positive} a favor · {split.negative} críticas o acusaciones
        {split.classifiedAbout ? ` · ${split.classifiedAbout} sobre él` : ""}
      </p>
    </div>
  );
}

function ReasonsBlock({ reasons, clock }: { reasons: GroupedReason[]; clock: Clock }) {
  if (reasons.every((r) => r.accounts.length === 0)) {
    return <EmptyState>Todavía no hay señales agrupadas para mostrar.</EmptyState>;
  }
  return (
    <div className="space-y-6">
      {reasons.map((reason) => (
        <div key={reason.id}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{reason.label}</h3>
            <span className="text-xs tabular-nums text-slate-500">
              {reason.accounts.length} {reason.accounts.length === 1 ? "cuenta" : "cuentas"}
            </span>
          </div>
          <p className="mb-3 text-xs text-slate-500">{reason.hint}</p>
          {reason.accounts.length === 0 ? (
            <p className="text-sm text-slate-500">Ninguna cuenta de este período entra en esta categoría.</p>
          ) : (
            <ul className="space-y-3">
              {reason.accounts.map(({ account, signals }) => (
                <li key={account.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="text-sm font-medium text-slate-900">
                    {suspiciousAccountLabel(account)}
                    <span className="ml-2 text-xs font-normal text-slate-500">puntaje {account.score}</span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {signals.map((sig) => (
                      <Badge key={`${sig.type}-${sig.weight}`} className="bg-white text-slate-700 ring-slate-300">
                        {suspiciousSignalLabel(sig.type)} · {sig.weight}
                      </Badge>
                    ))}
                  </div>
                  <ul className="mt-2 space-y-1">
                    {signals.flatMap((sig) =>
                      sig.evidence.slice(0, 3).map((ev) => (
                        <li key={`${sig.type}-${ev.mention_id}`} className="text-xs text-slate-600">
                          <span className="text-slate-400">{formatDateTime(ev.published_at, clock)} ({clock.tzLabel}) · </span>
                          {ev.url ? (
                            <a href={ev.url} target="_blank" rel="noopener noreferrer nofollow" className="text-indigo-600 hover:text-indigo-500">
                              {ev.excerpt || "Ver mención"}
                            </a>
                          ) : (
                            ev.excerpt || ev.mention_id
                          )}
                        </li>
                      )),
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export function SuspiciousInsightsPanel({ insights, slug }: { insights: SuspiciousInsights; slug: string }) {
  const clock = clockFor(slug);
  if (!insights.sufficient) {
    return (
      <Card title="Lectura de la conversación" subtitle="Evidencia para revisión humana. Pulso no denuncia en automático ni en lote." className="mb-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">Datos insuficientes</p>
          <p className="mt-1">{insights.insufficientReason}</p>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Posts y comentarios" value={insights.posts} hint="X y comentarios de YouTube de terceros" />
          <Stat label="Autores" value={insights.authors} />
          <Stat label="Cuentas marcadas" value={insights.flaggedAuthors} hint="Sin contar las descartadas" />
          <Stat label="Publicaciones de esas cuentas" value={insights.flaggedPosts} />
        </div>
      </Card>
    );
  }

  const maxTopic = Math.max(1, ...insights.topics.map((t) => t.overall), ...insights.topics.map((t) => t.flagged));

  return (
    <div className="mb-6 space-y-6">
      <Card
        title="Participación en la conversación"
        subtitle="Qué parte de los autores y de los posts o comentarios del período corresponde a cuentas marcadas. Solo X y comentarios de YouTube de terceros. Las cuentas descartadas no cuentan."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Autores marcados"
            value={insights.authorShare == null ? "—" : formatPercent(insights.authorShare)}
            hint={`${insights.flaggedAuthors} de ${insights.authors} autores`}
          />
          <Stat
            label="Posts o comentarios de esas cuentas"
            value={insights.postShare == null ? "—" : formatPercent(insights.postShare)}
            hint={`${insights.flaggedPosts} de ${insights.posts}`}
          />
          <Stat label="Cuentas marcadas" value={insights.flaggedAuthors} hint="Pendientes o revisadas, no descartadas" />
          <Stat label="Conversación del período" value={insights.posts} hint="X y comentarios de YouTube" />
        </div>
      </Card>

      <Card
        title="Motivos agrupados, con evidencia"
        subtitle="Las señales del detector se agrupan en tres lecturas. La evidencia ya estaba guardada; no se denuncia ni se actúa en automático."
      >
        <ReasonsBlock reasons={insights.reasons} clock={clock} />
      </Card>

      <Card
        title="Temas que impulsan las cuentas marcadas"
        subtitle="Comparación con el resto de la conversación, usando el tema que ya asignó el clasificador. Como máximo, los 10 más frecuentes entre las cuentas marcadas."
      >
        {insights.topics.length === 0 ? (
          <EmptyState>No hay temas del clasificador para comparar en este período.</EmptyState>
        ) : (
          <div className="space-y-4">
            {insights.topics.map((t) => (
              <div key={t.topicId ?? "none"}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-slate-800">{t.label}</span>
                  <span className="text-xs tabular-nums text-slate-500">
                    Marcadas: {t.flagged}
                    {insights.flaggedPosts ? ` (${formatPercent((t.flagged / insights.flaggedPosts) * 100)})` : ""}
                    {" · "}
                    Toda la conversación: {t.overall}
                    {insights.posts ? ` (${formatPercent((t.overall / insights.posts) * 100)})` : ""}
                  </span>
                </div>
                <HBar label="Posts de cuentas marcadas" value={t.flagged} max={maxTopic} barClass="bg-rose-500" />
                <div className="mt-1">
                  <HBar label="Toda la conversación" value={t.overall} max={maxTopic} barClass="bg-slate-400" />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Balance de tono con y sin las cuentas marcadas"
        subtitle="Misma regla que en el tablero y en En X: (a favor − críticas, acusaciones e insultos) sobre los posts o comentarios clasificados cuyo objetivo es el candidato. De −100 a +100."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <SentimentCard
            title="Toda la conversación"
            subtitle={`${insights.sentiment.overall.posts} posts o comentarios`}
            split={insights.sentiment.overall}
          />
          <SentimentCard
            title="Solo cuentas marcadas"
            subtitle={`${insights.sentiment.flagged.posts} posts o comentarios`}
            split={insights.sentiment.flagged}
          />
          <SentimentCard
            title="Sin las cuentas marcadas"
            subtitle={`${insights.sentiment.without.posts} posts o comentarios`}
            split={insights.sentiment.without}
          />
        </div>
      </Card>
    </div>
  );
}

