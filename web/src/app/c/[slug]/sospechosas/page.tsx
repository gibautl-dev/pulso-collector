import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { SuspiciousAccountCard } from "@/components/suspicious-account";
import { loadCandidate } from "@/lib/context";
import { isSuspiciousPlatform, isSuspiciousStatus, type SuspiciousFilters } from "@/lib/types";
import { formatDateTime, TZ_LABEL } from "@/lib/time";

export const metadata = { title: "Cuentas sospechosas · Pulso" };

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
  const filters = parseSuspiciousFilters(await searchParams);
  const { repo, candidate } = await loadCandidate(slug);
  const [accounts, allAccounts, runs] = await Promise.all([
    repo.listSuspiciousAccounts(candidate.id, filters),
    repo.listSuspiciousAccounts(candidate.id),
    repo.listSourceRuns(candidate.id, 20),
  ]);
  const lastRun = runs.find((r) => r.finished_at)?.finished_at ?? null;
  const lastRunLabel = lastRun
    ? `Última recolección: ${formatDateTime(lastRun)} (${TZ_LABEL}).`
    : "Todavía no hay una recolección registrada.";
  const filtered = Boolean(filters.status || filters.platform);
  const base = `/c/${slug}/sospechosas`;

  return (
    <>
      <PageHeader
        title="Cuentas sospechosas"
        description={`Revisión humana, sin denuncia automática. ${lastRunLabel} El detector corre después de cada recolección, cada 20 minutos.`}
      />

      <Card className="mb-6">
        <form method="get" action={base} className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
              <Link href={base} className="text-sm font-medium text-slate-600 hover:text-slate-900">
                Limpiar filtros
              </Link>
            )}
          </div>
        </form>
      </Card>

      <Card>
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
