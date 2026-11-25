import Link from "next/link";
import { Card, EmptyState, InfoTip, PageHeader, Stat } from "@/components/ui";
import { InconsistencyAlertCard } from "@/components/inconsistency-alert";
import { loadCandidate } from "@/lib/context";
import {
  HOW_IT_WORKS,
  INCONSISTENCY_SECTION_LABEL,
  coverageLine,
  normalizeAlerts,
  sortAlerts,
  summarize,
} from "@/lib/inconsistency";
import { clockFor, formatDateTime } from "@/lib/time";

export const metadata = { title: `${INCONSISTENCY_SECTION_LABEL} · Pulso` };

export default async function ContradiccionesPage({ params }: PageProps<"/c/[slug]/contradicciones">) {
  const { slug } = await params;
  const clock = clockFor(slug);
  const { repo, candidate } = await loadCandidate(slug);
  const [rows, scan] = await Promise.all([
    repo.listInconsistencyAlerts(candidate.id),
    repo.getInconsistencyScan(candidate.id),
  ]);
  const alerts = sortAlerts(normalizeAlerts(rows));
  const sum = summarize(alerts);
  const coverage = coverageLine(scan, candidate.name);
  const lastReview = scan?.last_scan_at ? formatDateTime(scan.last_scan_at, clock) : null;

  return (
    <>
      <PageHeader
        title={INCONSISTENCY_SECTION_LABEL}
        description={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            Cuando algo nuevo choca con lo que {candidate.name} dijo antes.
            <InfoTip text={HOW_IT_WORKS} label="Cómo funciona" />
          </span>
        }
      />

      <div data-testid="contradicciones-resumen" className="grid gap-4 sm:grid-cols-3">
        <Stat label="Para revisar" value={sum.open} hint={sum.open === 1 ? "alerta abierta" : "alertas abiertas"} tone={sum.open ? "negative" : "default"} />
        <Stat label="Severidad alta" value={sum.high} hint={`${sum.medium} de severidad media`} />
        <Stat
          label="Revisadas"
          value={sum.reviewed}
          hint={lastReview ? `Última búsqueda: ${lastReview} (${clock.tzLabel})` : "Todavía sin búsqueda"}
        />
      </div>

      {scan?.reason ? (
        <div data-testid="contradicciones-pocos-datos" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <p className="font-semibold">Pocos datos para comparar</p>
          <p className="mt-1">{scan.reason}</p>
          <p className="mt-1 text-amber-800">
            Mientras tanto, igual avisamos si una nota dice que {candidate.name} se contradijo.
          </p>
        </div>
      ) : coverage ? (
        <p className="mt-3 text-xs text-slate-500">{coverage}</p>
      ) : null}

      <div className="mt-6 space-y-4">
        {alerts.length === 0 ? (
          <Card>
            <EmptyState>
              {scan
                ? `No encontramos contradicciones de ${candidate.name} en lo que medimos.`
                : `Todavía no revisamos contradicciones de ${candidate.name}.`}{" "}
              <Link href={`/c/${slug}/menciones`} className="font-medium text-indigo-700 hover:text-indigo-500">
                Ver menciones →
              </Link>
            </EmptyState>
          </Card>
        ) : (
          alerts.map((a) => <InconsistencyAlertCard key={a.id} alert={a} slug={slug} timeZone={clock.timeZone} />)
        )}
      </div>
    </>
  );
}
