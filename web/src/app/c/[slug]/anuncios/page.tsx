import Link from "next/link";
import { AdsVolumeChart } from "@/components/ads-volume-chart";
import { MetaAdCard } from "@/components/meta-ad";
import { Card, EmptyState, HBar, PageHeader, Stat } from "@/components/ui";
import { loadCandidate } from "@/lib/context";
import { computeMetaAdsView, formatAmount, formatSpendAggregate, type AdsBucket } from "@/lib/meta-ads";
import { formatMetaAdDate } from "@/lib/meta-ads";
import { formatDate, formatDateTime, TZ_LABEL } from "@/lib/time";
import { isMetaAdStatus, type MetaAdFilters } from "@/lib/types";

export const metadata = { title: "Anuncios · Pulso" };

const PERIODS = [
  { value: "30" as const, label: "30 días" },
  { value: "90" as const, label: "90 días" },
  { value: "todo" as const, label: "Todo" },
];
const PAGE_SIZE = 25;

const selectCls =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

function parsePeriod(value: string | string[] | undefined): number | "all" {
  if (value === "30") return 30;
  if (value === "90") return 90;
  return "all";
}

function parseFilters(sp: Record<string, string | string[] | undefined>): MetaAdFilters {
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const page = typeof sp.pagina === "string" ? sp.pagina.trim() : "";
  const status = typeof sp.estado === "string" ? sp.estado : "";
  const currency = typeof sp.moneda === "string" ? sp.moneda.trim().toUpperCase() : "";
  return {
    q: q || undefined,
    page: page || undefined,
    status: isMetaAdStatus(status) ? status : undefined,
    currency: currency || undefined,
  };
}

