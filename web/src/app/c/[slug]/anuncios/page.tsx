import Link from "next/link";
import { AdsVolumeChart } from "@/components/ads-volume-chart";
import { CreativeAdCardView } from "@/components/creative-ad-card";
import { googleToCreativeCard, metaToCreativeCard } from "@/lib/rival-ads";
import { Card, EmptyState, HBar, PageHeader, Stat } from "@/components/ui";
import { loadCandidate } from "@/lib/context";
import { computeGoogleAdsView, formatGoogleAdDate, formatSpendAggregate as formatGoogleSpendAggregate, GOOGLE_ADS_EXAMPLE_BANNER, GOOGLE_ADS_KICILLOF_SCOPE, GOOGLE_ADS_SPAIN_PENDING, SOURCE_LABEL as GOOGLE_SOURCE_LABEL } from "@/lib/google-ads";
import { computeMetaAdsView, formatAmount, formatSpendAggregate, STANCE_BAR, STANCE_LABEL, type AdsBucket } from "@/lib/meta-ads";
import { formatShare } from "@/lib/ai-visibility";
import { formatMetaAdDate } from "@/lib/meta-ads";
import { META_ADS_EU_UNAVAILABLE, regionFor } from "@/lib/region";
import { clockFor, formatDate, formatDateTime } from "@/lib/time";
import { isMetaAdStance, isMetaAdStatus, type MetaAdFilters } from "@/lib/types";

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
  const stance = typeof sp.postura === "string" ? sp.postura.trim() : "";
  return {
    q: q || undefined,
    page: page || undefined,
    status: isMetaAdStatus(status) ? status : undefined,
    currency: currency || undefined,
    stance: isMetaAdStance(stance) || stance === "sin_clasificar" ? stance : undefined,
  };
}

