import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ActionsSection, HighlightCard, KpiStrip, PointsSection, SourcesList } from "@/components/daily-brief";
import { loadCandidate } from "@/lib/context";
import {
  DAILY_BRIEF_SECTION_LABEL,
  briefDateLabel,
  briefDateShort,
  briefKpis,
  normalizeOutput,
  parseBriefDate,
  pickBrief,
} from "@/lib/daily-brief";
import { clockFor } from "@/lib/time";

export const metadata = { title: `${DAILY_BRIEF_SECTION_LABEL} · Pulso` };

export default async function ResumenPage({ params, searchParams }: PageProps<"/c/[slug]/resumen">) {
  const { slug } = await params;
  const sp = await searchParams;
  const clock = clockFor(slug);
  const { repo, candidate } = await loadCandidate(slug);
  const briefs = await repo.listDailyBriefs(candidate.id, 14);
  const wanted = parseBriefDate(sp.fecha);
  const brief = pickBrief(briefs, wanted);

  const dateNav =
    briefs.length > 1 ? (
      <nav aria-label="Otros días" className="flex flex-wrap gap-1.5">
        {briefs.slice(0, 7).map((b) => {
          const active = b.brief_date === brief?.brief_date;
          return (
            <Link
              key={b.id}
              href={`/c/${slug}/resumen?fecha=${b.brief_date}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium tabular-nums ring-1 ring-inset ${
                active ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {briefDateShort(b.brief_date)}
            </Link>
          );
        })}
      </nav>
    ) : null;

  if (!brief) {
    return (
      <>
        <PageHeader title={DAILY_BRIEF_SECTION_LABEL} description={`Lo que cambió, por qué importa y qué hacer, para ${candidate.name}.`}>
          {dateNav}
        </PageHeader>
        <Card>
          <EmptyState>
            {wanted
              ? `No hay resumen del ${briefDateLabel(wanted, { capital: false })}.`
              : `Todavía no hay un resumen del día para ${candidate.name}. Se arma cada mañana con las menciones del día anterior.`}
          </EmptyState>
        </Card>
      </>
    );
  }

  const out = normalizeOutput(brief.output);
  const kpis = briefKpis(brief.metrics, clock.locale);
  const title = `${briefDateLabel(brief.brief_date)} · ${clock.tzLabel}`;

  return (
    <>
      <PageHeader title={DAILY_BRIEF_SECTION_LABEL} description={title}>
        {dateNav}
      </PageHeader>

      <div data-testid="resumen-hero" className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">En una línea</p>
          <h2 className="mt-2 text-xl font-semibold leading-snug tracking-tight text-slate-900 sm:text-2xl">
            {out.headline || brief.headline}
          </h2>
          {brief.status === "insufficient" ? (
            <p className="mt-3 text-sm text-slate-600">
              {out.insufficient_reason}{" "}
              <Link href={`/c/${slug}/menciones`} className="font-medium text-indigo-700 hover:text-indigo-500">
                Ver las menciones →
              </Link>
            </p>
          ) : (
            <div className="mt-5">
              <KpiStrip kpis={kpis} />
            </div>
          )}
        </div>
        {out.highlight ? <HighlightCard highlight={out.highlight} note={out.aclaracion || null} /> : null}
      </div>

      {brief.status !== "insufficient" ? (
        <>
          <div data-testid="resumen-secciones" className="mt-6 grid gap-4 lg:grid-cols-3">
            <PointsSection
              testId="resumen-que-cambio"
              title="Qué cambió"
              icon="M3 17l6-6 4 4 8-8M21 7v6h-6"
              accent="bg-indigo-50 text-indigo-700"
              items={out.what_changed}
              sources={out.sources}
              empty="Sin cambios relevantes con los datos del día."
            />
            <PointsSection
              testId="resumen-por-que"
              title="Por qué importa"
              icon="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"
              accent="bg-amber-50 text-amber-700"
              items={out.why_it_matters}
              sources={out.sources}
              empty="Sin puntos para destacar."
            />
            <ActionsSection items={out.what_to_do} sources={out.sources} />
          </div>

          {out.sources.length > 0 ? (
            <Card
              className="mt-6"
              testId="resumen-fuentes"
              title="Menciones citadas"
              subtitle={`${out.sources.length} pieza${out.sources.length === 1 ? "" : "s"} del día que respaldan el resumen.`}
            >
              <SourcesList sources={out.sources} slug={slug} />
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}