function withParams(base: string, days: number | "all", filters: MetaAdFilters, page?: number): string {
  const params = new URLSearchParams();
  if (days === 30 || days === 90) params.set("dias", String(days));
  if (filters.q) params.set("q", filters.q);
  if (filters.page) params.set("pagina", filters.page);
  if (filters.status) params.set("estado", filters.status);
  if (filters.currency) params.set("moneda", filters.currency);
  if (page && page > 1) params.set("p", String(page));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function volumeSubtitle(bucket: AdsBucket): string {
  if (bucket === "month") return "Anuncios que empezaron a pautar en cada mes (hora de Argentina).";
  if (bucket === "week") return "Anuncios que empezaron a pautar en cada semana (hora de Argentina).";
  return "Anuncios que empezaron a pautar en cada día (hora de Argentina).";
}

export default async function MetaAdsPage({ params, searchParams }: PageProps<"/c/[slug]/anuncios">) {
  const { slug } = await params;
  const sp = await searchParams;
  const days = parsePeriod(sp.dias);
  const filters = parseFilters(sp);
  const listPage = Math.max(1, Number(sp.p) || 1);
  const { repo, candidate } = await loadCandidate(slug);
  const ads = await repo.listMetaAds(candidate.id);
  const ts = await repo.dataTimestamp();
  const latestFetch = ads.reduce<string | null>((acc, ad) => {
    if (!ad.fetched_at) return acc;
    return !acc || ad.fetched_at > acc ? ad.fetched_at : acc;
  }, null);
  const viewNow = ts ? new Date(ts) : latestFetch ? new Date(latestFetch) : new Date();
  const view = computeMetaAdsView(ads, {
    days,
    now: viewNow,
    filters,
    page: listPage,
    pageSize: PAGE_SIZE,
  });
  const base = `/c/${slug}/anuncios`;
  const filtered = Boolean(filters.q || filters.page || filters.status || filters.currency);
  const pageOptions = [...view.topPages];
  if (filters.page && !pageOptions.some((p) => p.pageId === filters.page || p.pageName === filters.page)) {
    pageOptions.unshift({
      key: filters.page,
      pageId: filters.page,
      pageName: filters.page,
      ads: 0,
      active: 0,
    });
  }
  const currencies = view.spend.map((s) => s.currency).filter((c) => c !== "sin moneda");
  const maxPageAds = Math.max(1, ...view.topPages.map((p) => p.ads));
  const lastFetched = view.fetchedAt
    ? `Datos traídos el ${formatDateTime(view.fetchedAt)} (${TZ_LABEL}).`
    : view.fetchedOn
      ? `Datos traídos el ${formatDate(view.fetchedOn)}.`
      : "Todavía no hay una recolección de la Biblioteca registrada.";
  const dateRange =
    view.firstStart && view.lastDelivery
      ? `${formatMetaAdDate(view.firstStart)} – ${formatMetaAdDate(view.lastDelivery)}`
      : "—";
  const periodLabel = days === "all" ? "Todo el período recolectado" : `Últimos ${days} días`;
  const totalPages = Math.max(1, Math.ceil(view.filteredTotal / PAGE_SIZE));
  const safePage = Math.min(listPage, totalPages);

  return (
    <>
      <PageHeader
        title="Anuncios"
        description={`Anuncios políticos en Facebook e Instagram que mencionan a ${candidate.name}, según la Biblioteca de anuncios de Meta. ${periodLabel}. ${lastFetched}`}
      >
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm shadow-sm">
          {PERIODS.map((p) => {
            const value = p.value === "todo" ? "all" : Number(p.value);
            const active = days === value;
            return (
              <Link
                key={p.value}
                href={p.value === "todo" ? withParams(base, "all", filters) : withParams(base, Number(p.value), filters)}
                className={`rounded-md px-3 py-1.5 font-medium ${active ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {p.label}
              </Link>
            );
          })}
        </div>
      </PageHeader>

      <p className="mb-6 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        Estos datos salen de la API oficial de la Biblioteca de anuncios de Meta (ads_archive), no de un scraping.
        El gasto y las impresiones llegan en rangos, no en montos exactos, y cada moneda se muestra por separado: no
        las convertimos ni inventamos un total único. El recolector corre una vez por día.
        {" "}
        {lastFetched}
        {repo.mode === "fixture" ? " Este render es local, con datos exportados, y no es una captura de producción." : null}
      </p>

      {view.insufficient ? (
        <Card>
          <EmptyState>
            datos insuficientes. Todavía no hay anuncios de la Biblioteca de Meta para este candidato. Cuando el
            recolector los traiga, acá vas a ver totales, páginas, el rango de gasto y el listado.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Anuncios" value={formatAmount(view.total)} hint={`${formatAmount(view.active)} activos ahora`} />
            <Stat label="Páginas" value={formatAmount(view.pages)} hint="Páginas distintas que pautaron" />
            <Stat
              label="Activos"
              value={formatAmount(view.active)}
              tone={view.active ? "positive" : "default"}
              hint="Sin fecha de corte o con corte posterior a la última recolección"
            />
            <Stat label="Período" value={dateRange} hint="Desde el primer pautado hasta el último corte o inicio" />
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            {view.spend.length === 0 ? (
              <Stat
                label="Gasto estimado"
                value="Sin dato de gasto"
                hint="Ningún anuncio de este período informa un rango."
              />
            ) : (
              view.spend.map((row) => {
                const formatted = formatSpendAggregate(row);
                return (
                  <Stat
                    key={row.currency}
                    label={`Gasto estimado en ${row.currency}`}
                    value={formatted.value}
                    hint={`${row.ads} anuncios. ${formatted.hint}`}
                  />
                );
              })
            )}
          </div>

          <div className="mb-6 grid gap-6 lg:grid-cols-3">
            <Card title="Anuncios en el tiempo" subtitle={volumeSubtitle(view.volumeBucket)} className="lg:col-span-2">
              {view.total === 0 ? (
                <EmptyState>No hay anuncios en este período.</EmptyState>
              ) : (
                <AdsVolumeChart data={view.volume} label="Anuncios que empezaron a pautar" />
              )}
            </Card>
            <Card title="Páginas con más anuncios" subtitle="Según la cantidad de anuncios en el período.">
              {view.topPages.length === 0 ? (
                <EmptyState>No hay páginas para mostrar.</EmptyState>
              ) : (
                <div className="space-y-3">
                  {view.topPages.map((p) => (
                    <HBar
                      key={p.key}
                      label={p.pageName}
                      value={p.ads}
                      max={maxPageAds}
                      barClass="bg-indigo-500"
                      extra={p.active ? <span className="text-slate-400"> · {p.active} activos</span> : null}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card className="mb-6">
            <form method="get" action={base} className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {days !== "all" ? <input type="hidden" name="dias" value={days} /> : null}
              <label className="col-span-2 block min-w-0 md:col-span-1">
                <span className="text-xs font-medium text-slate-600">Buscar</span>
                <input
                  type="search"
                  name="q"
                  defaultValue={filters.q ?? ""}
                  placeholder="Texto o página"
                  className={selectCls}
                />
              </label>
              <label className="block min-w-0">
                <span className="text-xs font-medium text-slate-600">Página</span>
                <select name="pagina" defaultValue={filters.page ?? ""} className={selectCls}>
                  <option value="">Todas</option>
                  {pageOptions.map((p) => (
                    <option key={p.key} value={p.pageId || p.pageName}>
                      {p.pageName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-0">
                <span className="text-xs font-medium text-slate-600">Estado</span>
                <select name="estado" defaultValue={filters.status ?? ""} className={selectCls}>
                  <option value="">Todos</option>
                  <option value="activo">Activos</option>
                  <option value="inactivo">Inactivos</option>
                </select>
              </label>
              <label className="block min-w-0">
                <span className="text-xs font-medium text-slate-600">Moneda</span>
                <select name="moneda" defaultValue={filters.currency ?? ""} className={selectCls}>
                  <option value="">Todas</option>
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <div className="col-span-2 flex items-end gap-3 md:col-span-5">
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
                >
                  Filtrar
                </button>
                {filtered && (
                  <Link
                    href={days === "all" ? base : `${base}?dias=${days}`}
                    className="text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    Limpiar filtros
                  </Link>
                )}
              </div>
            </form>
          </Card>

          <Card
            title="Listado de anuncios"
            subtitle={
              filtered
                ? `${view.filteredTotal} anuncios coinciden con los filtros, de ${view.total} en el período.`
                : "Página, fechas, estado, rango de gasto y un recorte del texto. El enlace abre la ficha pública en la Biblioteca de Meta."
            }
          >
            {view.filteredTotal === 0 ? (
              <EmptyState>
                {filtered ? "No hay anuncios que coincidan con los filtros." : "No hay anuncios en este período."}
              </EmptyState>
            ) : (
              <>
                <ul>
                  {view.items.map((ad) => (
                    <MetaAdCard key={ad.id} ad={ad} now={viewNow} />
                  ))}
                </ul>
                {totalPages > 1 ? (
                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
                    <p className="text-slate-500">
                      Página {safePage} de {totalPages}
                    </p>
                    <div className="flex gap-3">
                      {safePage > 1 ? (
                        <Link
                          href={withParams(base, days, filters, safePage - 1)}
                          className="font-medium text-indigo-600 hover:text-indigo-500"
                        >
                          Anterior
                        </Link>
                      ) : null}
                      {safePage < totalPages ? (
                        <Link
                          href={withParams(base, days, filters, safePage + 1)}
                          className="font-medium text-indigo-600 hover:text-indigo-500"
                        >
                          Siguiente
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </>
      )}
    </>
  );
}