function withParams(base: string, days: number | "all", filters: MetaAdFilters, page?: number): string {
  const params = new URLSearchParams();
  if (days === 30 || days === 90) params.set("dias", String(days));
  if (filters.q) params.set("q", filters.q);
  if (filters.page) params.set("pagina", filters.page);
  if (filters.status) params.set("estado", filters.status);
  if (filters.currency) params.set("moneda", filters.currency);
  if (filters.stance) params.set("postura", filters.stance);
  if (page && page > 1) params.set("p", String(page));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function volumeSubtitle(bucket: AdsBucket, tzLabel: string): string {
  if (bucket === "month") return `Anuncios que empezaron a pautar en cada mes (${tzLabel}).`;
  if (bucket === "week") return `Anuncios que empezaron a pautar en cada semana (${tzLabel}).`;
  return `Anuncios que empezaron a pautar en cada día (${tzLabel}).`;
}

export default async function MetaAdsPage({ params, searchParams }: PageProps<"/c/[slug]/anuncios">) {
  const { slug } = await params;
  const sp = await searchParams;
  const days = parsePeriod(sp.dias);
  const filters = parseFilters(sp);
  const listPage = Math.max(1, Number(sp.p) || 1);
  const { repo, candidate } = await loadCandidate(slug);
  const clock = clockFor(slug, candidate.country);
  const region = regionFor(slug, candidate.country);
  const [ads, googleAds, googleSettings, ts] = await Promise.all([
    region.showMetaAds ? repo.listMetaAds(candidate.id) : Promise.resolve([]),
    repo.listGoogleAds(candidate.id),
    repo.listGoogleAdsSettings(candidate.id),
    repo.dataTimestamp(),
  ]);
  const googleView = computeGoogleAdsView(googleAds);
  const googleExample = repo.mode === "fixture" && googleAds.length > 0;
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
  const filtered = Boolean(filters.q || filters.page || filters.status || filters.currency || filters.stance);
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
    ? `Datos traídos el ${formatDateTime(view.fetchedAt, clock)} (${clock.tzLabel}).`
    : view.fetchedOn
      ? `Datos traídos el ${formatDate(view.fetchedOn, clock)}.`
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
        description={`Anuncios en Meta y en Google para ${candidate.name}, según fuentes oficiales. ${region.showMetaAds ? `${periodLabel}. ${lastFetched}` : "Meta no aplica en la UE."}`}
      >
        {region.showMetaAds ? (
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
        ) : null}
      </PageHeader>

      {googleExample ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {GOOGLE_ADS_EXAMPLE_BANNER}
        </p>
      ) : null}

      {!region.showMetaAds ? (
        <div id="anuncios-meta" className="mb-6">
          <h2 className="text-lg font-semibold text-slate-900">Anuncios de Meta</h2>
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Esta sección no está activa para candidatos de la Unión Europea. {META_ADS_EU_UNAVAILABLE}{" "}
            En Pulso no consultamos esa API para este candidato, para no usar valores de Argentina por defecto.
          </p>
        </div>
      ) : null}

      {region.showMetaAds ? (
      <div id="anuncios-meta">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Anuncios de Meta</h2>
      <p className="mb-6 text-sm text-slate-600">
        El gasto y las impresiones se muestran en rangos, como los informa Meta. {lastFetched}
      </p>

      {view.insufficient ? (
        <Card>
          <EmptyState>
            Todavía no hay anuncios de Meta para este candidato.
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
              hint="Al momento de la última actualización"
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

          <Card
            title="A favor, en contra y neutrales"
            subtitle="A favor, en contra o neutrales respecto del candidato."
            className="mb-6"
          >
            {view.classification.insufficient ? (
              <EmptyState>
                Todavía no hay anuncios clasificados en este período.
              </EmptyState>
            ) : (
              <div className="grid gap-6 lg:grid-cols-3">
                {view.classification.rows.map((row) => (
                  <div key={row.stance}>
                    <HBar
                      label={
                        <Link href={withParams(base, days, { ...filters, stance: row.stance })} className="hover:text-indigo-700">
                          {row.label}
                        </Link>
                      }
                      value={row.ads}
                      max={Math.max(1, ...view.classification.rows.map((r) => r.ads))}
                      barClass={STANCE_BAR[row.stance]}
                      extra={<span className="ml-1.5 text-xs text-slate-500">{formatShare(row.share)}</span>}
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      {row.active} activos.
                      {row.spend.length
                        ? ` Gasto estimado: ${row.spend.map((s) => formatSpendAggregate(s).value).join(" · ")}.`
                        : " Sin dato de gasto."}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {view.classification.unclassified > 0 && !view.classification.insufficient ? (
              <p className="mt-4 text-xs text-slate-500">
                {view.classification.unclassified} anuncios todavía no tienen clasificación y no entran en estos
                porcentajes.
              </p>
            ) : null}
          </Card>

          <div className="mb-6 grid gap-6 lg:grid-cols-3">
            <Card title="Anuncios en el tiempo" subtitle={volumeSubtitle(view.volumeBucket, clock.tzLabel)} className="lg:col-span-2">
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
            <form method="get" action={base} className="grid grid-cols-2 gap-3 md:grid-cols-6">
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
              <label className="block min-w-0">
                <span className="text-xs font-medium text-slate-600">Postura</span>
                <select name="postura" defaultValue={filters.stance ?? ""} className={selectCls}>
                  <option value="">Todas</option>
                  <option value="a_favor">{STANCE_LABEL.a_favor}</option>
                  <option value="en_contra">{STANCE_LABEL.en_contra}</option>
                  <option value="neutral_otro">{STANCE_LABEL.neutral_otro}</option>
                  <option value="sin_clasificar">Sin clasificar</option>
                </select>
              </label>
              <div className="col-span-2 flex items-end gap-3 md:col-span-6">
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
                : "El enlace abre la ficha pública en Meta."
            }
          >
            {view.filteredTotal === 0 ? (
              <EmptyState>
                {filtered ? "No hay anuncios que coincidan con los filtros." : "No hay anuncios en este período."}
              </EmptyState>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {view.items.map((ad) => (
                    <CreativeAdCardView key={ad.id} card={metaToCreativeCard(ad, viewNow)} />
                  ))}
                </div>
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

      </div>
      ) : null}

      <section id="anuncios-google" className="mt-10">
        <h2 className="text-lg font-semibold text-slate-900">Anuncios de Google</h2>
        <p className="mt-1 text-sm text-slate-600">
          {(googleSettings?.source ?? googleView.source) ? GOOGLE_SOURCE_LABEL[(googleSettings?.source ?? googleView.source)!] : "Ruta oficial de Google, según el país del candidato."}
        </p>
        {slug === "axel-kicillof" ? (
          <p className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            {GOOGLE_ADS_KICILLOF_SCOPE}
          </p>
        ) : null}
        {slug === "pedro-sanchez" && googleAds.length === 0 ? (
          <p className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            {GOOGLE_ADS_SPAIN_PENDING}
          </p>
        ) : null}
        {googleAds.length > 0 ? (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Stat label="Anuncios en la captura" value={String(googleView.total)} />
              <Stat label="Anunciantes" value={String(googleView.advertisers.length)} />
              <Stat
                label="Período de difusión"
                value={
                  googleView.firstStart && googleView.lastDelivery
                    ? `${formatGoogleAdDate(googleView.firstStart)} – ${formatGoogleAdDate(googleView.lastDelivery)}`
                    : "—"
                }
              />
            </div>
            {formatGoogleSpendAggregate(googleView) ? (
              <p className="mt-3 text-sm text-slate-600">{formatGoogleSpendAggregate(googleView)}</p>
            ) : (
              <p className="mt-3 text-sm text-slate-600">Esta fuente no publica gasto (o no hay moneda en la captura).</p>
            )}
            <Card title="Anunciantes" className="mt-4">
              <ul className="space-y-2 text-sm">
                {googleView.advertisers.map((item) => (
                  <li key={item.advertiserId} className="flex justify-between gap-3">
                    <span className="text-slate-800">{item.advertiserName}</span>
                    <span className="tabular-nums text-slate-500">{item.ads}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Listado" subtitle="Vínculos a la ficha oficial." className="mt-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {googleAds.map((ad) => (
                  <CreativeAdCardView key={ad.id} card={googleToCreativeCard(ad)} />
                ))}
              </div>
            </Card>
          </>
        ) : slug !== "pedro-sanchez" ? (
          <EmptyState>Todavía no hay anuncios de Google cargados para este candidato.</EmptyState>
        ) : null}
      </section>

    </>
  );
}
