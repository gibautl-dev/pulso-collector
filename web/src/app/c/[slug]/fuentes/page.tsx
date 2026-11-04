import { Card, EmptyState, PageHeader, RunStatusBadge } from "@/components/ui";
import { computeSourceHealth } from "@/lib/analytics";
import { loadCandidate } from "@/lib/context";
import { sourceLabel } from "@/lib/labels";
import { durationSeconds, formatDateTime, relativeTime, TZ_LABEL } from "@/lib/time";

export const metadata = { title: "Salud de fuentes · Pulso" };

const COVERAGE: Record<string, string> = { unknown: "Desconocida", partial: "Parcial", complete: "Completa" };

export default async function SourcesPage({ params }: PageProps<"/c/[slug]/fuentes">) {
  const { slug } = await params;
  const { repo, candidate } = await loadCandidate(slug);
  const [runs, sources, ts] = await Promise.all([
    repo.listSourceRuns(candidate.id, 40),
    repo.listCandidateSources(candidate.id),
    repo.dataTimestamp(),
  ]);
  const now = ts ? new Date(ts) : new Date();
  const health = computeSourceHealth(runs, now);
  const enabled = sources.filter((s) => s.enabled);
  const disabled = sources.filter((s) => !s.enabled);

  return (
    <>
      <PageHeader
        title="Salud de fuentes"
        description={`El recolector corre cada 20 minutos. Horarios en ${TZ_LABEL}.`}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {enabled.map((s) => {
          const h = health.find((x) => x.source === s.source);
          return (
            <Card key={s.source}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{sourceLabel(s.source)}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Cada {Math.round(s.interval_seconds / 60)} min · cobertura {COVERAGE[s.coverage_status].toLowerCase()}
                  </p>
                </div>
                {h?.lastRun ? <RunStatusBadge status={h.lastRun.status as never} /> : null}
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Último éxito</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{relativeTime(s.last_success_at, now)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Corridas 24 h</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">
                    {h ? `${h.ok24h} ok · ${h.partial24h} parc. · ${h.error24h} err.` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Nuevas 24 h</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{h?.new24h ?? 0}</dd>
                </div>
              </dl>
              {h?.lastRun?.error && (
                <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 font-mono text-xs text-amber-900">Último aviso: {h.lastRun.error}</p>
              )}
              <p className="mt-3 text-xs text-slate-500">
                Recolectando desde {formatDateTime(s.collection_started_at)} · datos vistos desde {formatDateTime(s.earliest_observed_at)}
              </p>
            </Card>
          );
        })}
      </div>

      <Card title="Últimas corridas" subtitle="Registro de source_runs, más recientes primero." className="mt-6">
        {runs.length === 0 ? (
          <EmptyState>Todavía no hay corridas registradas.</EmptyState>
        ) : (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Inicio</th>
                  <th className="px-3 py-2.5 font-medium">Fuente</th>
                  <th className="px-3 py-2.5 font-medium">Estado</th>
                  <th className="px-3 py-2.5 text-right font-medium">Encontradas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Nuevas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Duración</th>
                  <th className="px-5 py-2.5 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => {
                  const dur = durationSeconds(r.started_at, r.finished_at);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-slate-700">{formatDateTime(r.started_at)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-900">{sourceLabel(r.source)}</td>
                      <td className="px-3 py-2.5"><RunStatusBadge status={r.status} /></td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.items_found}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium">{r.items_new}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{dur === null ? "—" : `${dur} s`}</td>
                      <td className="max-w-xs truncate px-5 py-2.5 font-mono text-xs text-slate-500" title={r.error ?? ""}>
                        {r.error ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {disabled.length > 0 && (
        <p className="mt-6 text-xs text-slate-500">
          Fuentes desactivadas: {disabled.map((s) => sourceLabel(s.source)).join(", ")}. Activarlas requiere configuración y
          validar cuotas/costos antes.
        </p>
      )}
    </>
  );
}
