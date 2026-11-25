import Link from "next/link";
import { Badge, Card, EmptyState, InfoTip } from "@/components/ui";
import type { ComparisonSpotlight } from "@/lib/home-spotlights";
import { ACCION_SECTION_LABEL, CRISIS_RISK_BADGE, CRISIS_RISK_LABEL, CUSTOM_TOPICS_SECTION_LABEL } from "@/lib/labels";

function VerMas({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="mt-4 inline-flex items-center rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
    >
      Ver más →
    </Link>
  );
}

function MiniShareBar({
  candidateName,
  rivalName,
  candidateShare,
  rivalShare,
}: {
  candidateName: string;
  rivalName: string;
  candidateShare: number;
  rivalShare: number;
}) {
  const max = Math.max(candidateShare, rivalShare, 0.01);
  const left = Math.max(4, Math.round((candidateShare / max) * 100));
  const right = Math.max(4, Math.round((rivalShare / max) * 100));
  return (
    <div className="mt-3 space-y-2">
      <div>
        <div className="mb-1 flex justify-between gap-2 text-[11px] text-slate-600">
          <span className="truncate">{candidateName}</span>
          <span className="tabular-nums">{Math.round(candidateShare * 100)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100">
          <div className="h-1.5 rounded-full bg-violet-600" style={{ width: `${left}%` }} />
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between gap-2 text-[11px] text-slate-600">
          <span className="truncate">{rivalName}</span>
          <span className="tabular-nums">{Math.round(rivalShare * 100)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100">
          <div className="h-1.5 rounded-full bg-slate-400" style={{ width: `${right}%` }} />
        </div>
      </div>
    </div>
  );
}

export function ComparisonSpotlightCard({
  slug,
  spotlight,
}: {
  slug: string;
  spotlight: ComparisonSpotlight;
}) {
  return (
    <Card title="Comparación con rivales" subtitle="Participación en la conversación, con menciones de terceros.">
      {spotlight.kind === "empty" ? (
        <EmptyState>Todavía no hay un rival cargado para comparar.</EmptyState>
      ) : spotlight.kind === "no_window" ? (
        <EmptyState>Todavía no hay un período con datos de ambos para comparar.</EmptyState>
      ) : spotlight.kind === "no_mentions" ? (
        <EmptyState>Sin menciones en el período para calcular la participación.</EmptyState>
      ) : (
        <>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {spotlight.candidateName}
            {spotlight.rivalName ? ` vs ${spotlight.rivalName}` : ""}
          </p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{spotlight.headline}</p>
          {spotlight.deltaLabel ? <p className="mt-1 text-xs text-slate-500">{spotlight.deltaLabel}</p> : null}
          {spotlight.periodLabel ? (
            <p data-testid="comparacion-periodo" className="mt-1 flex items-center gap-1 text-xs text-slate-400">
              <span>Período comparado: {spotlight.periodLabel}</span>
              {spotlight.periodTooltip ? <InfoTip label="Qué período se compara" text={spotlight.periodTooltip} /> : null}
            </p>
          ) : null}
          {spotlight.candidateShare != null && spotlight.rivalShare != null && spotlight.rivalName ? (
            <MiniShareBar
              candidateName={spotlight.candidateName}
              rivalName={spotlight.rivalName}
              candidateShare={spotlight.candidateShare}
              rivalShare={spotlight.rivalShare}
            />
          ) : null}
        </>
      )}
      <VerMas href={`/c/${slug}/comparacion`} />
    </Card>
  );
}

export function ActionSpotlightCard({
  slug,
  pendingCount,
  headline,
  severity,
}: {
  slug: string;
  pendingCount: number;
  headline: string | null;
  severity: string | null;
}) {
  return (
    <Card title={ACCION_SECTION_LABEL} subtitle="Alertas que esperan una decisión humana. Pulso no publica.">
      {pendingCount === 0 ? (
        <EmptyState>No hay alertas pendientes.</EmptyState>
      ) : (
        <>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Alertas pendientes</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{pendingCount}</p>
          {headline ? (
            <div className="mt-3 flex flex-wrap items-start gap-2">
              {severity ? (
                <Badge className={CRISIS_RISK_BADGE[severity] ?? "bg-slate-50 text-slate-700 ring-slate-200"}>
                  {CRISIS_RISK_LABEL[severity] ?? severity}
                </Badge>
              ) : null}
              <p className="min-w-0 flex-1 text-sm text-slate-700">{headline}</p>
            </div>
          ) : null}
        </>
      )}
      <VerMas href={`/c/${slug}/accion`} />
    </Card>
  );
}

export function CustomTopicsSpotlightCard({
  slug,
  topicName,
  volume,
  spike,
  empty,
}: {
  slug: string;
  topicName: string | null;
  volume: number;
  spike: boolean;
  empty: boolean;
}) {
  return (
    <Card title={CUSTOM_TOPICS_SECTION_LABEL} subtitle="Temáticas definidas a mano, con un analista por tema.">
      {empty ? (
        <EmptyState>Todavía no hay temas a medida cargados para este candidato.</EmptyState>
      ) : volume === 0 ? (
        <EmptyState>
          {topicName ? `“${topicName}” no tuvo menciones en el período.` : "No hubo menciones en los temas a medida de este período."}
        </EmptyState>
      ) : (
        <>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{topicName}</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{volume}</p>
          <p className="mt-1 text-xs text-slate-500">
            menciones en el período
            {spike ? (
              <span className="ml-2 inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-inset ring-violet-200">
                Pico
              </span>
            ) : null}
          </p>
        </>
      )}
      <VerMas href={`/c/${slug}/temas`} />
    </Card>
  );
}
