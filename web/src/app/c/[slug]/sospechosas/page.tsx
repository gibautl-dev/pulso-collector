import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { SuspiciousAccountCard } from "@/components/suspicious-account";
import { SuspiciousInsightsPanel } from "@/components/suspicious-insights";
import { loadCandidate } from "@/lib/context";
import { computeSuspiciousInsights } from "@/lib/suspicious-insights";
import { isSuspiciousPlatform, isSuspiciousStatus, type SuspiciousFilters } from "@/lib/types";
import { clockFor, formatDateTime } from "@/lib/time";

export const metadata = { title: "Cuentas sospechosas · Pulso" };

const PERIODS = [7, 14, 30];

const selectCls =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

function parseSuspiciousFilters(sp: Record<string, string | string[] | undefined>): SuspiciousFilters {
  const status = typeof sp.status === "string" ? sp.status : "";
  const platform = typeof sp.platform === "string" ? sp.platform : "";
  return {
    status: isSuspiciousStatus(status) ? status : undefined,
    platform: isSuspiciousPlatform(platform) ? platform : undefined,
  };
}

export default async function SuspiciousAccountsPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/sospechosas">) {
  const { slug } = await params;
  const clock = clockFor(slug);
  const sp = await searchParams;
  const filters = parseSuspiciousFilters(sp);
  const days = PERIODS.includes(Number(sp.dias)) ? Number(sp.dias) : 7;
  const { repo, candidate } = await loadCandidate(slug);
  const ts = await repo.dataTimestamp();
  const now = ts ? new Date(ts) : new Date();
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const [accounts, allAccounts, runs, mentions, topics] = await Promise.all([
    repo.listSuspiciousAccounts(candidate.id, filters),
    repo.listSuspiciousAccounts(candidate.id),
    repo.listSourceRuns(candidate.id, 20),
    repo.mentionsSince(candidate.id, since),
    repo.listTopics(candidate.id),
  ]);
  const insights = computeSuspiciousInsights(mentions, allAccounts, topics, { days, now });
  const lastRun = runs.find((r) => r.finished_at)?.finished_at ?? null;
  const lastRunLabel = lastRun
    ? `Última recolección: ${formatDateTime(lastRun, clock)} (${clock.tzLabel}).`
    : "Todavía no hay una recolección registrada.";
  const filtered = Boolean(filters.status || filters.platform);
  const base = `/c/${slug}/sospechosas`;
  const periodQuery = days === 7 ? "" : `?dias=${days}`;

  return (
    <>
      <PageHeader
        title="Cuentas sospechosas"
        description={`Revisión humana, sin denuncia automática. Últimos ${days} días. ${lastRunLabel} El detector corre después de cada recolección, cada 20 minutos.`}
      >
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm shadow-sm">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={p === 7 ? base : `${base}?dias=${p}`}
              className={`rounded-md px-3 py-1.5 font-medium ${p === days ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {p} días
            </Link>
          ))}
        </div>
      </PageHeader>

      <p className="mb-6 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        Los bloques de esta pantalla son una lectura de evidencia: qué parte de la conversación en X y en comentarios de
        YouTube corresponde a cuentas marcadas, por qué quedaron marcadas, qué temas impulsan y cómo mueve el tono.
        Pulso no denuncia en lote ni en automático; una persona revisa y, si corresponde, denuncia a mano en la red.
        {repo.mode === "fixture" ? " Este render es local, con datos exportados, y no es una captura de producción." : null}
      </p>

      <SuspiciousInsightsPanel insights={insights} slug={slug} />

      <Card className="mb-6">
        <form method="get" action={base} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {days !== 7 ? <input type="hidden" name="dias" value={days} /> : null}
          <label className="block min-w-0">
            <span className="text-xs font-medium text-slate-600">Estado</span>
            <select name="status" defaultValue={filters.status ?? ""} className={selectCls}>
              <option value="">Todos</option>
              <option value="pending">Pendiente</option>
              <option value="reviewed_suspicious">Sospechosa</option>
              <option value="discarded">Descartada</option>
              <option value="reported_manual">Denunciada a mano</option>
            </select>
          </label>
          <label className="block min-w-0">
            <span className="text-xs font-medium text-slate-600">Plataforma</span>
            <select name="platform" defaultValue={filters.platform ?? ""} className={selectCls}>
              <option value="">Todas</option>
              <option value="x">X</option>
              <option value="youtube">YouTube</option>
            </select>
          </label>
          <div className="col-span-2 flex items-end gap-3">
            <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
              Filtrar
            </button>
            {filtered && (
              <Link href={`${base}${periodQuery}`} className="text-sm font-medium text-slate-600 hover:text-slate-900">
                Limpiar filtros
              </Link>
            )}
          </div>
        </form>
      </Card>

      <Card title="Cuentas para revisar" subtitle="El filtro de esta lista no cambia los bloques de arriba.">
        {accounts.length === 0 ? (
          <EmptyState>
            {filtered ? (
              "No hay cuentas que coincidan con los filtros."
            ) : allAccounts.length === 0 ? (
              <>
                Todavía no hay cuentas marcadas. El detector revisa las menciones de X y los comentarios de YouTube
                después de cada recolección (cada 20 minutos) y solo muestra cuentas con evidencia para que una
                persona las revise y, si corresponde, denuncie a mano. Pulso no denuncia en lote ni en automático.
                {" "}
                {lastRunLabel}
              </>
            ) : (
              "No hay cuentas que coincidan con los filtros."
            )}
          </EmptyState>
        ) : (
          <ul>
            {accounts.map((account) => (
              <SuspiciousAccountCard key={account.id} account={account} slug={slug} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
