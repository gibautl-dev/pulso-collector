import { Card, EmptyState, PageHeader, RunStatusBadge } from "@/components/ui";
import { computeSourceHealth } from "@/lib/analytics";
import { loadCandidate } from "@/lib/context";
import { sourceLabel } from "@/lib/labels";
import { GOOGLE_ADS_EXAMPLE_BANNER, GOOGLE_ADS_SPAIN_PENDING, SOURCE_LABEL as GOOGLE_SOURCE_LABEL } from "@/lib/google-ads";
import { computeGoogleAdsHealth } from "@/lib/google-ads-health";
import { computeMetaAdsHealth } from "@/lib/meta-ads-health";
import { regionFor } from "@/lib/region";
import { clockFor, durationSeconds, formatDateTime, relativeTime } from "@/lib/time";

export const metadata = { title: "Salud de fuentes · Pulso" };

const COVERAGE: Record<string, string> = { unknown: "Desconocida", partial: "Parcial", complete: "Completa" };

export default async function SourcesPage({ params }: PageProps<"/c/[slug]/fuentes">) {
  const { slug } = await params;
  const clock = clockFor(slug);
  const { repo, candidate } = await loadCandidate(slug);
  const [runs, sources, ads, adsSettings, googleAds, googleSettings, ts] = await Promise.all([
    repo.listSourceRuns(candidate.id, 40),
    repo.listCandidateSources(candidate.id),
    repo.listMetaAds(candidate.id),
    repo.listMetaAdsSettings(candidate.id),
    repo.listGoogleAds(candidate.id),
    repo.listGoogleAdsSettings(candidate.id),
    repo.dataTimestamp(),
  ]);
  const now = ts ? new Date(ts) : new Date();
  const health = computeSourceHealth(runs, now);
  const enabled = sources.filter((s) => s.enabled);
  const disabled = sources.filter((s) => !s.enabled);
  const metaHealth = computeMetaAdsHealth(ads, adsSettings, {
    now,
    showMetaAds: regionFor(slug).showMetaAds,
  });
  const googleHealth = computeGoogleAdsHealth(googleAds, googleSettings, {
    pendingReason: slug === "pedro-sanchez" ? GOOGLE_ADS_SPAIN_PENDING : null,
  });

  return (
    <>
      <PageHeader
        title="Salud de fuentes"
        description={`El recolector corre cada 20 minutos. Horarios en ${clock.tzLabel}.`}
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
                Recolectando desde {formatDateTime(s.collection_started_at, clock)} · datos vistos desde {formatDateTime(s.earliest_observed_at, clock)}
              </p>
            </Card>
          );
        })}
      </div>

      <div className="mt-4">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{sourceLabel("meta_ads")}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {metaHealth.applicable
                  ? "Job propio, no pasa por source_runs del recolector de 20 minutos."
                  : "Anuncios políticos de Meta."}
              </p>
            </div>
            {metaHealth.applicable ? (
              metaHealth.lastSuccessAt ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">OK</span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">Sin corrida</span>
              )
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">No aplica</span>
            )}
          </div>
          {metaHealth.applicable ? (
            <>
              <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Último éxito</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">
                    {metaHealth.lastSuccessAt
                      ? formatDateTime(metaHealth.lastSuccessAt, clock)
                      : "Sin dato"}
                  </dd>
                  {metaHealth.lastSuccessAt ? (
                    <p className="mt-0.5 text-xs text-slate-500">{clock.tzLabel}</p>
                  ) : null}
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Anuncios última corrida</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{metaHealth.adsLastRun ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Anuncios 7 días</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{metaHealth.adsLast7d ?? "—"}</dd>
                </div>
              </dl>
              {metaHealth.lastError ? (
                <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 font-mono text-xs text-amber-900">Último aviso: {metaHealth.lastError}</p>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  No hay un registro de error en la base: el job no guarda fallos en tablas, solo en los logs del cron.
                </p>
              )}
            </>
          ) : (
            <p className="mt-4 text-sm text-slate-700">{metaHealth.unavailableReason}</p>
          )}
        </Card>
      </div>

      <div className="mt-4" id="salud-google-ads">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{sourceLabel("google_ads")}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {googleSettings?.source
                  ? GOOGLE_SOURCE_LABEL[googleSettings.source]
                  : "Job propio, no pasa por source_runs del recolector de 20 minutos."}
              </p>
            </div>
            {googleHealth.lastSuccessAt ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">OK</span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">Sin corrida</span>
            )}
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Último éxito</dt>
              <dd className="mt-0.5 font-medium text-slate-900">
                {googleHealth.lastSuccessAt
                  ? formatDateTime(googleHealth.lastSuccessAt, clock)
                  : "Sin dato"}
              </dd>
              {googleHealth.lastSuccessAt ? (
                <p className="mt-0.5 text-xs text-slate-500">{clock.tzLabel}</p>
              ) : null}
            </div>
            <div>
              <dt className="text-xs text-slate-500">Anuncios última captura</dt>
              <dd className="mt-0.5 font-medium text-slate-900">{googleHealth.totalAds || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Anunciantes</dt>
              <dd className="mt-0.5 font-medium text-slate-900">{googleHealth.advertiserCount || "—"}</dd>
            </div>
          </dl>
          {googleHealth.pendingReason ? (
            <p className="mt-3 text-sm text-slate-700">{googleHealth.pendingReason}</p>
          ) : repo.mode === "fixture" && googleAds.length > 0 ? (
            <p className="mt-3 text-xs text-slate-500">{GOOGLE_ADS_EXAMPLE_BANNER}</p>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              Ruta oficial solamente. El job no está cableado al cron todavía.
            </p>
          )}
        </Card>
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
                      <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-slate-700">{formatDateTime(r.started_at, clock)}</td>
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
